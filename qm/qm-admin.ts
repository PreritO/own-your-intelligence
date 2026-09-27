// Dev helper for a local QM instance (node scripts/dev/cli.ts up). It signs core admin calls the same way
// QM's admin plugin does, sends turns through the portal, and runs the multiplayer demo.
//
//   bun qm/qm-admin.ts setup                    # team projects (legal/finance/eng) + loci-<team> and loci-quest
//                                               #   connectors + the scope map in qm/state/scopes.json
//   bun qm/qm-admin.ts scopes | servers
//   bun qm/qm-admin.ts demo [--record <name>] [agent...]
//        # the 3 demo tasks, one per team QM scope, in one fresh protocol run. The harness assigns each
//        # route (protocol task + route events), handoffs wake the owning team's QM agent (qm/handoffs.ts),
//        # and --record cuts the run to fixtures/replays/<name>.jsonl.
//   bun qm/qm-admin.ts turn legal "Can we sign the Gripworks contract this week?"
//   bun qm/qm-admin.ts run <runId>              # poll a QM run
//
// Env: QM_CORE_URL (:8081), QM_PORTAL_URL (:8129), LOCI_MCP_URL (:8791, what the connectors point at),
// PROTOCOL_URL (:8790), QM_TEAMS (legal,finance,eng).
//
// Core admin routes need source-auth (HMAC over "METHOD\npath\nbody" with CORE_SIGNING_SECRET). The dev
// instance derives that secret itself and doesn't write it anywhere. Take it from CORE_SIGNING_SECRET, or
// read it from the environment of the local core process (listening on the core port). It is never printed.
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pickRoute } from "../server/routes";
import { PalaceEvent } from "../server/schema";

const CORE = process.env.QM_CORE_URL ?? "http://localhost:8081";
const PORTAL = process.env.QM_PORTAL_URL ?? "http://localhost:8129";
const ORG = process.env.QM_ORG ?? "acme";
export const ADMIN = process.env.QM_ADMIN_PRINCIPAL ?? process.env.USER ?? "dev-admin";
const LOCI_MCP = (process.env.LOCI_MCP_URL ?? "http://localhost:8791").replace(/\/$/, "");
const PROTOCOL_URL = (process.env.PROTOCOL_URL ?? "http://localhost:8790").replace(/\/$/, "");
const AGENTS = (process.env.QM_TEAMS ?? "legal,finance,eng").split(",").map((s) => s.trim()).filter(Boolean);
const ROOT = join(dirname(import.meta.path), "..");
const SCOPES_FILE = process.env.LOCI_SCOPES_FILE ?? join(ROOT, "qm", "state", "scopes.json");

let secret: string | undefined;
function coreSecret(): string {
  if (secret) return secret;
  if (process.env.CORE_SIGNING_SECRET) return (secret = process.env.CORE_SIGNING_SECRET);
  const port = new URL(CORE).port || "80";
  const pids = Bun.spawnSync(["lsof", "-tiTCP:" + port, "-sTCP:LISTEN"]).stdout.toString().trim().split("\n").filter(Boolean);
  for (const pid of pids) {
    const env = Bun.spawnSync(["ps", "eww", "-o", "command=", "-p", pid]).stdout.toString();
    const m = env.match(/\bCORE_SIGNING_SECRET=(\S+)/);
    if (m) return (secret = m[1]!);
  }
  throw new Error(`CORE_SIGNING_SECRET not set and not found on the core process at ${CORE}`);
}

