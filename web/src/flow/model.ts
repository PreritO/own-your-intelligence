// OWNED BY: flow. Pure model: PalaceEvents -> task flows (plan, executed steps, answer) with a
// correctness verdict per step. No DOM here, so `bun web/src/flow/check.ts` can test it headless.
import type { Memory, Palace, PalaceEvent, Verdict } from "../../../server/schema";

type Ev<T extends PalaceEvent["type"]> = Extract<PalaceEvent, { type: T }>;
export type AnswerEv = Ev<"answer">;
export type Subtask = NonNullable<Ev<"phase">["subtasks"]>[number];
export type Source = Ev<"route">["source"];

export type StepStatus = "useful" | "wasted" | "verified" | "gap" | "stale" | "pending" | "ghost";
export type GhostKind = "upcoming" | "skipped" | "unverified-cite";

export interface Step {
  memoryId: string;
  kind: "visit" | "handoff" | "ghost";
  ghost?: GhostKind;
  order: number; // 1-based execution order; 0 for ghosts
  t: number;
  claimed: boolean;
  waitedOn?: string;
  verdict?: Verdict; // own verdict, or the helper's verdict for a handoff
  note?: string;
  evidence?: string;
  subtask?: string;
  reused?: boolean;
  handoff?: { id: string; toAgent: string; question: string; reply?: string; helperVerdict?: Verdict; t: number };
  onRoute: boolean;
  // judged
  cited: boolean;
  status: StepStatus;
  stated?: boolean; // gap/stale listed in the answer
  flags: string[]; // red flags (protocol / grounding problems)
}

export interface Score {
  hops: number;
  useful: number;
  cited: number;
  wasted: number;
  toolCalls: number;
  handoffs: number;
  gapsStated: boolean | null; // null = nothing to state
  ownership: boolean | null; // null = agent has no team (commissioned)
  grounded: boolean | null; // null = no answer yet
  duration: number;
  redFlags: number;
}

export interface Attempt {
  n: number;
  source?: Source;
  routeId?: string;
  stations: string[];
  t0: number;
  tEnd: number;
  steps: Step[];
  ghosts: Step[];
  answer?: AnswerEv;
  answerInherited: boolean;
  calls: number;
  score: Score;
}

export interface Flow {
  key: string;
  seg: number;
  archived: boolean;
  agent: string;
  label: string;
  color: string;
  team?: string;
  run?: string;
  task: string;
  spawned: boolean;
  harness?: string;
  phases: { phase: string; t: number; note?: string }[];
  subtasks?: Subtask[];
  attempts: Attempt[];
  answer?: AnswerEv;
  train: { steps: number; reward?: number; checkpoint?: string };
  artifacts: Memory[];
  t0: number;
  tLast: number;
}

export interface Segment {
  events: PalaceEvent[];
  archived: boolean;
}

// ---------------------------------------------------------------- palace lookups

export interface Lookup {
  memory(id: string): { title: string; room?: string; roomLabel?: string; wing: string; wingLabel: string; owner: string; color: string; excerpt?: string };
  agent(id: string): { label: string; color: string; team?: string };
  department(dep: string): { label: string; color: string };
}

const GREY = "#8b90a0";

export function makeLookup(palace: Palace, extra: Memory[] = []): Lookup {
  const mems = new Map(palace.memories.map((m) => [m.id, m]));
  for (const m of extra) mems.set(m.id, m);
  const rooms = new Map(palace.rooms.map((r) => [r.id, r]));
  const wings = new Map(palace.wings.map((w) => [w.id, w]));
  const agents = new Map(palace.agents.map((a) => [a.id, a]));
  return {
    memory(id) {
      const m = mems.get(id);
      const r = m ? rooms.get(m.room) : undefined;
      const w = r ? wings.get(r.wing) : undefined;
      const prefix = id.split("/")[0];
      const guess = w ?? wings.get(prefix);
      return {
        title: m?.title ?? id.split("/").pop()!.replace(/-/g, " "),
        room: r?.id,
        roomLabel: r?.label,
        wing: guess?.id ?? r?.wing ?? "other",
        wingLabel: guess?.label ?? r?.label ?? "Other",
        owner: r?.owner ?? guess?.owner ?? "shared",
        color: guess?.color ?? GREY,
        excerpt: m?.excerpt,
      };
    },
    agent(id) {
      const a = agents.get(id);
      return a ? { label: a.label.replace(/ agent$/i, ""), color: a.color, team: a.team } : { label: id, color: GREY };
    },
    department(dep) {
      const d = dep.toLowerCase();
      const w = palace.wings.find((w) => w.id === d || w.owner === d || w.label.toLowerCase() === d);
      return w ? { label: w.label, color: w.color } : { label: dep, color: GREY };
    },
  };
}

