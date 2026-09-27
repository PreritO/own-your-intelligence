// Loci protocol tools for QM agents, served as an MCP connector. This is a thin adapter: each protocol
// tool call becomes one HTTP call to the protocol service on :8790, and the result comes back unchanged.
// There is no protocol logic here. Ownership, claims, verdicts, grounding and the route gate are all
// enforced by the service. The adapter only knows the harness side: which QM scope is which agent, and
// which protocol run (and assigned route) a QM turn is bound to.
//
//   bun qm/loci-mcp.ts                     # :8791 (LOCI_MCP_PORT), PROTOCOL_URL defaults to http://localhost:8790
//
// Connectors (registered in QM by `bun qm/qm-admin.ts setup`; QM's MCP client POSTs JSON-RPC to `${url}/mcp`):
//   loci-<team>  -> http://localhost:8791/<team>   one per team agent scope (legal, finance, eng, ...)
//   loci-quest   -> http://localhost:8791/quest    every commissioned quest agent; the agent (quest-<n>)
//                                                  comes from the scope the fork passes in `_qm.scopeId`
// QM names the tools `<serverId>_<tool>`, e.g. `loci-finance_reply`, `loci-quest_visit`.
//
// Harness endpoints (not MCP):
//   POST /bind        {run, agent?, qmRunId?, threadRef?, route?, handoffId?}  bind a QM turn to a protocol run
//   GET  /bindings    current bindings
//   POST /grounding   {scopeId, agent?, threadRef?, text}  the fork's pre-post check; forwarded to
//                     POST :8790/grounding {agent, run, text, route} (see docs/NOTES-qm-multi.md, route gate)
//   GET  /<agent>/notes  what a quest agent submitted through reflect / write_page (read by server/commission/qm.ts)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadPalace } from "../server/routes";

const PORT = Number(process.env.LOCI_MCP_PORT ?? 8791);
const PROTOCOL_URL = (process.env.PROTOCOL_URL ?? "http://localhost:8790").replace(/\/$/, "");
const PREFIX = process.env.LOCI_TOOL_PREFIX ?? ""; // e.g. "/tools" if the service mounts tools there
const SHARED_RUN = process.env.LOCI_RUN ?? ""; // optional fixed protocol run id; default = bound run, else the service's current run
const ROOT = join(dirname(import.meta.path), "..");
export const SCOPES_FILE = process.env.LOCI_SCOPES_FILE ?? join(ROOT, "qm", "state", "scopes.json");
const QUEST_DIR = process.env.QUEST_DIR ?? join(ROOT, "server", "commission", "quests");

// ------------------------------------------------------------------------------------------ agents

const palace = () => loadPalace();
const TEAM_AGENTS = (() => {
  try {
    return new Set(palace().agents.map((a) => a.id));
  } catch {
    return new Set(["legal", "finance", "eng"]);
  }
})();
const isQuest = (a: string) => /^quest-\d+$/.test(a);

// scope -> agent: LOCI_SCOPES (env) + the scopes file (re-read every call; tiny) + channel:<team>.
function scopeAgent(scopeId: string | undefined): string | undefined {
  if (!scopeId) return undefined;
  let map: Record<string, string> = {};
  try {
    map = { ...JSON.parse(process.env.LOCI_SCOPES || "{}") };
  } catch {}
  try {
    if (existsSync(SCOPES_FILE)) Object.assign(map, JSON.parse(readFileSync(SCOPES_FILE, "utf8")));
  } catch {}
  if (map[scopeId]) return map[scopeId];
  return scopeId.startsWith("channel:") ? scopeId.slice(8) : undefined;
}

// ------------------------------------------------------------------------------------------ bindings

type Binding = { run: string; agent?: string; qmRunId?: string; threadRef?: string; route?: string[]; handoffId?: string; at: number };
const bindings: Binding[] = [];
const lastRun = new Map<string, string>(); // agent -> the protocol run of its latest tool result
const notes = new Map<string, Record<string, unknown>>(); // quest agent -> {plan, reflect, page}