export async function core(method: string, path: string, body?: unknown) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000);
  const sig = "v0=" + createHmac("sha256", coreSecret()).update(`v0:${ts}:${method}\n${path}\n${raw}`).digest("hex");
  const res = await fetch(CORE + path, {
    method,
    headers: { "content-type": "application/json", "x-timestamp": String(ts), "x-signature": sig, "x-admin-actor": `${ADMIN}@${ORG}` },
    ...(raw ? { body: raw } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

export async function portal(method: string, path: string, body?: unknown) {
  const res = await fetch(PORTAL + path, {
    method,
    headers: { "content-type": "application/json", origin: PORTAL },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.text() };
}

export async function portalUp(): Promise<boolean> {
  try {
    return (await fetch(PORTAL + "/", { signal: AbortSignal.timeout(1500) })).status < 500;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------------------------------ scopes

// QM projects by name -> scope id (group:web-project-<id>). Each project is one agent's scope: its own
// memory, files and sandbox.
export async function projects(): Promise<Record<string, string>> {
  const r = await core("GET", `/v1/projects?principalId=${encodeURIComponent(ADMIN)}`);
  const list = (JSON.parse(r.body).projects ?? []) as { name: string; scopeId: string }[];
  const out: Record<string, string> = {};
  for (const p of list) if (!out[p.name]) out[p.name] = p.scopeId;
  return out;
}

export async function teamScopes(): Promise<Record<string, string>> {
  const all = await projects();
  return Object.fromEntries(Object.entries(all).filter(([name]) => AGENTS.includes(name)));
}

export async function ensureProject(name: string): Promise<string> {
  const have = (await projects())[name];
  if (have) return have;
  const r = await portal("POST", "/api/projects", { name });
  if (r.status >= 300) throw new Error(`create QM project ${name}: HTTP ${r.status} ${r.body.slice(0, 160)}`);
  const id = (await projects())[name];
  if (!id) throw new Error(`QM project ${name} created but not listed`);
  return id;
}

// The scope map the fork (src/mindpalace/loci-scopes.ts) and the adapter read: {"<scopeId>": "<agent>"}.
export function bindScope(scopeId: string, agent: string) {
  mkdirSync(dirname(SCOPES_FILE), { recursive: true });
  const map = existsSync(SCOPES_FILE) ? (JSON.parse(readFileSync(SCOPES_FILE, "utf8")) as Record<string, string>) : {};
  for (const [k, v] of Object.entries(map)) if (v === agent && k !== scopeId) delete map[k];
  map[scopeId] = agent;
  writeFileSync(SCOPES_FILE, JSON.stringify(map, null, 2) + "\n");
}

async function registerConnector(id: string, name: string, url: string) {
  const r = await core("PUT", `/v1/admin/mcp-servers/${id}`, { name, url, auth: "none", readOnly: false, enabled: true });
  const tools = r.status === 200 ? (JSON.parse(r.body).tools ?? []).join(",") : r.body.slice(0, 200);
  console.log(`connector ${id} -> ${url}: HTTP ${r.status} tools=${tools}`);
  return r.status < 300;
}

async function registerConnectors() {
  for (const a of AGENTS) await registerConnector(`loci-${a}`, `Loci protocol (${a})`, `${LOCI_MCP}/${a}`);
  await registerConnector("loci-quest", "Loci protocol (commissioned quests)", `${LOCI_MCP}/quest`);
}

// ------------------------------------------------------------------------------------------ turns

export async function sendTurn(scopeId: string, channelName: string, text: string, threadRef = `web:${ADMIN}:${channelName}-${Date.now()}`) {
  const r = await portal("POST", "/api/turn", { text, threadRef, scopeId, channelName });
  const runId = r.status < 300 ? (JSON.parse(r.body).runId as string | undefined) : undefined;
  return { status: r.status, body: r.body, runId, threadRef };
}

export async function qmRun(runId: string): Promise<any> {
  const r = await portal("GET", `/api/runs/${encodeURIComponent(runId)}`);
  try {
    return JSON.parse(r.body);
  } catch {
    return { status: r.status };
  }
}

// Done = the QM run left the running/queued states.
export async function waitQmRun(runId: string, timeoutMs: number): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await qmRun(runId);
    const st = String(r?.run?.status ?? r?.status ?? "");
    if (st && !/^(running|queued|pending|started|accepted|in_progress|\d+)$/.test(st)) return r;
    if (Date.now() > deadline) return { ...r, timedOut: true };
    await Bun.sleep(2000);
  }
}

// Legacy quest harness (server/commission/qm.ts run 2): one QM project named "quest".
export async function questScope(): Promise<string | undefined> {
  return (await projects())["quest"];
}
export async function questTurn(scopeId: string, agent: string, text: string) {
  return portal("POST", "/api/turn", { text, threadRef: `web:${ADMIN}:${agent}-${Date.now()}`, scopeId, channelName: "quest" });
}

// Messages QM delivered into a web session (recorded deliveries: what the user sees after the fork's check).
export async function deliveredTexts(sessionId: string): Promise<string[]> {
  const r = await portal("GET", `/api/sessions/${encodeURIComponent(sessionId)}`);
  try {
    const entries = (JSON.parse(r.body).entries ?? []) as { type: string; payload?: { text?: string; deliveryKey?: string } }[];
    return entries.filter((e) => e.type === "assistant" && e.payload?.deliveryKey && e.payload.text).map((e) => e.payload!.text!);
  } catch {
    return [];
  }
}

const TASKS: Record<string, string> = {
  legal: "Can we sign the Gripworks contract this week?",
  finance: "What did we promise Ada in the last board meeting?",
  eng: "Who owns the SOC 2 renewal?",
};

// Loci protocol step 1: the harness picks the route (learned -> fallback -> explore), records it with the
// service (task + route events, so the route gate knows what was assigned) and hands it to the agent.
export function teamBrief(agent: string, task: string, stations: string[], source: string, routeId: string): string {
  return (
    `You are the ${agent} team agent at Acme Robotics (a seeded fake company). Task: ${task}\n` +
    `Your assigned route (${source} route ${routeId}), in order: ${stations.join(" -> ")}.\n` +
    `Follow the loci protocol with your loci-${agent}_* tools only. For each station, in order: loci-${agent}_claim then ` +
    `loci-${agent}_visit. Never skip a station. If a room is refused, call loci-${agent}_handoff to the owner named in the ` +
    `refusal with one specific question, and move on; the owner's agent replies through the protocol, and its verdict counts ` +
    `for you once it has replied. When the route is walked, call loci-${agent}_answer citing only verified stations (a ` +
    `station you handed off counts once its owner has replied: if the answer is blocked because a handoff is still open, wait ` +
    `briefly and answer again). State every gap and stale station, and any station you could not visit, as a gap. Never ` +
    `invent content for a gap. Finally, post your answer to this conversation with the web tool (action "post", only ` +
    `"text"; no ts, channel or recipient). The harness runs its grounding check before it is delivered. Then finish.`
  );
}

async function protoPost(path: string, body: unknown) {
  const r = await fetch(PROTOCOL_URL + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await r.json().catch(() => ({}))) as any;
  if (r.status >= 300) throw new Error(`${path}: HTTP ${r.status} ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}
async function runEvents(run: string): Promise<any[]> {
  const t = await (await fetch(`${PROTOCOL_URL}/events.jsonl?run=${encodeURIComponent(run)}`)).text();
  return t.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// Cut a protocol run into a replay fixture: rebased to t=0, run renamed, every line schema-checked.
export async function recordRun(run: string, name: string): Promise<string> {
  const raw = await runEvents(run);
  const t0 = raw[0]?.t ?? 0;
  let last = 0;
  const lines = raw.map((o) => {
    const t = Math.max(last, Math.round((o.t - t0) * 100) / 100);
    last = t;
    return JSON.stringify(PalaceEvent.parse({ ...o, t, run: name }));
  });
  const file = join(ROOT, "fixtures", "replays", `${name}.jsonl`);
  writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

async function demo(args: string[]) {
  const flag = (name: string) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : undefined);
  const record = flag("--record");
  // Route-gate tests. The protocol is given the full assigned route, but the agent's brief leaves one
  // station out, as if the agent skipped it:
  //   --skip <station>       the agent never hears of it: its answer skips a route station, unstated
  //   --skip-gap <station>   the agent is told the station is unavailable and must state it as a gap
  const skip = flag("--skip") ?? flag("--skip-gap");
  const skipAsGap = !!flag("--skip-gap");
  const who = args.filter((a, i) => !a.startsWith("--") && !["--record", "--skip", "--skip-gap"].includes(args[i - 1] ?? ""));
  const agents = who.length ? who : ["legal", "finance", "eng"];
  const scopes = await teamScopes();
  for (const a of agents) if (!scopes[a]) throw new Error(`no QM project named ${a}; run: bun qm/qm-admin.ts setup`);
  const { HandoffRelay, adapterBind } = await import("./handoffs");
  const run = `qm-demo-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
  await protoPost("/run", { run });
  console.log(`protocol run ${run}`);
  const relay = new HandoffRelay({ portal, principal: ADMIN, scopes: teamScopes, accept: (h) => h.run === run });
  await relay.follow(run);
  const turns: { agent: string; runId?: string }[] = [];
  await Promise.all(
    agents.map(async (a) => {
      const task = TASKS[a] ?? a;
      const route = pickRoute(task);
      await protoPost("/task", { agent: a, text: task, run });
      await protoPost("/route", { agent: a, routeId: route.routeId, stations: route.stations, source: route.source, run });
      const threadRef = `web:${ADMIN}:loci-${a}-${Date.now()}`;
      await adapterBind({ run, agent: a, threadRef, route: route.stations });
      const skipping = !!skip && route.stations.includes(skip);
      let text = teamBrief(a, task, skipping ? route.stations.filter((s) => s !== skip) : route.stations, route.source, route.routeId);
      if (skipping && skipAsGap)
        text += `\n\nNote: ${skip} is on your route but unavailable today. Do not claim or visit it; state it in your answer as a gap ("${skip}: gap, not visited").`;
      if (skipping) text += `\n\nCall answer once, and post your answer with the web tool even if the answer call is blocked.`;
      const t = await sendTurn(scopes[a]!, a, text, threadRef);
      if (t.runId) await adapterBind({ run, agent: a, threadRef, qmRunId: t.runId, route: route.stations });
      console.log(`${a} (${scopes[a]}): HTTP ${t.status} QM run ${t.runId ?? t.body.slice(0, 200)}`);
      turns.push({ agent: a, runId: t.runId });
    }),
  );
  // Wait for every agent's QM turn to finish (they answer through the protocol and post in QM).
  const results = await Promise.all(turns.map(async (t) => ({ ...t, res: t.runId ? await waitQmRun(t.runId, Number(process.env.QM_DEMO_TIMEOUT_MS ?? 480000)) : null })));
  const outcomes = await relay.settled();
  relay.stop();
  const ev = await runEvents(run);
  await Bun.sleep(4000); // let QM drain the web deliveries into the transcripts
  console.log("\n== QM turns (what QM delivered after the fork's pre-post grounding check)");
  for (const r of results) {
    const sid = r.res?.result?.sessionId as string | undefined;
    const posted = sid ? await deliveredTexts(sid) : [];
    console.log(`  ${r.agent}: ${r.res?.timedOut ? "TIMED OUT" : r.res?.status ?? "?"}${posted.length ? "" : " (nothing delivered)"}`);
    for (const p of posted) console.log(`    posted: ${p.replace(/\s+/g, " ").slice(0, 220)}`);
  }
  console.log("== handoffs");
  for (const o of outcomes) console.log(`  ${o.id} ${o.agent} -> ${o.toAgent} ${o.memoryId}: ${o.source} after ${(o.ms / 1000).toFixed(1)} s: ${o.answer?.slice(0, 140)}`);
  console.log("== answers");
  for (const e of ev.filter((e) => e.type === "answer")) console.log(`  ${e.agent} t=${e.t}${e.blocked ? " BLOCKED" : ""} cites ${e.citations.join(", ")}${e.gaps ? ` gaps ${e.gaps.join(", ")}` : ""}`);
  if (record) console.log(`recorded ${await recordRun(run, record)}`);
}

// ------------------------------------------------------------------------------------------ CLI

const [cmd, ...args] = import.meta.main ? process.argv.slice(2) : ["--imported"];
if (cmd === "--imported") {
  // imported as a module: no CLI
} else if (cmd === "setup") {
  for (const a of AGENTS) bindScope(await ensureProject(a), a);
  console.log("scopes:", JSON.stringify(await teamScopes()));
  console.log(`scope map: ${SCOPES_FILE}`);
  await registerConnectors();
} else if (cmd === "register") {
  await registerConnectors();
} else if (cmd === "scopes") {
  console.log(JSON.stringify(await teamScopes(), null, 2));
} else if (cmd === "servers") {
  const r = await core("GET", "/v1/admin/mcp-servers");
  console.log(r.status, r.body);
} else if (cmd === "core" && args[0] && args[1]) {
  const r = await core(args[0], args[1], args[2] ? JSON.parse(args[2]) : undefined);
  console.log(r.status, r.body);
} else if (cmd === "portal" && args[0] && args[1]) {
  const r = await portal(args[0], args[1], args[2] ? JSON.parse(args[2]) : undefined);
  console.log(r.status, r.body);
} else if (cmd === "turn" && args[0] && args[1]) {
  const scopeId = (await teamScopes())[args[0]];
  if (!scopeId) throw new Error(`no QM project named ${args[0]}; run: bun qm/qm-admin.ts setup`);
  const t = await sendTurn(scopeId, args[0], args[1]);
  console.log(`${args[0]} (${scopeId}): HTTP ${t.status} ${t.body.slice(0, 300)}`);
} else if (cmd === "demo") {
  await demo(args);
} else if (cmd === "record" && args[0] && args[1]) {
  console.log(await recordRun(args[0], args[1]));
} else if (cmd === "run" && args[0]) {
  console.log(JSON.stringify(await qmRun(args[0]), null, 2));
} else {
  console.error(
    'usage: bun qm/qm-admin.ts setup | register | scopes | servers | demo [--record <name>] [agent...] | turn <team> "<text>" | run <runId> | record <run> <name> | core|portal <METHOD> <path> [json]',
  );
  process.exit(1);
}