// ---------------------------------------------------------------- build

export const normTask = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

function newAttempt(n: number, t: number, r?: Ev<"route">): Attempt {
  return {
    n,
    source: r?.source,
    routeId: r?.routeId,
    stations: r?.stations ?? [],
    t0: t,
    tEnd: t,
    steps: [],
    ghosts: [],
    answerInherited: false,
    calls: 0,
    score: undefined as unknown as Score,
  };
}

function newStep(memoryId: string, t: number, kind: Step["kind"]): Step {
  return { memoryId, kind, order: 0, t, claimed: false, onRoute: false, cited: false, status: "pending", flags: [] };
}

export function buildFlows(segments: Segment[], palace: Palace): Flow[] {
  const all: Flow[] = [];
  segments.forEach((seg, si) => {
    const current = new Map<string, Flow>(); // agent -> flow in this segment
    const handoffs = new Map<string, { flow: Flow; att: Attempt; step: Step; toAgent: string; memoryId: string; closed: boolean }>();
    const L = makeLookup(palace);
    let n = 0;

    const createFlow = (agent: string, t: number, run?: string): Flow => {
      const a = L.agent(agent);
      const f: Flow = {
        key: `${si}:${run ?? "live"}:${agent}:${n++}`,
        seg: si,
        archived: seg.archived,
        agent,
        label: a.label,
        color: a.color,
        team: a.team,
        run,
        task: "",
        spawned: false,
        phases: [],
        attempts: [],
        train: { steps: 0 },
        artifacts: [],
        t0: t,
        tLast: t,
      };
      current.set(agent, f);
      all.push(f);
      return f;
    };
    const attemptOf = (f: Flow, t: number) => {
      let a = f.attempts.at(-1);
      if (!a) f.attempts.push((a = newAttempt(0, t)));
      return a;
    };
    const stepOf = (a: Attempt, memoryId: string, t: number, kind: Step["kind"] = "visit") => {
      let s = a.steps.find((x) => x.memoryId === memoryId);
      if (!s) {
        s = newStep(memoryId, t, kind);
        s.order = a.steps.length + 1;
        a.steps.push(s);
      }
      return s;
    };
    // Helper work on behalf of an open handoff (the owning team agent reading its own room).
    const helping = (agent: string, memoryId: string) => {
      for (const h of handoffs.values()) if (!h.closed && h.toAgent === agent && h.memoryId === memoryId) return h;
      return undefined;
    };

    for (const e of seg.events) {
      let f = current.get(e.agent);
      if (f) f.tLast = Math.max(f.tLast, e.t);
      switch (e.type) {
        case "spawn": {
          f = createFlow(e.agent, e.t, e.run);
          f.spawned = true;
          f.label = e.label;
          f.color = e.color;
          f.task = e.task ?? "";
          f.harness = e.harness;
          const home = palace.rooms.find((r) => r.id === e.home);
          f.team = home && home.owner !== "shared" ? home.owner : undefined;
          break;
        }
        case "task": {
          if (f && f.spawned && f.attempts.length === 0 && (!f.task || normTask(f.task) === normTask(e.text))) f.task = e.text;
          else (f = createFlow(e.agent, e.t, e.run)).task = e.text;
          break;
        }
        case "phase": {
          f ??= createFlow(e.agent, e.t, e.run);
          f.phases.push({ phase: e.phase, t: e.t, note: e.note });
          if (e.subtasks?.length) f.subtasks = e.subtasks;
          break;
        }
        case "route": {
          f ??= createFlow(e.agent, e.t, e.run);
          const last = f.attempts.at(-1);
          if (last && last.steps.length === 0) Object.assign(last, { source: e.source, routeId: e.routeId, stations: e.stations });
          else f.attempts.push(newAttempt(f.attempts.length, e.t, e));
          break;
        }
        case "claim":
        case "wait":
        case "visit": {
          const h = helping(e.agent, e.memoryId);
          if (h) {
            h.att.calls++;
            if (e.type === "visit") {
              h.step.handoff!.helperVerdict = e.verdict;
              h.step.verdict = e.verdict;
              h.step.evidence ??= e.evidence;
              h.step.note ??= e.note;
            }
            const own = f?.attempts.at(-1);
            if (!own || !own.stations.includes(e.memoryId)) break; // pure helper work
          }
          if (!f) break; // helper chatter we couldn't attribute
          const a = attemptOf(f, e.t);
          if (!h) a.calls++;
          const s = stepOf(a, e.memoryId, e.t);
          if (e.type === "claim") s.claimed = true;
          else if (e.type === "wait") s.waitedOn = e.heldBy;
          else {
            s.verdict = e.verdict;
            s.note = e.note ?? s.note;
            s.evidence = e.evidence ?? s.evidence;
            s.subtask = e.subtask ?? s.subtask;
            s.reused = /reuse/i.test(e.note ?? "");
          }
          a.tEnd = Math.max(a.tEnd, e.t);
          break;
        }
        case "handoff": {
          f ??= createFlow(e.agent, e.t, e.run);
          const a = attemptOf(f, e.t);
          a.calls++;
          const s = stepOf(a, e.memoryId, e.t, "handoff");
          s.kind = "handoff";
          s.handoff = { id: e.id, toAgent: e.toAgent, question: e.question, t: e.t };
          handoffs.set(e.id, { flow: f, att: a, step: s, toAgent: e.toAgent, memoryId: e.memoryId, closed: false });
          a.tEnd = Math.max(a.tEnd, e.t);
          break;
        }
        case "reply": {
          const h = handoffs.get(e.id);
          if (!h) break;
          h.att.calls++;
          h.step.handoff!.reply = e.answer;
          h.closed = true;
          h.att.tEnd = Math.max(h.att.tEnd, e.t);
          h.flow.tLast = Math.max(h.flow.tLast, e.t);
          break;
        }
        case "answer": {
          f ??= createFlow(e.agent, e.t, e.run);
          const a = attemptOf(f, e.t);
          a.calls++;
          a.answer = e;
          a.tEnd = Math.max(a.tEnd, e.t);
          f.answer = e;
          break;
        }
        case "train_step": {
          const target = f ?? [...current.values()].reverse().find((x) => x.spawned && x.phases.at(-1)?.phase === "gym");
          if (!target) break;
          target.train.steps++;
          target.train.reward = e.reward;
          target.train.checkpoint = e.checkpoint ?? target.train.checkpoint;
          target.tLast = Math.max(target.tLast, e.t);
          break;
        }
        case "artifact": {
          f ??= createFlow(e.agent, e.t, e.run);
          f.artifacts.push(e.memory);
          break;
        }
        case "move":
          break;
      }
    }
  });
  for (const f of all) {
    f.attempts = f.attempts.filter((a) => a.steps.length || a.stations.length || a.answer);
    f.attempts.forEach((a, i) => judge(f, a, i === f.attempts.length - 1, palace));
  }
  return all;
}

