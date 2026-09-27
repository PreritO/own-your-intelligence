// Pure helpers between Agent Palace runs and Memorable procedures (no I/O, unit-tested).
//
//   runToTrace()        a successful run (PalaceEvent[]) -> the trace JSON Memorable's /v1/extract and
//                       `memorable ingest -` take: {session_id, harness, task_description, tool_calls[]}
//   stationsFromText()  whatever recall/show printed -> ordered palace station ids
//
// Trace shape (verified against the live API, see docs/NOTES-memorable.md). Memorable only keeps allow-listed
// input fields (command, file_path, path, query, description, ...) and `result.{ok,exit_code}`. Its
// admission prefilter refuses traces that only read ("no_decisive_steps"), have no postcondition, or use
// one verb throughout ("single_verb"). So each step is the loci protocol tool the agent really called,
// written as a command:
//   route <routeId> --departments sales,eng,legal     department sequence (owner of each station's room)
//   visit <station>  # <title> [verdict]              the agent read the page itself
//   handoff <dept> <station>  # <title> [verdict]     the page's owning team answered from it
//   answer --cite <station> ...                       the grounded answer; exit 0 = not blocked
// Station ids (GBrain slugs) sit in the commands, so recall output maps back to ids exactly; titles and
// verdicts ride along as a comment so `memorable show` reads well and lexical recall sees the titles.
import type { Palace, PalaceEvent, Verdict } from "../schema";

export const HARNESS = "mind-palace-loci";

export type ToolCall = { name: string; input: Record<string, string>; result?: { ok?: boolean; exit_code?: number } };
export type MemorableTrace = { session_id: string; harness: string; task_description: string; tool_calls: ToolCall[] };
export type Station = { id: string; title: string; department: string; verdict: Verdict | "unknown"; via: "self" | "handoff" };
export type RunSummary = { task: string; routeId: string; stations: Station[]; departments: string[]; answered: boolean };

type Ev<T extends PalaceEvent["type"]> = Extract<PalaceEvent, { type: T }>;

export function departmentOf(palace: Palace, memoryId: string): string {
  const m = palace.memories.find((x) => x.id === memoryId);
  const room = m && palace.rooms.find((r) => r.id === m.room);
  if (room && room.owner !== "shared") return room.owner;
  const wing = room && palace.wings.find((w) => w.id === room.wing);
  return wing?.id ?? memoryId.split("/")[0] ?? "shared"; // shared rooms: name the wing (e.g. people)
}

/** Collapse consecutive repeats: [eng, eng, legal, eng] -> [eng, legal, eng]. */
export function departmentSequence(depts: string[]): string[] {
  return depts.filter((d, i) => d !== depts[i - 1]);
}

/**
 * Summarise one successful run: the task, the path to remember and each station's verdict.
 * The path is the task agent's last non-explore route (what run 2 walked); for an explore-only run it
 * is the stations that paid off (non-gap visits and handoffs, in order). Returns null when the run has
 * no task or its answer was blocked: only successful runs become procedures.
 * `opts.task` picks one agent's task in a multi-agent run; `opts.stations` overrides the path (the caller
 * already decided what to learn) while verdicts and handoffs still come from the events.
 */