function bind(b: Omit<Binding, "at">) {
  bindings.push({ ...b, at: Date.now() });
  if (bindings.length > 500) bindings.splice(0, bindings.length - 500);
}
const latest = (f: (b: Binding) => boolean) => [...bindings].reverse().find(f);
function runFor(agent: string, qmRunId?: string, threadRef?: string): Binding | undefined {
  return (
    (qmRunId && latest((b) => b.qmRunId === qmRunId)) ||
    (threadRef && latest((b) => b.threadRef === threadRef)) ||
    latest((b) => b.agent === agent && !b.qmRunId && !b.threadRef) ||
    latest((b) => b.agent === agent)
  );
}

// ------------------------------------------------------------------------------------------ tools

const str = (description: string) => ({ type: "string", description });
const ids = (description: string) => ({ type: "array", items: { type: "string" }, description });
const T = {
  visit: {
    name: "visit",
    description:
      "Walk to a station (memory id) on your route and read it. Returns the page and a verdict: verified, stale, or gap. Visit every station in order. Rooms you don't own are refused; use handoff instead.",
    inputSchema: {
      type: "object",
      properties: {
        memoryId: str("GBrain page slug, e.g. legal/gripworks-msa"),
        question: str("what you need from this page (optional; picks the evidence snippet)"),
        subtask: str("plan subtask id this visit serves (quest agents)"),
        evidence: str("the exact short snippet you will use (optional)"),
      },
      required: ["memoryId"],
    },
  },
  claim: {
    name: "claim",
    description: "Claim a station before working on it (a 30 s lease). If another agent holds it you get wait + heldBy; reuse its verdict or move on and come back. A room you don't own is refused with the owner to hand off to.",
    inputSchema: { type: "object", properties: { memoryId: str("station to claim") }, required: ["memoryId"] },
  },
  handoff: {
    name: "handoff",
    description: "Ask the agent that owns a room one specific question about a station you may not read. Returns a handoffId. The owner's QM agent is woken and answers with reply.",
    inputSchema: {
      type: "object",
      properties: { toAgent: str("the owning agent, as named in the refusal (e.g. finance)"), memoryId: str("the station in their room"), question: str("one specific question") },
      required: ["toAgent", "memoryId", "question"],
    },
  },
  reply: {
    name: "reply",
    description: "Answer a handoff that was sent to you. Claim and visit the station first: a reply must be grounded in your own verdict from this run.",
    inputSchema: { type: "object", properties: { handoffId: str("id from the handoff"), answer: str("your answer, only from the page you verified") }, required: ["handoffId", "answer"] },
  },
  answer: {
    name: "answer",
    description:
      "Post your final answer. Every citation must be a station you (or a handoff reply) verified in this run, or the answer is blocked. State every gap and stale station, and every station on your route you could not visit (as a gap).",
    inputSchema: {
      type: "object",
      properties: { text: str("the answer"), citations: ids("verified station ids") },
      required: ["text", "citations"],
    },
  },
  // ---- commissioned quest agents only
  plan: {
    name: "plan",
    description: "Post your plan for the task: 3-6 subtasks, each with a department and 1-2 station ids. Shown in the palace as the task breakdown.",
    inputSchema: {
      type: "object",
      properties: {
        label: str("2-3 word agent name ending in 'agent'"),
        note: str("one line: what the plan covers"),
        subtasks: {
          type: "array",
          items: {
            type: "object",
            properties: { id: str("s1, s2, ..."), title: str("short imperative"), department: str("wing id"), stations: ids("station ids") },
            required: ["id", "title", "stations"],
          },
        },
      },
      required: ["subtasks"],
    },
  },
  start_explore: {
    name: "start_explore",
    description: "Start run 1 (explore): declare the stations you will tour, in order (your plan's stations plus up to 3 you are unsure about).",
    inputSchema: { type: "object", properties: { stations: ids("station ids in walking order"), note: str("one line") }, required: ["stations"] },
  },
  await_replies: {
    name: "await_replies",
    description: "Wait (up to timeoutSeconds, max 60) until the given handoffs are answered. Returns each handoff's status, the owner's answer and its verdict.",
    inputSchema: { type: "object", properties: { handoffIds: ids("handoff ids"), timeoutSeconds: { type: "number" } }, required: ["handoffIds"] },
  },
  reflect: {
    name: "reflect",
    description: "After exploring: for each station you read (or got an answer about), say whether the deliverable will use it and the exact snippet (<= 25 words). This sets the Gym's station values.",
    inputSchema: {
      type: "object",
      properties: {
        stations: {
          type: "array",
          items: { type: "object", properties: { id: str("station id"), useful: { type: "boolean" }, evidence: str("snippet or empty") }, required: ["id", "useful"] },
        },
      },
      required: ["stations"],
    },
  },
  write_page: {
    name: "write_page",
    description: "Publish the deliverable as a Markdown page (start with '# <title>'; cite each fact inline as [[station-id]]; stale and missing sources go in a 'Still open' section). It goes on a lectern in the foyer.",
    inputSchema: { type: "object", properties: { markdown: str("the page") }, required: ["markdown"] },
  },
} as const;
const TEAM_TOOLS = [T.visit, T.claim, T.handoff, T.reply, T.answer];
const QUEST_TOOLS = [T.plan, T.start_explore, T.claim, T.visit, T.handoff, T.await_replies, T.reflect, T.write_page, T.answer];
const toolsFor = (agent: string) => (isQuest(agent) || agent === "quest" ? QUEST_TOOLS : TEAM_TOOLS);