// ---------------------------------------------------------------- judge

function judge(f: Flow, a: Attempt, isLast: boolean, palace: Palace) {
  const L = makeLookup(palace, f.artifacts);
  // An explore attempt inside a quest has no answer of its own: judge it against the final answer.
  const ans = a.answer ?? (!isLast ? f.answer : undefined);
  a.answerInherited = !a.answer && !!ans;
  const cites = new Set(ans?.citations ?? []);
  const stated = new Set([...(ans?.gaps ?? []), ...(ans?.stale ?? [])]);
  const done = !!ans;
  const route = new Set(a.stations);

  for (const s of a.steps) {
    s.onRoute = route.has(s.memoryId);
    s.cited = cites.has(s.memoryId);
    s.flags = [];
    const v = s.verdict ?? (s.handoff?.reply ? "verified" : undefined);
    if (!v) s.status = "pending";
    else if (v === "gap") s.status = "gap";
    else if (v === "stale") s.status = "stale";
    else s.status = s.cited ? "useful" : done ? "wasted" : "verified";
    if ((v === "gap" || v === "stale") && done) {
      s.stated = stated.has(s.memoryId);
      if (s.cited) s.flags.push(`cited a ${v} page`);
      else if (!s.stated && !a.answerInherited) s.flags.push(`${v} not stated in the answer`);
    }
    if (done && !v) s.flags.push("never verified");
    if (s.kind === "visit" && f.team) {
      const owner = L.memory(s.memoryId).owner;
      if (owner !== "shared" && owner !== f.team) s.flags.push(`read a ${owner} room without a handoff`);
    }
    if (s.kind === "handoff" && done && !s.handoff?.reply) s.flags.push("handoff never answered");
  }

  // Ghosts: route stations not walked (upcoming while running, skipped once answered),
  // and citations to stations that were never verified in this attempt.
  const touched = new Set(a.steps.map((s) => s.memoryId));
  a.ghosts = [];
  for (const id of a.stations) {
    if (touched.has(id)) continue;
    touched.add(id);
    const g = newStep(id, a.tEnd, "ghost");
    g.onRoute = true;
    g.ghost = done ? "skipped" : "upcoming";
    g.status = "ghost";
    g.cited = cites.has(id);
    if (done) g.flags.push("route station skipped");
    if (g.cited) g.flags.push("cited but never visited");
    a.ghosts.push(g);
  }
  for (const id of cites) {
    if (touched.has(id)) continue;
    const g = newStep(id, a.tEnd, "ghost");
    g.ghost = "unverified-cite";
    g.status = "ghost";
    g.cited = true;
    g.flags.push("cited but never visited");
    a.ghosts.push(g);
  }
  for (const s of a.steps) {
    if (s.cited && s.status === "pending") s.flags.push("cited before it was verified");
  }

  const gs = a.steps.filter((s) => s.status === "gap" || s.status === "stale");
  const redFlags = [...a.steps, ...a.ghosts].reduce((k, s) => k + s.flags.length, 0);
  const groundFail = [...a.steps, ...a.ghosts].some((s) => s.cited && s.flags.length);
  a.score = {
    hops: a.steps.length,
    cited: a.steps.filter((s) => s.status === "useful").length,
    useful: a.steps.filter((s) => s.status === "useful" || (s.stated && !s.cited)).length,
    wasted: a.steps.filter((s) => s.status === "wasted").length,
    toolCalls: a.calls,
    handoffs: a.steps.filter((s) => s.kind === "handoff").length,
    // An inherited (final) answer only has to state what the final run walked.
    gapsStated: done && !a.answerInherited ? (gs.length ? gs.every((s) => s.stated) : null) : null,
    ownership: f.team ? !a.steps.some((s) => s.flags.some((x) => x.includes("without a handoff"))) : null,
    grounded: done ? !ans!.blocked && !groundFail : null,
    duration: Math.max(0, (a.answer?.t ?? a.tEnd) - a.t0),
    redFlags,
  };
}