export function summarizeRun(events: PalaceEvent[], palace: Palace, opts: { task?: string; stations?: string[]; routeId?: string } = {}): RunSummary | null {
  const task = events.find((e): e is Ev<"task"> => e.type === "task" && (!opts.task || e.text === opts.task));
  if (!task) return null;
  const agent = task.agent;
  const answer = [...events].reverse().find((e): e is Ev<"answer"> => e.type === "answer" && e.agent === agent);
  const done = events.some((e) => e.type === "phase" && e.agent === agent && e.phase === "done");
  if (answer?.blocked || (!answer && !done)) return null;

  const routes = events.filter((e): e is Ev<"route"> => e.type === "route" && e.agent === agent);
  const route = [...routes].reverse().find((r) => r.source !== "explore") ?? routes[routes.length - 1];
  const from = route?.t ?? 0;
  const after = events.filter((e) => e.t >= from);

  let ids: string[];
  if (opts.stations?.length) ids = opts.stations;
  else if (route && route.source !== "explore") ids = route.stations;
  else {
    ids = [];
    for (const e of after) {
      const id = e.type === "handoff" && e.agent === agent ? e.memoryId : e.type === "visit" && e.verdict !== "gap" ? e.memoryId : null;
      if (id && !ids.includes(id)) ids.push(id);
    }
  }

  const titles = new Map(palace.memories.map((m) => [m.id, m.title]));
  const stations: Station[] = ids.map((id) => {
    const visit = [...after].reverse().find((e): e is Ev<"visit"> => e.type === "visit" && e.memoryId === id);
    const handoff = after.find((e): e is Ev<"handoff"> => e.type === "handoff" && e.agent === agent && e.memoryId === id);
    return {
      id,
      title: titles.get(id) ?? id,
      department: departmentOf(palace, id),
      verdict: visit?.verdict ?? "unknown",
      via: handoff ? "handoff" : "self",
    };
  });
  if (!stations.length) return null;
  return {
    task: task.text,
    routeId: opts.routeId ?? route?.routeId ?? "explore",
    stations,
    departments: departmentSequence(stations.map((s) => s.department)),
    answered: !!answer || done,
  };
}

