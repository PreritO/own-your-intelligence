// Commissioned quests: a user task spawns a new agent that tours the departments, trains in the Gym,
// comes back to execute on the learned route, writes the deliverable page and reports.
//
//   bun server/commission/quest.ts "Create an onboarding page for new engineers"   # standalone
//   POST :8788/commission {task}                                                     # via the bridge
//
// Every step goes through the loci protocol service (:8790): the service enforces ownership, claims,
// verdicts and grounding, and it is the single event source (the bridge follows its /events). This
// file holds orchestration only: pacing, the Claude planner / team replies / writer, and the Gym.
//
// Lifecycle: spawn -> phase plan (subtasks) -> phase explore (route source explore; visits, refusals,
// handoffs to legal/finance/eng, whose Claude replies read only the page they verified) -> phase gym
// (move to room-gym, train_step stream, learned route recorded in fixtures/learned-routes.json) ->
// phase execute (route source learned, fewer hops) -> artifact (Markdown page, quests/<slug>) ->
// answer (citations = the stations whose evidence the page used; must pass /grounding) -> phase done.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Memory, Palace } from "../schema";
import { PORTS } from "../schema";
import { loadPalace, recordRoute, tokens } from "../routes";
import { claude, MODEL, parseJson } from "./claude";
import { train, type GymStation } from "./gym";

const PROTOCOL_URL = (process.env.PROTOCOL_URL ?? `http://localhost:${PORTS.protocol}`).replace(/\/$/, "");
export const QUEST_DIR = process.env.QUEST_DIR ?? join(dirname(import.meta.path), "quests");
const PACE = Number(process.env.QUEST_PACE ?? 1); // >1 = slower walking
const WALK_MPS = 5; // avatar BASE_SPEED in web/src/agents/avatar.ts
const COLORS = ["#ff7eb6", "#2ac3de", "#ff9e64", "#f7768e", "#73daca", "#c0caf5"]; // not a team colour
// Team agents and department labels come from palace.json (8 departments since 15:15), never a hard-coded list.
function teamLabel(p: Palace, team: string): string {
  const a = p.agents.find((x) => x.team === team || x.id === team);
  return a?.label.replace(/\s+agent$/i, "") ?? p.wings.find((w) => w.id === team)?.label ?? team[0]!.toUpperCase() + team.slice(1);
}
const departmentsOf = (p: Palace) => p.wings.map((w) => w.id);
const wingOfRoom = (p: Palace, room: string) => p.rooms.find((r) => r.id === room)?.wing ?? "foyer";

// fixtures/quests.json (seed-v2): the company's cross-department quests. POST /commission {questId}.
export type QuestDef = { id: string; title: string; prompt: string; departments?: string[]; expectedGaps?: string[] };
export const QUESTS_FILE = process.env.QUESTS_FILE ?? join(dirname(import.meta.path), "..", "..", "fixtures", "quests.json");
export function loadQuests(): QuestDef[] {
  if (!existsSync(QUESTS_FILE)) return [];
  const raw = JSON.parse(readFileSync(QUESTS_FILE, "utf8"));
  const list = (Array.isArray(raw) ? raw : raw.quests ?? []) as QuestDef[];
  return list.filter((q) => q && typeof q.id === "string" && typeof q.prompt === "string");
}
export const findQuest = (id: string) => loadQuests().find((q) => q.id === id || `quest-${q.id}` === id) ?? null;

export type QuestHarness = "protocol" | "qm";
export type QuestInfo = { agent: string; run: string; label: string; task: string; harness: QuestHarness; questId?: string };
type Subtask = { id: string; title: string; department?: string; stations?: string[] };
type Plan = { label?: string; subtasks: Subtask[]; maybe: { id: string; subtask: string }[]; source: "claude" | "fallback" };
type Seen = { id: string; subtask: string; verdict: "verified" | "stale" | "gap"; via: "visit" | "handoff"; text: string; evidence?: string; team?: string; question?: string };