// ---------------------------------------------------------------- run comparison

export interface RunRef {
  flow: Flow;
  attempt: Attempt;
}

/** The runs to compare for a flow: a quest's own explore + execute attempts, or an earlier
 *  explore run of the same task (other flow, possibly an archived replay) vs this learned run. */
export function runsFor(flow: Flow, flows: Flow[]): RunRef[] {
  const own = flow.attempts.map((attempt) => ({ flow, attempt }));
  if (own.length >= 2) return own;
  const last = own.at(-1);
  if (last?.attempt.source !== "learned") return own;
  const task = normTask(flow.task);
  let best: RunRef | undefined;
  for (const f of flows) {
    if (f === flow || normTask(f.task) !== task) continue;
    for (const a of f.attempts) {
      if (a.source !== "explore" || !a.steps.length) continue;
      if (!best || f.seg > best.flow.seg || (f.seg === best.flow.seg && a.t0 > best.attempt.t0)) best = { flow: f, attempt: a };
    }
  }
  return best ? [best, last] : own;
}

/** Does this flow want an earlier explore run it doesn't have yet? */
export function wantsComparison(flow: Flow, flows: Flow[]): boolean {
  return flow.attempts.at(-1)?.source === "learned" && runsFor(flow, flows).length < 2;
}

export const PHASES = ["plan", "explore", "gym", "execute", "done"] as const;
