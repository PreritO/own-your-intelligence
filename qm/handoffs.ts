// Handoff relay: a handoff recorded by the protocol service wakes the owning team's QM agent.
//
//   bun qm/handoffs.ts                  # follow every run on PROTOCOL_URL; skip handoffs from quest-* agents
//   bun qm/handoffs.ts --run <run>      # follow one run (qm-admin demo and server/commission/qm.ts do this in-process)
//
// QM has no push hook for "another agent asked you something", so this follows the protocol's
// GET /events SSE. For each `handoff {id, toAgent, memoryId, question}`:
//   1. bind the new QM turn to the handoff's protocol run in the loci adapter (POST <adapter>/bind), so
//      the team agent's loci-<team>_* calls land in the same run;
//   2. send a turn into the team's QM project scope (portal POST /api/turn {scopeId}) telling its agent
//      to claim and visit the station and call loci-<team>_reply(handoffId, answer);
//   3. wait up to 45 s (HANDOFF_TIMEOUT_MS) for the protocol to record the reply. The adapter labels a
//      QM reply "(replied by QM <team> agent)". If nothing lands in time, the orchestrator answers
//      instead (the owner re-verifies the page through the protocol, Claude writes the reply from that
//      page only) and the reply is labelled "(orchestrator fallback: ...)".
// No protocol logic here: the service still checks ownership, claims and that a reply is grounded.
import { claude } from "../server/commission/claude";
import { loadPalace } from "../server/routes";

const PROTOCOL_URL = (process.env.PROTOCOL_URL ?? "http://localhost:8790").replace(/\/$/, "");
const ADAPTER_URL = (process.env.LOCI_MCP_URL ?? "http://localhost:8791").replace(/\/$/, "");
export const HANDOFF_TIMEOUT_MS = Number(process.env.HANDOFF_TIMEOUT_MS ?? 45000);

export type HandoffEvent = { run: string; agent: string; id: string; toAgent: string; memoryId: string; question: string; t?: number };
export type Outcome = HandoffEvent & { source: "qm" | "fallback" | "other" | "none"; answer?: string; qmRunId?: string; ms: number };
type Portal = (method: string, path: string, body?: unknown) => Promise<{ status: number; body: string }>;

export type RelayOptions = {
  portal: Portal;
  principal: string;
  scopes: () => Promise<Record<string, string>>; // team -> QM scope id
  accept?: (h: HandoffEvent) => boolean;
  timeoutMs?: number;
  // The orchestrator's reply when the QM agent doesn't answer in time. Default: Claude, from the page only.
  fallback?: (h: HandoffEvent, page: { verdict: string; content: string; title?: string }) => Promise<string>;
  log?: (s: string) => void;
};

const QM_LABEL = /\(replied by QM (\w[\w-]*) agent\)\s*$/;
const teamLabel = (team: string) => loadPalace().agents.find((a) => a.id === team)?.label ?? `${team} agent`;

async function pget(path: string) {
  const r = await fetch(PROTOCOL_URL + path, { signal: AbortSignal.timeout(8000) });
  return r.json() as Promise<any>;
}
async function ppost(path: string, body: unknown) {
  const r = await fetch(PROTOCOL_URL + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  return { status: r.status, data: (await r.json().catch(() => ({}))) as any };
}
export async function adapterBind(b: Record<string, unknown>) {
  await fetch(`${ADAPTER_URL}/bind`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b), signal: AbortSignal.timeout(3000) }).catch(() => {});
}