// ------------------------------------------------------------------------------------------ protocol calls

async function proto(method: "GET" | "POST", path: string, body?: Record<string, unknown>) {
  const res = await fetch(`${PROTOCOL_URL}${PREFIX}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {}
  return { ok: res.ok, status: res.status, text, data };
}

const result = (text: string, isError = false) => ({ content: [{ type: "text", text }], isError });
const fromProto = (agent: string, r: Awaited<ReturnType<typeof proto>>) => {
  const run = r.data?.event?.run ?? r.data?.run;
  if (run) lastRun.set(agent, run);
  // A refusal or a blocked answer is protocol feedback the agent must see, so it comes back as a tool
  // result with isError set, not as a transport error.
  return result(r.text || `HTTP ${r.status}`, !r.ok || r.data?.blocked === true);
};

function slugFor(title: string): string {
  return (title.toLowerCase().match(/[a-z0-9]+/g) ?? ["quest"]).filter((w) => !["a", "an", "the", "for", "of", "and", "to"].includes(w)).slice(0, 5).join("-") || "quest";
}

function foyerSpot(n: number): [number, number, number] {
  const p = palace();
  const foyer = p.rooms.find((r) => r.id === "foyer")!;
  const taken = p.memories.filter((m) => m.room === "foyer").map((m) => m.pos);
  for (let k = 0; k < 16; k++) {
    const a = ((n - 1 + k) % 8) * (Math.PI / 4) + Math.PI / 8;
    const pos: [number, number, number] = [Math.round((foyer.center[0] + 3.5 * Math.cos(a)) * 100) / 100, 1.1, Math.round((foyer.center[2] + 3.5 * Math.sin(a)) * 100) / 100];
    if (taken.every((q) => Math.hypot(q[0] - pos[0], q[2] - pos[2]) > 1.2)) return pos;
  }
  return [foyer.center[0] + 3.5, 1.1, foyer.center[2]];
}

async function callTool(pathAgent: string, name: string, args: Record<string, unknown>) {
  const { _qm, ...a } = args as { _qm?: { scopeId?: string; runId?: string } } & Record<string, any>;
  const fromScope = scopeAgent(_qm?.scopeId);
  const agent = pathAgent === "quest" ? fromScope : fromScope ?? pathAgent;
  if (!agent) return result(`[adapter] cannot tell which quest agent this scope is (${_qm?.scopeId ?? "no scope passed"}); is it in ${SCOPES_FILE}?`, true);
  if (!toolsFor(agent).some((t) => t.name === name)) return result(`[adapter] ${agent} has no tool ${name}`, true);
  const b = runFor(agent, _qm?.runId);
  const run = b?.run || SHARED_RUN || undefined;
  const R = run ? { run } : {};
  console.log(`→ ${agent}.${name}(${JSON.stringify(a).slice(0, 160)}) run=${run ?? "(current)"}${_qm?.runId ? ` qm=${_qm.runId}` : ""}`);
  const post = (path: string, body: Record<string, unknown>) => proto("POST", path, { agent, ...body, ...R, ...(_qm?.runId ? { qmRunId: _qm.runId } : {}) });

  switch (name) {
    case "visit":
      return fromProto(agent, await post("/visit", { memoryId: a.memoryId, question: a.question, subtask: a.subtask, evidence: a.evidence }));
    case "claim":
      return fromProto(agent, await post("/claim", { memoryId: a.memoryId }));
    case "handoff":
      return fromProto(agent, await post("/handoff", { memoryId: a.memoryId, question: a.question, toAgent: a.toAgent }));
    case "reply": {
      // Provenance label: this reply came from the owner's QM agent, not the orchestrator.
      const answer = `${String(a.answer ?? "").trim()} (replied by QM ${agent} agent)`;
      return fromProto(agent, await post("/reply", { id: a.handoffId ?? a.id, answer }));
    }
    case "answer":
      return fromProto(agent, await post("/answer", { text: a.text, citations: a.citations ?? [] }));
    case "plan": {
      const subtasks = (a.subtasks ?? []) as { id: string; title: string; department?: string; stations?: string[] }[];
      notes.set(agent, { ...(notes.get(agent) ?? {}), plan: { label: a.label, subtasks } });
      const depts = [...new Set(subtasks.map((s) => s.department).filter(Boolean))];
      const note = `QM ${agent} (claude-sonnet-5): ${a.note ? `${a.note}; ` : ""}${subtasks.length} subtasks across ${depts.join(", ")}`;
      return fromProto(agent, await post("/phase", { phase: "plan", note, subtasks }));
    }
    case "start_explore": {
      const stations = (a.stations ?? []) as string[];
      const ph = await post("/phase", { phase: "explore", note: `run 1: touring ${stations.length} stations${a.note ? ` (${a.note})` : ""}` });
      if (!ph.ok) return fromProto(agent, ph);
      const r = await post("/route", { routeId: `explore-${agent}`, stations, source: "explore" });
      if (r.ok) bind({ run: run ?? r.data?.event?.run, agent, ...(_qm?.runId ? { qmRunId: _qm.runId } : {}), route: stations });
      return fromProto(agent, r);
    }
    case "await_replies": {
      const want = ((a.handoffIds ?? []) as string[]).map(String);
      const deadline = Date.now() + Math.min(60, Math.max(1, Number(a.timeoutSeconds ?? 45))) * 1000;
      let statuses: any[] = [];
      for (;;) {
        statuses = await Promise.all(want.map(async (id) => (await proto("GET", `/handoff?id=${encodeURIComponent(id)}${run ? `&run=${encodeURIComponent(run)}` : ""}`)).data ?? { id, error: "unknown" }));
        if (statuses.every((s) => s?.answered) || Date.now() > deadline) break;
        await Bun.sleep(1500);
      }
      const open = statuses.filter((s) => !s?.answered).map((s) => s?.id);
      return result(JSON.stringify({ allAnswered: !open.length, open, handoffs: statuses }));
    }
    case "reflect": {
      notes.set(agent, { ...(notes.get(agent) ?? {}), reflect: a.stations ?? [] });
      return result(JSON.stringify({ ok: true, recorded: (a.stations ?? []).length, note: "The Gym trains on this next. End this turn now." }));
    }
    case "write_page": {
      const md = String(a.markdown ?? "").trim();
      if (!md.startsWith("#")) return result("[adapter] the page must start with '# <title>'", true);
      const title = md.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "Quest page";
      const slug = slugFor(title);
      const n = Number(agent.split("-")[1] ?? 1);
      const cites = [...new Set([...md.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1]!.trim()))];
      mkdirSync(QUEST_DIR, { recursive: true });
      const file = join(QUEST_DIR, `${agent}-${slug}.md`);
      writeFileSync(file, `---\ntitle: ${title}\ntype: artifact\nwritten_by: ${agent}\nharness: qm\ncitations: ${JSON.stringify(cites)}\n---\n\n${md}\n`);
      const excerpt = md.replace(/^#.*$/m, "").replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, "").replace(/[#*_>`-]/g, "").replace(/\s+/g, " ").trim().slice(0, 180);
      const memory = { id: `quests/${slug}`, title, type: "artifact", room: "foyer", pos: foyerSpot(n), freshness: 1, excerpt, path: `quests/${slug}.md` };
      notes.set(agent, { ...(notes.get(agent) ?? {}), page: { memory, file, citations: cites } });
      await post("/move", { to: "foyer" });
      const r = await post("/artifact", { memory });
      return r.ok ? result(JSON.stringify({ ok: true, memoryId: memory.id, citedInPage: cites, next: "Now call answer with the verified stations the page cites, and state every gap and stale station." })) : fromProto(agent, r);
    }
  }
  return result(`[adapter] unknown tool ${name}`, true);
}