const sleep = (s: number) => Bun.sleep(Math.max(0, s * PACE * 1000));
let active: QuestInfo | null = null;
export const activeQuest = () => active;

// ------------------------------------------------------------------------------------ protocol client

class Proto {
  constructor(public run: string) {}
  async post(path: string, body: Record<string, unknown>): Promise<{ status: number; data: any }> {
    const res = await fetch(PROTOCOL_URL + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, run: this.run }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }
  async must(path: string, body: Record<string, unknown>) {
    const r = await this.post(path, body);
    if (r.status >= 300) throw new Error(`${path} ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
    return r.data;
  }
}

// ------------------------------------------------------------------------------------ helpers

const VERBS = new Set("create make write draft build prepare put together produce set up assemble compile design plan page doc document new".split(" "));
export function labelFor(task: string): string {
  const w = tokens(task).find((t) => !VERBS.has(t)) ?? "quest";
  return w[0]!.toUpperCase() + w.slice(1) + " agent";
}
export function slugFor(task: string): string {
  const w = tokens(task).filter((t) => !["create", "make", "write", "draft", "build", "prepare"].includes(t));
  return (w.slice(0, 5).join("-") || "quest").replace(/[^a-z0-9-]/g, "");
}

function nextQuestNumber(): number {
  if (!existsSync(QUEST_DIR)) return 1;
  const ns = readdirSync(QUEST_DIR).map((f) => Number(/^quest-(\d+)/.exec(f)?.[1] ?? 0));
  return Math.max(0, ...ns) + 1;
}

function roomDistance(p: Palace, a: string | undefined, b: string): number {
  const A = p.rooms.find((r) => r.id === a), B = p.rooms.find((r) => r.id === b);
  if (!A || !B || a === b) return 0;
  // Rooms connect through the foyer or a neighbour: Manhattan distance is a fair walking estimate.
  return Math.abs(A.center[0] - B.center[0]) + Math.abs(A.center[2] - B.center[2]);
}

function departmentsDigest(p: Palace): string {
  const out: string[] = [];
  for (const r of p.rooms) {
    const mems = p.memories.filter((m) => m.room === r.id);
    if (!mems.length) continue;
    const who = r.owner === "shared" ? "shared (anyone may read)" : `owned by the ${r.owner} team agent (hand off)`;
    out.push(`## ${r.label} [${r.id}], ${who}`);
    for (const m of mems) out.push(`- ${m.id}: ${m.title}. ${m.excerpt.slice(0, 110)}${m.freshness < 0.3 ? " (stale)" : ""}`);
  }
  return out.join("\n");
}

// ------------------------------------------------------------------------------------ plan

async function plan(task: string, p: Palace, quest?: QuestDef | null): Promise<Plan> {
  const ids = new Set(p.memories.map((m) => m.id));
  const system =
    "You are a newly commissioned agent at Acme Robotics. The company's knowledge lives in a memory palace: " +
    "departments are rooms, pages are stations. Plan which departments and stations the task needs. " +
    "Reply with JSON only.";
  const user =
    `Task: ${task}\n\nDepartments and stations:\n${departmentsDigest(p)}\n\n` +
    `Return JSON: {"label": "<2-3 word agent name ending in 'agent'>", "subtasks": [{"id": "s1", "title": "<short imperative>", ` +
    `"department": "${departmentsOf(p).join("|")}", "stations": ["<station id>", ...]}], "maybe": [{"id": "<station id>", "subtask": "s1"}]}\n` +
    `Rules: 3-6 subtasks, 1-2 stations each, only ids from the list, cover at least three departments` +
    (quest?.departments?.length ? ` (this quest involves ${quest.departments.join(", ")}: cover each of them)` : "") +
    `. Include a directly relevant station even when its excerpt looks incomplete (e.g. an owner or figure not recorded): ` +
    `gaps must be surfaced, not avoided. "maybe" = 2-3 stations you are unsure help; this first run will check them too.`;
  let reply: string | null = null;
  let raw: { label?: string; subtasks?: Subtask[]; maybe?: { id: string; subtask: string }[] } | null = null;
  for (let i = 0; i < 2 && !raw?.subtasks?.length; i++) {
    reply = await claude(system, user, 1600);
    raw = parseJson(reply);
    if (!raw?.subtasks?.length) console.warn(`planner reply unusable (attempt ${i + 1}): ${(reply ?? "null").slice(0, 160).replace(/\s+/g, " ")}`);
  }
  if (raw?.subtasks?.length) {
    const subtasks = raw.subtasks
      .map((s, i) => ({ id: String(s.id || `s${i + 1}`), title: String(s.title), department: s.department, stations: (s.stations ?? []).filter((x) => ids.has(x)) }))
      .filter((s) => s.stations.length);
    const used = new Set(subtasks.flatMap((s) => s.stations));
    const maybe = (raw.maybe ?? []).filter((m) => ids.has(m.id) && !used.has(m.id)).map((m) => ({ id: m.id, subtask: subtasks.some((s) => s.id === m.subtask) ? m.subtask : subtasks[0]!.id }));
    if (subtasks.length) return { label: raw.label, subtasks, maybe: maybe.slice(0, 3), source: "claude" };
  }
  // Fallback (no key / API down): rank pages by token overlap per department. Labelled in the phase note.
  const t = new Set(tokens(task));
  const ranked = p.memories
    .map((m) => ({ m, s: tokens(`${m.id} ${m.title} ${m.excerpt}`).filter((w) => t.has(w)).length }))
    .sort((a, b) => b.s - a.s);
  const byDept = new Map<string, string[]>();
  for (const { m } of ranked) {
    const d = wingOfRoom(p, m.room);
    if (d === "foyer") continue;
    if ((byDept.get(d)?.length ?? 0) < 2) byDept.set(d, [...(byDept.get(d) ?? []), m.id]);
  }
  const want = quest?.departments ?? [];
  const order = [...byDept.keys()].sort((a, b) => Number(!want.includes(a)) - Number(!want.includes(b)));
  const subtasks = order.map((d) => [d, byDept.get(d)!] as const).slice(0, Math.max(4, want.length)).map(([d, st], i) => ({ id: `s${i + 1}`, title: `Collect ${d} basics`, department: d, stations: st.slice(0, 1) }));
  const maybe = [...byDept.values()].flatMap((st) => st.slice(1)).slice(0, 2).map((id) => ({ id, subtask: "s1" }));
  return { subtasks, maybe, source: "fallback" };
}

// ------------------------------------------------------------------------------------ team replies

async function teamReply(p: Palace, team: string, task: string, question: string, pageId: string, title: string, verdict: string, content: string): Promise<string> {
  if (verdict === "gap") return `${title} (${pageId}) is a gap: the page doesn't record this. I can't answer from it; it's on Loose Ends for ${teamLabel(p, team)}.`;
  const system =
    `You are the ${teamLabel(p, team)} team agent at Acme Robotics. Another agent asked you a question about a page in your ` +
    `room. Answer ONLY from the page text below, which you just read. If the page doesn't say, say so. 1-3 short sentences, no preamble.` +
    (verdict === "stale" ? " The page is stale (low freshness): say it needs a refresh before anyone relies on it." : "");
  const user = `Their task: ${task}\nTheir question: ${question}\n\nPage ${pageId} ("${title}", verdict ${verdict}):\n${content.slice(0, 3000)}`;
  const text = await claude(system, user, 220, 30000);
  if (text) return text;
  return `From ${title}: ${content.split(/\n+/).find((l) => l.trim() && !l.startsWith("#"))?.slice(0, 200) ?? "(empty)"}`;
}

// ------------------------------------------------------------------------------------ reflection

// After run 1 the agent re-reads what it collected and says, per station, whether it will use it and
// which snippet. That judgement sets the Gym's station values and the evidence carried in run 2.
async function reflect(task: string, seen: Seen[]): Promise<Map<string, { useful: boolean; evidence: string }>> {
  const out = new Map<string, { useful: boolean; evidence: string }>();
  const readable = seen.filter((s) => s.verdict !== "gap");
  const system = "You are reviewing the pages you read for a task. Reply with JSON only.";
  const user =
    `Task: ${task}\n\nWhat you read (station id, verdict, text):\n` +
    readable.map((s) => `### ${s.id} [${s.verdict}] (subtask ${s.subtask})\n${s.text.slice(0, 900)}`).join("\n\n") +
    `\n\nFor each station decide if you will use it in the deliverable. Return {"stations": [{"id": "...", "useful": true|false, ` +
    `"evidence": "<the exact short snippet (<= 25 words) you will use, or empty>"}]}. A page is useful when the deliverable should ` +
    `contain a fact from it (including a team agent's answer); it is not useful when it is off-topic for the task. Stale pages can ` +
    `still be useful: they get listed as needing a refresh.`;
  const raw = parseJson<{ stations?: { id: string; useful: boolean; evidence?: string }[] }>(await claude(system, user, 1200));
  for (const s of raw?.stations ?? []) out.set(s.id, { useful: !!s.useful, evidence: String(s.evidence ?? "").slice(0, 220) });
  for (const s of readable) if (!out.has(s.id)) out.set(s.id, { useful: s.verdict === "verified", evidence: s.evidence ?? "" });
  return out;
}

// ------------------------------------------------------------------------------------ writer

async function writeArtifact(task: string, label: string, verified: Seen[], stale: Seen[], gaps: Seen[], p: Palace): Promise<string> {
  const title = (id: string) => p.memories.find((m) => m.id === id)?.title ?? id;
  const system =
    `You are the ${label} at Acme Robotics (a seeded fake company). Write the deliverable as a Markdown page. Use ONLY the verified ` +
    `sources given. Cite each fact inline as [[station-id]]. Do not invent names, dates, tools or numbers. Stale and missing sources ` +
    `go in a short "Still open" section by title, without content. Under 350 words. Start with "# <title>".`;
  const user =
    `Task: ${task}\n\nVerified sources:\n` +
    verified.map((s) => `### ${s.id} (${title(s.id)})${s.via === "handoff" ? ` - answer from the ${s.team} agent` : ""}\n${s.text.slice(0, 1500)}`).join("\n\n") +
    `\n\nStale (needs refresh, do not use content): ${stale.map((s) => `${title(s.id)} [[${s.id}]]`).join(", ") || "none"}` +
    `\nGaps (page silent): ${gaps.map((s) => `${title(s.id)} [[${s.id}]]`).join(", ") || "none"}`;
  const md = await claude(system, user, 1400, 60000);
  if (md?.startsWith("#")) return md;
  return (
    `# ${task.replace(/^create (an? )?/i, "").replace(/^./, (c) => c.toUpperCase())}\n\n` +
    verified.map((s) => `- ${s.evidence || s.text.slice(0, 160)} [[${s.id}]]`).join("\n") +
    (stale.length || gaps.length ? `\n\n## Still open\n${[...stale, ...gaps].map((s) => `- ${title(s.id)} [[${s.id}]]`).join("\n")}\n` : "\n")
  );
}

function freeFoyerSpot(p: Palace, n: number): [number, number, number] {
  const foyer = p.rooms.find((r) => r.id === "foyer")!;
  const taken = p.memories.filter((m) => m.room === "foyer").map((m) => m.pos);
  for (let k = 0; k < 16; k++) {
    const a = ((n - 1 + k) % 8) * (Math.PI / 4) + Math.PI / 8;
    const pos: [number, number, number] = [
      Math.round((foyer.center[0] + 3.5 * Math.cos(a)) * 100) / 100,
      1.1,
      Math.round((foyer.center[2] + 3.5 * Math.sin(a)) * 100) / 100,
    ];
    if (taken.every((q) => Math.hypot(q[0] - pos[0], q[2] - pos[2]) > 1.2)) return pos;
  }
  return [foyer.center[0] + 3.5, 1.1, foyer.center[2]];
}

// ------------------------------------------------------------------------------------ the quest

export type QuestHooks = { harness?: QuestHarness; onExecute?: (ctx: { info: QuestInfo; route: string[]; replies: Map<string, string> }) => Promise<boolean> };

export async function startQuest(task: string, hooks: QuestHooks = {}, quest: QuestDef | null = null): Promise<{ info: QuestInfo; done: Promise<void> }> {
  if (active) throw new Error(`quest ${active.agent} is still running`);
  const p = loadPalace();
  const n = nextQuestNumber();
  const agent = `quest-${n}`;
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
  const run = `${agent}-${ts}`;
  const info: QuestInfo = { agent, run, label: labelFor(task), task, harness: hooks.harness ?? "protocol", ...(quest ? { questId: quest.id } : {}) };
  const proto = new Proto(run);
  await proto.must("/run", { run }); // fresh protocol run: clean leases/verdicts, one clock for the quest
  active = info;
  const done = runQuest(info, proto, p, n, hooks, quest)
    .catch(async (e) => {
      console.error(`quest ${agent} failed: ${(e as Error).message}`);
      await proto.post("/phase", { agent, phase: "done", note: `stopped: ${(e as Error).message.slice(0, 160)}` }).catch(() => {});
    })
    .finally(() => {
      active = null;
    });
  return { info, done };
}

async function runQuest(info: QuestInfo, proto: Proto, p: Palace, n: number, hooks: QuestHooks, quest: QuestDef | null = null) {
  const { agent, task } = info;
  const mem = new Map(p.memories.map((m) => [m.id, m]));
  const roomOf = (id: string) => mem.get(id)!.room;
  const ownerOf = (id: string) => p.rooms.find((r) => r.id === roomOf(id))!.owner;
  let here = "foyer";
  const walkTo = async (room: string) => {
    const d = roomDistance(p, here, room);
    if (d) await sleep(Math.min(4.5, 0.5 + d / WALK_MPS));
    here = room;
  };
  const log = (s: string) => console.log(`  [${agent}] ${s}`);

  // ---- spawn + plan
  await proto.must("/spawn", { agent, label: info.label, color: COLORS[(n - 1) % COLORS.length], home: "foyer", task, harness: info.harness });
  await proto.must("/task", { agent, text: task });
  await sleep(0.8);
  const planned = await plan(task, p, quest);
  if (planned.label && /agent$/i.test(planned.label) && planned.label.length < 32) info.label = planned.label;
  const depts = [...new Set(planned.subtasks.map((s) => s.department).filter(Boolean))];
  await proto.must("/phase", {
    agent,
    phase: "plan",
    note: `${planned.source === "claude" ? MODEL : "fallback planner (Claude unavailable)"}: ${planned.subtasks.length} subtasks across ${depts.join(", ")}`,
    subtasks: planned.subtasks,
  });
  log(`plan (${planned.source}): ${planned.subtasks.map((s) => `${s.id} ${s.title} [${s.stations?.join(", ")}]`).join(" | ")}`);
  await sleep(1.5);

  // ---- explore (run 1): subtasks in order, then the "maybe" stations: an honest, wandering first tour
  const explore: { id: string; subtask: string }[] = [];
  for (const s of planned.subtasks) for (const id of s.stations ?? []) if (!explore.some((e) => e.id === id)) explore.push({ id, subtask: s.id });
  for (const m of planned.maybe) if (!explore.some((e) => e.id === m.id)) explore.push(m);
  await proto.must("/phase", { agent, phase: "explore", note: `run 1: touring ${explore.length} stations` });
  await proto.must("/route", { agent, routeId: `explore-${slugFor(task)}`, stations: explore.map((e) => e.id), source: "explore" });
  await sleep(0.8);

  const subtaskTitle = (id: string) => planned.subtasks.find((s) => s.id === id)?.title ?? task;
  const seen: Seen[] = [];
  const replies: Promise<void>[] = [];
  for (const { id, subtask } of explore) {
    await walkTo(roomOf(id));
    const question = `${subtaskTitle(subtask)}: what does ${mem.get(id)!.title} say that matters for "${task}"?`;
    if (ownerOf(id) === "shared") {
      const c = await proto.post("/claim", { agent, memoryId: id });
      if (c.data?.wait) await sleep(1.5);
      await sleep(0.5);
      const v = await proto.must("/visit", { agent, memoryId: id, question, subtask });
      seen.push({ id, subtask, verdict: v.verdict, via: "visit", text: v.content ?? "", evidence: v.evidence ?? undefined });
      log(`visit ${id}: ${v.verdict}`);
      await sleep(0.7);
      continue;
    }
    // Team-owned room: the service refuses and walks us to the door; we hand off to the owner.
    const refused = await proto.post("/claim", { agent, memoryId: id });
    const team = refused.data?.owner ?? ownerOf(id);
    const toAgent = refused.data?.handoffTo ?? team;
    log(`claim ${id}: refused (${team}) -> handoff to ${toAgent}`);
    await sleep(0.8);
    const q = `For "${task}" (${subtaskTitle(subtask).toLowerCase()}): what does ${mem.get(id)!.title} say?`;
    const h = await proto.must("/handoff", { agent, memoryId: id, question: q, toAgent });
    await sleep(0.7);
    const tv = await proto.must("/visit", { agent: toAgent, memoryId: id, question: q, subtask });
    const entry: Seen = { id, subtask, verdict: tv.verdict, via: "handoff", text: "", evidence: tv.evidence ?? undefined, team: toAgent, question: q };
    seen.push(entry);
    // The owner answers while the quest agent walks on (replies land out of order, as in real life).
    replies.push(
      teamReply(p, team, task, q, id, mem.get(id)!.title, tv.verdict, tv.content ?? "").then(async (answer) => {
        entry.text = answer;
        await proto.must("/reply", { agent: toAgent, id: h.id, answer });
        log(`handoff ${h.id} ${id}: ${tv.verdict} <- ${toAgent}: ${answer.slice(0, 80)}`);
      }),
    );
    await sleep(0.6);
  }
  await Promise.all(replies);

  // ---- gym: walk to the Gym, reflect on run 1 (while walking), train, record the learned route
  await proto.must("/phase", { agent, phase: "gym", note: `reviewing run 1 and training on it (${process.env.QUEST_GYM === "sim" ? "local sim" : "server.train.quest sim policy"}, not a River job)` });
  const reflection = reflect(task, seen);
  await proto.must("/move", { agent, to: "room-gym" });
  await walkTo("room-gym");
  const judged = await reflection;
  const gymStations: GymStation[] = seen.map((s) => {
    const j = judged.get(s.id);
    const value = s.verdict === "gap" || !j?.useful ? 0 : s.verdict === "verified" ? 1 : 0.4;
    return { id: s.id, subtask: s.subtask, value };
  });
  const bySeen = new Map(seen.map((s) => [s.id, s]));
  const verifiedFor = (ids: string[]) => ids.map((id) => bySeen.get(id)!).filter((s) => s.verdict === "verified");
  const statedStale = seen.filter((s) => s.verdict === "stale");
  const statedGaps = seen.filter((s) => s.verdict === "gap");
  // The writer starts drafting from run 1's useful, verified material while the Gym trains; the page
  // only cites what run 2 re-verifies, and the service checks the final answer.
  const usefulVerified = seen.filter((s) => s.verdict === "verified" && judged.get(s.id)?.useful).map((s) => s.id);
  const draft = writeArtifact(task, info.label, verifiedFor(usefulVerified), statedStale.filter((s) => judged.get(s.id)?.useful), statedGaps, p);
  const trained = await gym(info, proto, gymStations);
  let learned = seen.filter((s) => (trained[s.id] ?? 0) >= 0.5).map((s) => s.id);
  if (!learned.length) learned = seen.filter((s) => s.verdict === "verified").map((s) => s.id).slice(0, 3);
  // Walk order for run 2: start next to the Gym (finance), then wings in order of first use.
  const wingOf = (id: string) => p.rooms.find((r) => r.id === roomOf(id))!.wing;
  const wingOrder = ["finance", ...new Set(learned.map(wingOf))];
  learned.sort((a, b) => wingOrder.indexOf(wingOf(a)) - wingOrder.indexOf(wingOf(b)) || roomOf(a).localeCompare(roomOf(b)));
  const saved = await recordRoute(task, learned, `quest-${slugFor(task)}`);
  log(`learned ${saved.routeId}: ${learned.join(" > ")} (was ${seen.length} stations)`);
  await sleep(0.8);

  // ---- execute (run 2): the learned route, only the stations that matter
  await proto.must("/phase", { agent, phase: "execute", note: `run 2: learned route, ${learned.length} stations (run 1: ${seen.length})` });
  await proto.must("/route", { agent, routeId: saved.routeId, stations: learned, source: "learned" });

  const handled = hooks.onExecute ? await hooks.onExecute({ info, route: learned, replies: new Map(seen.filter((s) => s.via === "handoff").map((s) => [s.id, s.text])) }).catch((e) => (console.warn(`execute hook failed: ${e}`), false)) : false;
  if (!handled) {
    for (const id of learned) {
      const s = bySeen.get(id)!;
      await walkTo(roomOf(id));
      const evidence = judged.get(id)?.evidence || undefined;
      if (s.via === "visit") {
        await proto.post("/claim", { agent, memoryId: id });
        await sleep(0.5);
        const v = await proto.must("/visit", { agent, memoryId: id, question: subtaskTitle(s.subtask), subtask: s.subtask, evidence });
        log(`visit ${id}: ${v.verdict}`);
      } else {
        // The agent now knows who owns this: straight to the owner, who re-verifies the page this run.
        const h = await proto.must("/handoff", { agent, memoryId: id, question: s.question ?? subtaskTitle(s.subtask), toAgent: s.team });
        await sleep(0.5);
        await proto.must("/visit", { agent: s.team, memoryId: id, question: s.question, subtask: s.subtask, evidence });
        await proto.must("/reply", { agent: s.team, id: h.id, answer: s.text });
        log(`handoff ${h.id} ${id} <- ${s.team}`);
      }
      await sleep(0.7);
    }
  }

  // ---- artifact: back in the foyer, the page goes on a lectern
  await proto.must("/move", { agent, to: "foyer" });
  await walkTo("foyer");
  const md = await draft;
  const slug = slugFor(task);
  const pageTitle = md.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? task;
  const verifiedIds = new Set(verifiedFor(learned).map((s) => s.id));
  const usedIds = [...new Set([...md.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1]!.trim()))];
  let citations = usedIds.filter((id) => verifiedIds.has(id));
  if (!citations.length) citations = [...verifiedIds];
  mkdirSync(QUEST_DIR, { recursive: true });
  const file = join(QUEST_DIR, `${agent}-${slug}.md`);
  writeFileSync(file, `---\ntitle: ${pageTitle}\ntype: artifact\nwritten_by: ${agent}\ntask: ${JSON.stringify(task)}\ncitations: ${JSON.stringify(citations)}\n---\n\n${md}\n`);
  const excerpt = md.replace(/^#.*$/m, "").replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, "").replace(/[#*_>`-]/g, "").replace(/\s+/g, " ").trim().slice(0, 180);
  const memory: Memory = { id: `quests/${slug}`, title: pageTitle, type: "artifact", room: "foyer", pos: freeFoyerSpot(p, n), freshness: 1, excerpt, path: `quests/${slug}.md` };
  await proto.must("/artifact", { agent, memory });
  log(`artifact ${memory.id} -> ${file}`);
  await sleep(1);

  // ---- done: a grounded answer (the service blocks it if any citation isn't verified in this run)
  const gapIds = statedGaps.map((s) => s.id), staleIds = statedStale.map((s) => s.id);
  const text =
    `Done: wrote "${pageTitle}" (${memory.id}) from ${citations.length} verified stations: ${citations.join(", ")}.` +
    (gapIds.length ? ` Gaps (left on Loose Ends): ${gapIds.join(", ")}.` : "") +
    (staleIds.length ? ` Stale, needs a refresh before anyone relies on it: ${staleIds.join(", ")}.` : "") +
    ` Run 1 took ${seen.length} stations; run 2 took ${learned.length}.`;
  let a = await proto.must("/answer", { agent, text, citations });
  if (a.blocked) {
    log(`answer blocked: ${a.reasons?.join("; ")}`);
    const ok = citations.filter((c) => !a.reasons?.some((r: string) => r.startsWith(c)));
    a = await proto.must("/answer", { agent, text: text + " (re-cited after a blocked answer)", citations: ok.length ? ok : citations.slice(0, 1) });
  }
  const g = await proto.must("/grounding", { agent, text });
  log(`answer ${a.blocked ? "BLOCKED" : "ok"}; grounding ${g.verdict}`);
  await sleep(0.8);
  await proto.must("/phase", { agent, phase: "done", note: `${memory.id} written; grounding ${g.verdict}` });
}

// ------------------------------------------------------------------------------------ gym runner

// Prefer the training workspace's CLI (server/train/quest.py) when it exists; else the local sim.
async function gym(info: QuestInfo, proto: Proto, stations: GymStation[]): Promise<Record<string, number>> {
  const cli = join(dirname(import.meta.path), "..", "train", "quest.py");
  if (existsSync(cli) && process.env.QUEST_GYM !== "sim") {
    try {
      const probs = await gymCli(info, proto, stations);
      if (probs) return probs;
    } catch (e) {
      console.warn(`train CLI failed, using sim: ${(e as Error).message}`);
    }
  }
  let last: Record<string, number> = {};
  const steps = Number(process.env.QUEST_GYM_STEPS ?? 24);
  for (const s of train(stations, steps)) {
    await proto.must("/train_step", { agent: info.agent, step: s.step, reward: s.reward, checkpoint: "sim" });
    last = s.probs;
    await sleep(0.5);
  }
  return last;
}

async function gymCli(info: QuestInfo, proto: Proto, stations: GymStation[]): Promise<Record<string, number> | null> {
  const steps = String(process.env.QUEST_GYM_STEPS ?? 24);
  const p = Bun.spawn(["uv", "run", "--project", "server/train", "python", "-m", "server.train.quest", "--task", info.task, "--agent", info.agent, "--steps", steps, "--seconds", String(process.env.QUEST_GYM_SECONDS ?? 12), "--stations", JSON.stringify(stations)], {
    stdout: "pipe",
    stderr: "inherit",
  });
  let probs: Record<string, number> | null = null;
  let buf = "";
  for await (const chunk of p.stdout) {
    buf += new TextDecoder().decode(chunk);
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      let o: any;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof o.step === "number" && typeof o.reward === "number") {
        await proto.must("/train_step", { agent: info.agent, step: o.step, reward: o.reward, checkpoint: o.checkpoint ?? "quest" });
      }
      if (o.probs && typeof o.probs === "object") probs = o.probs;
      if (Array.isArray(o.route)) probs = Object.fromEntries(o.route.map((id: string) => [id, 1]));
    }
  }
  await p.exited;
  return probs;
}

if (import.meta.main) {
  // bun server/commission/quest.ts --quest <id>   (fixtures/quests.json)   |   bun server/commission/quest.ts "<task>"
  const qi = process.argv.indexOf("--quest");
  const quest = qi >= 0 ? findQuest(process.argv[qi + 1] ?? "") : null;
  if (qi >= 0 && !quest) throw new Error(`unknown quest ${process.argv[qi + 1]}; known: ${loadQuests().map((q) => q.id).join(", ")}`);
  const task = quest?.prompt ?? (process.argv.slice(2).join(" ") || "Create an onboarding page for new engineers");
  const { info, done } = await startQuest(task, {}, quest);
  console.log(JSON.stringify(info));
  await done;
}