export function wakeBrief(h: HandoffEvent): string {
  const t = h.toAgent;
  return (
    `You are the ${teamLabel(t)} at Acme Robotics (a seeded fake company). The ${h.agent} agent sent you handoff ${h.id} ` +
    `about the station ${h.memoryId} in your room. Their question: "${h.question}"\n\n` +
    `Follow the loci protocol with your loci-${t}_* tools only:\n` +
    `1. loci-${t}_claim {"memoryId": "${h.memoryId}"}\n` +
    `2. loci-${t}_visit {"memoryId": "${h.memoryId}", "question": <their question>}\n` +
    `3. loci-${t}_reply {"handoffId": "${h.id}", "answer": <1-3 sentences>}. Answer ONLY from the page text the visit returned. ` +
    `If the verdict is gap, say the page doesn't record it. If it is stale, say it needs a refresh before anyone relies on it. Never invent content.\n` +
    `Then end the turn with finish_silently. Do not post a message and do not call loci-${t}_answer: your reply goes back to the ${h.agent} agent through the protocol.`
  );
}

async function claudeFallback(h: HandoffEvent, page: { verdict: string; content: string; title?: string }): Promise<string> {
  if (page.verdict === "gap") return `${page.title ?? h.memoryId} (${h.memoryId}) is a gap: the page doesn't record this.`;
  const system =
    `You are the ${teamLabel(h.toAgent)} at Acme Robotics. Another agent asked you a question about a page in your room. ` +
    `Answer ONLY from the page text below, which you just read. If the page doesn't say, say so. 1-3 short sentences, no preamble.` +
    (page.verdict === "stale" ? " The page is stale: say it needs a refresh before anyone relies on it." : "");
  const text = await claude(system, `Their question: ${h.question}\n\nPage ${h.memoryId} (verdict ${page.verdict}):\n${page.content.slice(0, 3000)}`, 220, 30000);
  return text ?? `From ${page.title ?? h.memoryId}: ${page.content.split(/\n+/).find((l) => l.trim() && !l.startsWith("#"))?.slice(0, 200) ?? "(empty)"}`;
}

export class HandoffRelay {
  private seen = new Set<string>();
  private outcomes: Promise<Outcome>[] = [];
  private abort = new AbortController();
  constructor(private o: RelayOptions) {}

