// QM harness for a commissioned quest: run 2 (execute) is driven by a real QM agent.
//
//   POST :8788/commission?harness=qm {task}
//
// Setup (once, QM already running on portal :8129 / core :8081, see NOTES-qm-fork.md):
//   LOCI_MCP_PORT=8792 bun qm/loci-mcp.ts          # an adapter that also serves /quest-<n>/mcp
//   bun qm/qm-admin.ts quest-setup                   # QM project "quest" + connector quest-loci
//
// Per quest: the connector `quest-loci` is re-pointed at /quest-<n>/mcp, and the QM "quest" project
// scope gets one turn with the learned route. Its pi harness (claude-sonnet-5) calls quest-loci_claim /
// _visit / _handoff, which the adapter forwards to :8790 as agent quest-<n>. Team handoffs are answered
// by this orchestrator on behalf of legal/finance/eng (team visit + their run-1 reply), because nothing
// wakes a team QM scope on a handoff yet (NOTES-qm-fork.md "Handoff reply loop").
//
// Honest limits: the connector id is `quest-loci`, not `loci-quest`, so the fork's scope-binding check
// (serverId starts with "loci-") does not apply to it; binding it needs LOCI_SCOPES + a QM restart,
// which would kill processes this workspace didn't start. Falls back to the protocol walk if QM is down.
import type { QuestHooks } from "./quest";
import { core, questScope, questTurn } from "../../qm/qm-admin";
import { PORTS } from "../schema";
import { loadPalace } from "../routes";

const PROTOCOL_URL = (process.env.PROTOCOL_URL ?? `http://localhost:${PORTS.protocol}`).replace(/\/$/, "");
const QUEST_MCP = (process.env.QUEST_MCP_URL ?? "http://localhost:8792").replace(/\/$/, "");
// Every palace team agent (8 departments since 15:15), read from palace.json, not hard-coded.
const TEAMS = (() => {
  try {
    return loadPalace().agents.map((a) => a.id);
  } catch {
    return ["legal", "finance", "eng"];
  }
})();

async function up(): Promise<boolean> {
  try {
    const [a, b] = await Promise.all([
      fetch(`${QUEST_MCP}/quest-0/mcp`, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }), signal: AbortSignal.timeout(1500) }),
      fetch("http://localhost:8129/", { signal: AbortSignal.timeout(1500) }),
    ]);
    return a.ok && b.status < 500;
  } catch {
    return false;
  }
}

const getJson = async (path: string) => (await fetch(PROTOCOL_URL + path, { signal: AbortSignal.timeout(5000) })).json() as Promise<any>;
const postJson = (path: string, body: unknown) =>
  fetch(PROTOCOL_URL + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) }).then((r) => r.json() as Promise<any>);

export async function qmHooks(): Promise<QuestHooks> {
  if (!(await up())) {
    console.warn("QM harness unavailable (portal :8129 or quest MCP adapter down): quest runs on the protocol harness");
    return {};
  }
  return {
    harness: "qm",
    async onExecute({ info, route, replies }) {
      const scopeId = await questScope();
      if (!scopeId) throw new Error("no QM project named quest (bun qm/qm-admin.ts quest-setup)");
      const reg = await core("PUT", "/v1/admin/mcp-servers/quest-loci", { name: "Loci protocol (commissioned quest)", url: `${QUEST_MCP}/${info.agent}`, auth: "none", readOnly: false, enabled: true });
      if (reg.status >= 300) throw new Error(`register quest-loci: HTTP ${reg.status}`);
      const brief =
        `You are ${info.label} (${info.agent}), a commissioned agent at Acme Robotics. Task: ${info.task}\n` +
        `You explored the palace and trained in the Gym. Now execute your learned route, in order: ${route.join(" -> ")}.\n` +
        `For each station use your quest-loci_* tools only: call quest-loci_claim then quest-loci_visit. If a claim is refused ` +
        `(the room is owned by a team), call quest-loci_handoff to the owner named in the refusal (toAgent), with one specific ` +
        `question, and move on. Never skip a station. Do not call quest-loci_answer: when the route is walked, reply "route done".`;
      const res = await questTurn(scopeId, info.agent, brief);
      if (res.status >= 300) throw new Error(`QM turn: HTTP ${res.status} ${res.body.slice(0, 160)}`);
      console.log(`  [${info.agent}] QM turn started in ${scopeId}`);
      // Answer handoffs for the team agents while QM walks, until every route station has a verdict.
      const deadline = Date.now() + Number(process.env.QM_EXECUTE_TIMEOUT_MS ?? 120000);
      while (Date.now() < deadline) {
        for (const team of TEAMS) {
          const inbox = (await getJson(`/inbox?agent=${team}&run=${encodeURIComponent(info.run)}`)) as { id: string; from: string; memoryId: string; question: string }[];
          for (const h of inbox.filter((x) => x.from === info.agent)) {
            await postJson("/visit", { agent: team, memoryId: h.memoryId, question: h.question, run: info.run });
            const answer = replies.get(h.memoryId) ?? `See ${h.memoryId}.`;
            await postJson("/reply", { agent: team, id: h.id, answer, run: info.run });
          }
        }
        if (await walkedInRun2(info.run, info.agent, route)) return true;
        await Bun.sleep(1000);
      }
      throw new Error("QM execute timed out");
    },
  };
}

// Run 1 already left verdicts for every station, so "done" means run 2 (after the learned `route`
// event) touched every station again, through a visit or an answered handoff.
async function walkedInRun2(run: string, agent: string, route: string[]): Promise<boolean> {
  const text = await (await fetch(`${PROTOCOL_URL}/events.jsonl?run=${encodeURIComponent(run)}`)).text();
  const ev = text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  let start = -1;
  ev.forEach((e: any, i: number) => { if (e.agent === agent && e.type === "route" && e.source === "learned") start = i; });
  if (start < 0) return false;
  const after = ev.slice(start);
  const replied = new Set(after.filter((e: any) => e.type === "reply").map((e: any) => e.id));
  const touched = new Set(
    after.flatMap((e: any) => (e.agent === agent && e.type === "visit" ? [e.memoryId] : e.agent === agent && e.type === "handoff" && replied.has(e.id) ? [e.memoryId] : [])),
  );
  return route.every((id) => touched.has(id));
}