const clean = (s: string) => s.replace(/[\r\n#]+/g, " ").trim();

export function summaryToTrace(s: RunSummary, sessionId: string): MemorableTrace {
  const steps: ToolCall[] = [
    { name: "route", input: { command: `route ${s.routeId} --departments ${s.departments.join(",")}` }, result: { exit_code: 0 } },
  ];
  for (const st of s.stations) {
    const note = `  # ${clean(st.title)}${st.verdict === "unknown" ? "" : ` [${st.verdict}]`}`;
    const command = st.via === "handoff" ? `handoff ${st.department} ${st.id}${note}` : `visit ${st.id}${note}`;
    // A gap is a known failure (the page doesn't say); stale still read fine. Unknown: no result sent.
    const result = st.verdict === "gap" ? { ok: false } : st.verdict === "unknown" ? undefined : { exit_code: 0 };
    steps.push({ name: st.via === "handoff" ? "handoff" : "visit", input: { command, path: st.id }, ...(result ? { result } : {}) });
  }
  const cited = s.stations.filter((x) => x.verdict === "verified").map((x) => x.id);
  steps.push({ name: "answer", input: { command: `answer${cited.map((c) => ` --cite ${c}`).join("")}` }, result: { exit_code: 0 } });
  return { session_id: sessionId, harness: HARNESS, task_description: s.task.slice(0, 200), tool_calls: steps };
}

export function runToTrace(events: PalaceEvent[], palace: Palace, sessionId?: string, opts: Parameters<typeof summarizeRun>[2] = {}): MemorableTrace | null {
  const s = summarizeRun(events, palace, opts);
  if (!s) return null;
  const run = events.find((e) => e.run)?.run;
  return summaryToTrace(s, sessionId ?? `mind-palace-${run ?? s.routeId}`);
}

/** A recorded path with no event log (routes.ts recordRoute): same trace shape, verdicts unknown. */
export function pathToTrace(task: string, stationIds: string[], palace: Palace, routeId: string, sessionId: string): MemorableTrace {
  const titles = new Map(palace.memories.map((m) => [m.id, m.title]));
  const stations: Station[] = stationIds.map((id) => ({ id, title: titles.get(id) ?? id, department: departmentOf(palace, id), verdict: "unknown", via: "self" }));
  return summaryToTrace({ task, routeId, stations, departments: departmentSequence(stations.map((s) => s.department)), answered: true }, sessionId);
}

// --- recall output -> station ids ------------------------------------------------------------------

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Map free text to palace station ids, in the order the text names them.
 * 1. Exact GBrain slugs (the commands we ingest carry them), bounded so `eng/soc2` never matches
 *    inside `eng/soc2-owner`.
 * 2. If fewer than 2 slugs turned up and `titles` is on (Memorable returned prose), match memory titles.
 */
export function stationsFromText(text: string, palace: Palace, titles = true): string[] {
  const hits: { id: string; at: number }[] = [];
  for (const m of palace.memories) {
    const at = text.search(new RegExp(`(?<![\\w/-])${esc(m.id)}(?![\\w/-])`));
    if (at >= 0) hits.push({ id: m.id, at });
  }
  if (titles && hits.length < 2) {
    const lower = text.toLowerCase();
    for (const m of palace.memories) {
      if (hits.some((h) => h.id === m.id) || m.title.length < 6) continue;
      const at = lower.search(new RegExp(`(?<![a-z0-9])${esc(m.title.toLowerCase())}(?![a-z0-9])`));
      if (at >= 0) hits.push({ id: m.id, at });
    }
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.id);
}

export type ShownStep = { seq: number; activity: string; action: string; command: string };
export type Shown = { title: string; steps: ShownStep[]; verifiedBy: string };

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

/**
 * Parse `memorable show <slug>` (the guarded injection block, CLI 0.5.30):
 *   ## A previous session solved a near-identical task: <title>
 *   Verified last time by: <final command>
 *   Decisive steps last time:
 *     2. [execute] handoff: handoff eng eng/soc2-evidence-tracker  # SOC 2 Evidence Tracker [verified]
 */
export function parseShow(out: string): Shown {
  const text = plain(out);
  const title = text.match(/^#+\s*(?:.*?task:\s*)?(.+)$/m)?.[1]?.trim() ?? "";
  const verifiedBy = text.match(/^Verified last time by:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const steps: ShownStep[] = [];
  for (const m of text.matchAll(/^\s*(\d+)\.\s*\[([\w-]+)\]\s*([\w.-]+):\s*(.*)$/gm))
    steps.push({ seq: Number(m[1]), activity: m[2]!, action: m[3]!, command: m[4]!.trim() });
  return { title, steps, verifiedBy };
}

/** Station ids a stored procedure walks: visit/handoff steps in order (the answer's cite list repeats them). */
export function stationsFromSteps(steps: { command?: string; action?: string }[], palace: Palace): string[] {
  const ids: string[] = [];
  for (const s of steps) {
    if (s.action === "answer" || s.action === "route") continue;
    for (const id of stationsFromText(s.command ?? "", palace, false)) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

export type ShowMapping = { stations: string[]; title: string; routeId?: string; departments?: string[]; mapped: "steps" | "text" };

/**
 * Everything `show` printed -> station ids. Structured steps first; if the output isn't in the step
 * format (a CLI change, or prose), scan the text for slugs, then for titles.
 */
export function stationsFromShow(out: string, palace: Palace): ShowMapping {
  const shown = parseShow(out);
  const route = shown.steps.find((s) => s.action === "route")?.command.match(/^route\s+(\S+)(?:.*--departments\s+(\S+))?/);
  const meta = { title: shown.title, routeId: route?.[1], departments: route?.[2]?.split(",") };
  const fromSteps = stationsFromSteps(shown.steps, palace);
  if (fromSteps.length >= 2) return { stations: fromSteps, ...meta, mapped: "steps" };
  const body = plain(out).replace(/^(#.*|.*(Verified last time by|answer --cite).*)$/gm, ""); // not the title line or the cite list
  return { stations: stationsFromText(body, palace), ...meta, mapped: "text" };
}

export type RecallHit = { slug: string; score: number; tier: string };

/** Parse `memorable recall --single` lines: "0.808  procedures/4eac6952-answer-northwind-...  [semantic]". */
export function parseRecall(out: string): RecallHit[] {
  const hits: RecallHit[] = [];
  for (const m of plain(out).matchAll(/^\s*(\d(?:\.\d+)?)\s+(procedures\/[\w.-]+)(?:\s+\[([^\]]+)\])?/gm))
    hits.push({ score: Number(m[1]), slug: m[2]!, tier: m[3] ?? "" });
  return hits;
}