  // Follow the protocol's SSE (one run, or all runs). Returns once the stream is open.
  async follow(run?: string): Promise<void> {
    const url = `${PROTOCOL_URL}/events?${run ? `run=${encodeURIComponent(run)}&replay=1` : "replay=0"}`;
    const res = await fetch(url, { signal: this.abort.signal });
    if (!res.ok || !res.body) throw new Error(`protocol /events: HTTP ${res.status}`);
    (async () => {
      const dec = new TextDecoder();
      let buf = "";
      try {
        for await (const chunk of res.body!) {
          buf += dec.decode(chunk, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, i);
            buf = buf.slice(i + 2);
            for (const line of frame.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              try {
                const ev = JSON.parse(line.slice(6));
                if (ev.type === "handoff") this.handle(ev as HandoffEvent);
              } catch {}
            }
          }
        }
      } catch (e) {
        if (!this.abort.signal.aborted) this.log(`event stream closed: ${(e as Error).message}`);
      }
    })();
  }

  stop() {
    this.abort.abort();
  }

  // Every handoff delivered so far, settled (answered by QM, by the fallback, or by someone else).
  async settled(): Promise<Outcome[]> {
    let n = -1;
    while (n !== this.outcomes.length) {
      n = this.outcomes.length;
      await Promise.all(this.outcomes);
    }
    return Promise.all(this.outcomes);
  }

  handle(h: HandoffEvent) {
    const key = `${h.run}:${h.id}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.o.accept ? !this.o.accept(h) : /^quest-\d+$/.test(h.agent)) return;
    this.outcomes.push(this.deliver(h));
  }

  private log(s: string) {
    (this.o.log ?? console.log)(`[handoff-relay] ${s}`);
  }

  private async status(h: HandoffEvent) {
    return pget(`/handoff?id=${encodeURIComponent(h.id)}&run=${encodeURIComponent(h.run)}`).catch(() => ({}));
  }

  async deliver(h: HandoffEvent): Promise<Outcome> {
    const t0 = Date.now();
    const timeout = this.o.timeoutMs ?? HANDOFF_TIMEOUT_MS;
    const scopeId = (await this.o.scopes().catch(() => ({}) as Record<string, string>))[h.toAgent];
    let qmRunId: string | undefined;
    if (scopeId) {
      const threadRef = `web:${this.o.principal}:handoff-${h.toAgent}-${h.id}-${Date.now()}`;
      await adapterBind({ run: h.run, agent: h.toAgent, threadRef, handoffId: h.id });
      const r = await this.o.portal("POST", "/api/turn", { text: wakeBrief(h), threadRef, scopeId, channelName: h.toAgent });
      if (r.status < 300) {
        qmRunId = JSON.parse(r.body).runId;
        if (qmRunId) await adapterBind({ run: h.run, agent: h.toAgent, threadRef, qmRunId, handoffId: h.id });
        this.log(`${h.id} ${h.agent} -> ${h.toAgent} (${h.memoryId}): woke QM ${h.toAgent} scope ${scopeId}, turn ${qmRunId}`);
      } else {
        this.log(`${h.id}: QM turn for ${h.toAgent} failed: HTTP ${r.status} ${r.body.slice(0, 160)}`);
      }
    } else {
      this.log(`${h.id}: no QM scope for ${h.toAgent}; orchestrator answers`);
    }
    // Wait for the protocol to record a reply (from QM, or from anyone else answering this handoff).
    const deadline = t0 + (qmRunId ? timeout : 0);
    for (;;) {
      const s = await this.status(h);
      if (s?.answered) {
        const who = QM_LABEL.exec(s.answer ?? "")?.[1];
        const source = who ? "qm" : "other";
        this.log(`${h.id}: answered by ${who ? `QM ${who} agent` : "someone else (not QM)"} after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
        return { ...h, source, answer: s.answer, qmRunId, ms: Date.now() - t0 };
      }
      if (Date.now() >= deadline) break;
      await Bun.sleep(1000);
    }
    // Fallback: the orchestrator answers on the owner's behalf, labelled as such.
    const why = qmRunId ? `QM ${h.toAgent} agent did not reply within ${Math.round(timeout / 1000)} s` : `no QM ${h.toAgent} agent`;
    const v = await ppost("/visit", { agent: h.toAgent, memoryId: h.memoryId, question: h.question, run: h.run });
    const page = { verdict: String(v.data?.verdict ?? "gap"), content: String(v.data?.content ?? ""), title: v.data?.title };
    const text = await (this.o.fallback ?? claudeFallback)(h, page);
    const answer = `${text.trim()} (orchestrator fallback: ${why})`;
    const r = await ppost("/reply", { agent: h.toAgent, id: h.id, answer, run: h.run });
    if (r.status === 409) {
      const s = await this.status(h);
      const who = QM_LABEL.exec(s?.answer ?? "")?.[1];
      this.log(`${h.id}: reply landed while falling back (${who ? `QM ${who}` : "other"})`);
      return { ...h, source: who ? "qm" : "other", answer: s?.answer, qmRunId, ms: Date.now() - t0 };
    }
    this.log(`${h.id}: orchestrator fallback reply (${why}): HTTP ${r.status}`);
    return { ...h, source: r.status < 300 ? "fallback" : "none", answer, qmRunId, ms: Date.now() - t0 };
  }
}

if (import.meta.main) {
  const { portal, teamScopes, ADMIN } = await import("./qm-admin");
  const i = process.argv.indexOf("--run");
  const run = i >= 0 ? process.argv[i + 1] : undefined;
  const relay = new HandoffRelay({ portal, principal: ADMIN, scopes: teamScopes, ...(run ? { accept: (h) => h.run === run } : {}) });
  await relay.follow(run);
  console.log(`[handoff-relay] following ${PROTOCOL_URL}/events${run ? ` (run ${run})` : " (all runs; handoffs from quest-* agents are left to server/commission/qm.ts)"}; timeout ${HANDOFF_TIMEOUT_MS} ms`);
}