// ------------------------------------------------------------------------------------------ server

type Rpc = { jsonrpc: "2.0"; id?: number | string | null; method: string; params?: Record<string, unknown> };
const ok = (id: Rpc["id"], res: unknown) => Response.json({ jsonrpc: "2.0", id: id ?? null, result: res });
const err = (id: Rpc["id"], code: number, message: string) => Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function grounding(body: { scopeId?: string; agent?: string; threadRef?: string; text?: string }) {
  const agent = scopeAgent(body.scopeId) ?? body.agent;
  if (!agent) return Response.json({ verdict: "block", reason: `scope ${body.scopeId} is not a loci agent` });
  const b = runFor(agent, undefined, body.threadRef);
  const run = b?.run || SHARED_RUN || lastRun.get(agent);
  const r = await proto("POST", "/grounding", { agent, text: body.text, ...(run ? { run } : {}), ...(b?.route ? { route: b.route } : {}) });
  console.log(`⚖ grounding ${agent} run=${run ?? "(current)"}: ${r.data?.verdict ?? r.status}${r.data?.reason ? ` (${r.data.reason})` : ""}`);
  if (!r.ok) return Response.json({ verdict: "block", reason: `protocol /grounding HTTP ${r.status}: ${r.text.slice(0, 200)}` });
  return Response.json(r.data);
}

if (import.meta.main) {
  Bun.serve({
    port: PORT,
    idleTimeout: 120, // await_replies may hold a request for up to 60 s
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/bind" && req.method === "POST") {
        const b = (await req.json()) as Omit<Binding, "at">;
        if (!b.run) return Response.json({ ok: false, error: "run required" }, { status: 400 });
        bind(b);
        console.log(`⇄ bind ${JSON.stringify(b)}`);
        return Response.json({ ok: true });
      }
      if (url.pathname === "/bindings") return Response.json(bindings);
      if (url.pathname === "/grounding" && req.method === "POST") return grounding((await req.json()) as any);
      const nm = url.pathname.match(/^\/([\w-]+)\/notes\/?$/);
      if (nm) return Response.json(notes.get(nm[1]!) ?? {});
      const m = url.pathname.match(/^\/([\w-]+)\/mcp\/?$/);
      if (!m) return new Response("POST /<agent>/mcp | /quest/mcp | /bind | /grounding\n", { status: 404 });
      const agent = m[1]!;
      if (!TEAM_AGENTS.has(agent) && agent !== "quest" && !isQuest(agent)) return new Response(`unknown agent ${agent}\n`, { status: 404 });
      if (req.method !== "POST") return new Response(null, { status: 405 });
      let rpc: Rpc;
      try {
        rpc = (await req.json()) as Rpc;
      } catch {
        return err(null, -32700, "parse error");
      }
      if (rpc.id === undefined) return new Response(null, { status: 202 }); // notification
      switch (rpc.method) {
        case "initialize":
          return ok(rpc.id, { protocolVersion: (rpc.params?.protocolVersion as string) ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: `loci-${agent}`, version: "0.2.0" } });
        case "ping":
          return ok(rpc.id, {});
        case "tools/list":
          return ok(rpc.id, { tools: toolsFor(agent) });
        case "tools/call": {
          const name = String(rpc.params?.name ?? "");
          try {
            return ok(rpc.id, await callTool(agent, name, (rpc.params?.arguments as Record<string, unknown>) ?? {}));
          } catch (e) {
            return ok(rpc.id, result(`protocol service unreachable: ${(e as Error).message}`, true));
          }
        }
        default:
          return err(rpc.id, -32601, `method not found: ${rpc.method}`);
      }
    },
  });
  console.log(`loci MCP adapter on http://localhost:${PORT}/<team|quest>/mcp -> ${PROTOCOL_URL}${PREFIX}/<tool> (scopes: ${SCOPES_FILE})`);
}
