// OWNED BY: flow. HTML for the task-flow graph + SVG edges measured after layout.
// Layout: task (root) -> plan lanes (columns = subtasks / departments) -> one row per executed step,
// in execution order, so the path zig-zags between departments. Cited steps feed a rail into the answer.
import { makeLookup, PHASES, type Attempt, type Flow, type Lookup, type RunRef, type Score, type Step } from "./model";
import type { Palace } from "../../../server/schema";

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export interface Lane {
  key: string;
  title: string;
  sub: string;
  color: string;
  inferred: boolean;
}

/** Columns shared by every run shown, so Run 1 and Run 2 line up. */
export function lanesFor(flow: Flow, attempts: Attempt[], L: Lookup): { lanes: Lane[]; laneOf: (s: Step) => number } {
  const steps = attempts.flatMap((a) => [...a.steps, ...a.ghosts]);
  if (flow.subtasks?.length) {
    const subs = flow.subtasks;
    const lanes: Lane[] = subs.map((s) => {
      const d = s.department ? L.department(s.department) : undefined;
      return { key: s.id, title: s.title, sub: d ? d.label : "", color: d?.color ?? "#8b90a0", inferred: false };
    });
    const idx = (s: Step): number => {
      let i = subs.findIndex((x) => x.id === s.subtask);
      if (i < 0) i = subs.findIndex((x) => x.stations?.includes(s.memoryId));
      if (i < 0) {
        const m = L.memory(s.memoryId);
        i = subs.findIndex((x) => x.department && [m.wing, m.owner, m.wingLabel.toLowerCase()].includes(x.department.toLowerCase()));
      }
      return i;
    };
    if (steps.some((s) => idx(s) < 0)) lanes.push({ key: "other", title: "Unplanned", sub: "not in the plan", color: "#8b90a0", inferred: true });
    return { lanes, laneOf: (s) => { const i = idx(s); return i < 0 ? lanes.length - 1 : i; } };
  }
  // No plan: infer subtasks from the route, one per department in order of first visit.
  const order: string[] = [];
  const rooms = new Map<string, Set<string>>();
  for (const s of steps) {
    const m = L.memory(s.memoryId);
    if (!order.includes(m.wing)) order.push(m.wing);
    if (!rooms.has(m.wing)) rooms.set(m.wing, new Set());
    if (m.roomLabel) rooms.get(m.wing)!.add(m.roomLabel);
  }
  const lanes = order.map((w) => {
    const any = steps.find((s) => L.memory(s.memoryId).wing === w)!;
    const m = L.memory(any.memoryId);
    return { key: w, title: m.wingLabel, sub: [...rooms.get(w)!].join(" · "), color: m.color, inferred: true };
  });
  return { lanes, laneOf: (s) => order.indexOf(L.memory(s.memoryId).wing) };
}

// ---------------------------------------------------------------- tooltips

export type Tip = { html: string };

function judgement(s: Step, a: Attempt, L: Lookup): [string, string] {
  const who = (id: string) => L.agent(id).label;
  if (s.ghost === "upcoming") return ["dim", "Next on the route, not walked yet."];
  if (s.ghost === "skipped") return ["bad", "On the route but never visited."];
  if (s.ghost === "unverified-cite") return ["bad", "Cited in the answer but never visited or verified in this run."];
  if (s.flags.length) return ["bad", s.flags.join("; ")];
  const inh = a.answerInherited ? " (judged against the final answer)" : "";
  switch (s.status) {
    case "useful": return ["ok", `Cited in the answer: on the useful path${inh}.`];
    case "wasted": return ["dim", `Visited but never cited: a wasted hop${inh}.`];
    case "verified": return ["ok", "Verified. The answer will decide if it was useful."];
    case "gap": return ["warn", s.stated ? "Gap, stated in the answer. Nothing was invented." : `Gap${inh || ", answer pending"}.`];
    case "stale": return ["warn", s.stated ? "Stale, flagged in the answer." : `Stale page${inh || ", answer pending"}.`];
    case "pending": return ["dim", s.handoff ? `Asked ${who(s.handoff.toAgent)}, waiting for the reply.` : "Claimed, not verified yet."];
  }
  return ["dim", ""];
}

function tipHTML(s: Step, a: Attempt, L: Lookup, dropped: boolean): string {
  const m = L.memory(s.memoryId);
  const [cls, j] = judgement(s, a, L);
  let h = `<div class="h">${esc(m.title)}</div><div class="id">${esc(s.memoryId)}${m.roomLabel ? ` · ${esc(m.wingLabel)} / ${esc(m.roomLabel)}` : ""}</div>`;
  h += `<div class="j ${cls}">${esc(j)}</div>`;
  if (dropped) h += `<div class="j dim">Dropped from the learned route in the next run.</div>`;
  if (s.handoff) {
    h += `<div class="lab">Handoff to ${esc(L.agent(s.handoff.toAgent).label)} (owns this room)</div><div class="ev">Q: ${esc(s.handoff.question)}</div>`;
    if (s.handoff.reply) h += `<div class="ev">A: ${esc(s.handoff.reply)}</div>`;
  }
  if (s.evidence) h += `<div class="lab">Evidence</div><div class="ev">${esc(s.evidence)}</div>`;
  if (s.note) h += `<div class="lab">Note</div><div class="ev">${esc(s.note)}</div>`;
  if (!s.evidence && m.excerpt) h += `<div class="lab">Page excerpt</div><div class="ev">${esc(trunc(m.excerpt, 240))}</div>`;
  const marks = [s.claimed && "claimed", s.waitedOn && `waited on ${L.agent(s.waitedOn).label}`, s.reused && "reused another agent's verdict", !s.onRoute && s.kind !== "ghost" && "off-route"].filter(Boolean);
  if (marks.length) h += `<div class="lab">${esc(marks.join(" · "))}</div>`;
  h += `<div class="lab" style="margin-top:8px">Click to fly there</div>`;
  return h;
}

// ---------------------------------------------------------------- pieces

const VCHIP: Record<string, [string, string]> = {
  verified: ["verified", "verified"],
  stale: ["stale", "stale"],
  gap: ["gap", "gap"],
};

function stepHTML(s: Step, a: Attempt, col: number, row: number, lane: Lane, L: Lookup, tips: Tip[], dropped: boolean): string {
  const m = L.memory(s.memoryId);
  const cls = ["fl-node", `st-${s.status}`, s.kind, s.ghost ?? "", s.flags.length ? "bad" : "", dropped ? "dropped" : ""].join(" ");
  const v = s.verdict ?? (s.handoff?.reply ? "verified" : undefined);
  let chip: string;
  if (s.ghost) chip = `<span class="fl-v ${s.ghost === "upcoming" ? "ghost" : "bad"}">${s.ghost === "upcoming" ? "next" : s.ghost === "skipped" ? "skipped" : "not visited"}</span>`;
  else if (v) chip = `<span class="fl-v ${VCHIP[v][0]}">${VCHIP[v][1]}</span>`;
  else chip = `<span class="fl-v pending">${s.handoff ? "asked" : "claimed"}</span>`;
  const marks: string[] = [];
  if (s.handoff) marks.push(`<span class="fl-mk" title="handoff">⇄</span>`);
  if (s.claimed) marks.push(`<span class="fl-mk" title="claimed">◆</span>`);
  if (s.waitedOn) marks.push(`<span class="fl-mk" title="waited">⌛${esc(L.agent(s.waitedOn).label)}</span>`);
  if (s.cited && !s.ghost) marks.push(`<span class="fl-ck">✓ cited</span>`);
  if ((s.status === "gap" || s.status === "stale") && s.stated !== undefined && !s.cited)
    marks.push(s.stated ? `<span class="fl-st">✓ stated</span>` : a.answerInherited ? "" : `<span class="fl-st no">✗ unstated</span>`);
  if (dropped) marks.push(`<span class="drop-tag">dropped in run ${a.n + 2}</span>`);
  let extra = "";
  if (s.handoff) {
    const h = L.agent(s.handoff.toAgent);
    extra += `<div class="l3" style="--h:${h.color}"><i>⇄ ${esc(h.label)}</i>${esc(s.handoff.question)}</div>`;
    if (s.handoff.reply) extra += `<div class="l3">↩ ${esc(s.handoff.reply)}</div>`;
  } else if (s.evidence || s.note) extra += `<div class="l3">${esc(s.evidence ?? s.note)}</div>`;
  if (s.flags.length) extra += `<div class="l3 fl">✗ ${esc(s.flags[0])}${s.flags.length > 1 ? ` +${s.flags.length - 1}` : ""}</div>`;
  tips.push({ html: tipHTML(s, a, L, dropped) });
  return `<div class="${cls}" style="grid-column:${col};grid-row:${row};--c:${lane.color}" data-mem="${esc(s.memoryId)}" data-tip="${tips.length - 1}"${s.order ? ` data-seq="${s.order}"` : ` data-ghost="${s.ghost}"`}${s.cited ? " data-cited" : ""}>
<div class="l1"><span class="ord">${s.order || "·"}</span><span class="ttl">${esc(m.title)}</span></div>
<div class="l2">${chip}${marks.join("")}</div>${extra}</div>`;
}

function answerHTML(flow: Flow, a: Attempt, L: Lookup): string {
  const ans = a.answer ?? (a.answerInherited ? flow.answer : undefined);
  const arts = flow.artifacts.map((m) => `<span class="fl-chip art" data-mem="${esc(m.id)}">✎ ${esc(m.title)}</span>`).join("");
  if (!ans) return `<div class="fl-answer pending" data-answer><div class="k">answer · pending</div><div class="txt">Walking the route. Steps are judged when the answer lands.</div></div>`;
  const touched = new Map([...a.steps, ...a.ghosts].map((s) => [s.memoryId, s]));
  const chip = (id: string, kind: string) => {
    const s = touched.get(id);
    const bad = kind === "" && (!s || s.flags.length > 0);
    return `<span class="fl-chip ${kind} ${bad ? "bad" : ""}" data-mem="${esc(id)}">${esc(L.memory(id).title)}</span>`;
  };
  const bad = a.score.grounded === false;
  return `<div class="fl-answer ${ans.blocked ? "blocked" : bad ? "bad" : ""}" data-answer>
<div class="k"><span>answer · ${esc(L.agent(ans.agent).label)} · t=${ans.t.toFixed(1)}s</span>${ans.blocked ? "<span>✗ blocked by the grounding check</span>" : bad ? "<span>✗ ungrounded citation</span>" : "<span>✓ grounded</span>"}</div>
<div class="txt">${esc(ans.text)}</div>
${a.answerInherited ? `<div class="inh">This run had no answer of its own: judged against the final answer.</div>` : ""}
<div class="fl-chips"><span class="lbl">cites</span>${ans.citations.map((c) => chip(c, "")).join("") || "<span class='lbl'>none</span>"}
${ans.gaps?.length ? `<span class="lbl">&nbsp;gaps</span>${ans.gaps.map((c) => chip(c, "gap")).join("")}` : ""}
${ans.stale?.length ? `<span class="lbl">&nbsp;stale</span>${ans.stale.map((c) => chip(c, "stale")).join("")}` : ""}
${arts ? `<span class="lbl">&nbsp;wrote</span>${arts}` : ""}</div></div>`;
}

export function scoreHTML(s: Score): string {
  const tri = (v: boolean | null, label: string) =>
    `<div class="fl-sc ${v === null ? "na" : v ? "ok" : "bad"}"><b>${v === null ? "–" : v ? "✓" : "✗"}</b><span>${label}</span></div>`;
  return `<div class="fl-score">
<div class="fl-sc ${s.hops && s.useful === s.hops ? "ok" : ""}"><b>${s.useful}/${s.hops}</b><span>useful hops</span></div>
${tri(s.gapsStated, "gaps stated")}
${tri(s.ownership, `ownership · ${s.handoffs} handoff${s.handoffs === 1 ? "" : "s"}`)}
${tri(s.grounded, "grounded")}
<div class="fl-sc"><b>${s.toolCalls}</b><span>tool calls</span></div>
<div class="fl-sc"><b>${s.duration.toFixed(1)}s</b><span>time</span></div></div>`;
}

export function phasesHTML(flow: Flow): string {
  if (!flow.phases.length) return "";
  const seen = new Set(flow.phases.map((p) => p.phase));
  const cur = flow.phases.at(-1)!.phase;
  return `<div class="fl-phases" style="--c:${flow.color}">${PHASES.map((p) => {
    const extra = p === "gym" && flow.train.steps ? `<small>${flow.train.steps} steps${flow.train.reward !== undefined ? ` · r ${flow.train.reward.toFixed(2)}` : ""}</small>` : "";
    return `<span class="fl-ph ${p === cur ? "cur" : seen.has(p) ? "done" : ""}">${p}${extra}</span>`;
  }).join("")}</div>`;
}

/** One run as a graph. `dropped`: stations of this run that the next run no longer needs. */
export function graphHTML(ref: RunRef, lanes: Lane[], laneOf: (s: Step) => number, L: Lookup, tips: Tip[], dropped: Set<string>, rootLabel: string): string {
  const { flow, attempt: a } = ref;
  const rows = [...a.steps, ...a.ghosts];
  const n = lanes.length;
  const used = new Set(rows.map(laneOf));
  let g = `<div class="fl-grid" style="grid-template-columns:repeat(${n},minmax(118px,1fr)) 18px">`;
  lanes.forEach((ln, i) => {
    g += `<div class="fl-laneb" style="grid-column:${i + 1};grid-row:1 / span ${rows.length + 1};--c:${ln.color}"></div>`;
    g += `<div class="fl-lh" data-lh style="grid-column:${i + 1};grid-row:1;--c:${ln.color};${used.has(i) ? "" : "opacity:.45"}"><div class="t">${esc(ln.title)}</div><div class="s">${esc(ln.sub)}${ln.inferred ? " · inferred" : ""}</div></div>`;
  });
  g += `<div class="fl-railh" data-rail style="grid-column:${n + 1};grid-row:1 / span ${rows.length + 1}">cited → answer</div>`;
  rows.forEach((s, r) => {
    const c = laneOf(s);
    g += stepHTML(s, a, c + 1, r + 2, lanes[c], L, tips, dropped.has(s.memoryId) && !s.ghost);
  });
  g += `</div>`;
  const src = a.source ? `${a.source} route` : "no route";
  return `<div class="fl-graph" data-graph><svg class="fl-edges" data-color="${esc(flow.color)}"></svg>
<div class="fl-rootn" data-root style="--c:${flow.color}"><div class="k"><b>${esc(flow.label)}</b> · ${esc(rootLabel)} · ${esc(src)}${a.routeId ? ` <span style="opacity:.7">${esc(a.routeId)}</span>` : ""}</div><div class="txt">${esc(flow.task || "(no task text)")}</div></div>
${g}${answerHTML(flow, a, L)}</div>`;
}

export function lookupFor(palace: Palace, flow: Flow): Lookup {
  return makeLookup(palace, flow.artifacts);
}

// ---------------------------------------------------------------- edges (measured)

const NS = "http://www.w3.org/2000/svg";
export function drawEdges(graph: HTMLElement) {
  const svg = graph.querySelector<SVGSVGElement>("svg.fl-edges");
  if (!svg) return;
  const color = svg.dataset.color || "#8b90a0";
  const G = graph.getBoundingClientRect();
  const box = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { l: r.left - G.left, r: r.right - G.left, t: r.top - G.top, b: r.bottom - G.top, cx: (r.left + r.right) / 2 - G.left, cy: (r.top + r.bottom) / 2 - G.top };
  };
  svg.setAttribute("width", String(graph.offsetWidth));
  svg.setAttribute("height", String(graph.offsetHeight));
  svg.replaceChildren();
  const path = (d: string, stroke: string, w = 2, dash = "", op = 1) => {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", stroke);
    p.setAttribute("stroke-width", String(w));
    p.setAttribute("shape-rendering", "crispEdges");
    if (dash) p.setAttribute("stroke-dasharray", dash);
    p.setAttribute("opacity", String(op));
    svg.appendChild(p);
  };
  const R = (v: number) => Math.round(v) + 0.5;

  // task -> plan lanes
  const root = graph.querySelector("[data-root]");
  const heads = [...graph.querySelectorAll("[data-lh]")];
  if (root && heads.length) {
    const rb = box(root);
    const hy = box(heads[0]).t;
    const mid = R((rb.b + hy) / 2);
    const xs = heads.map((h) => R(box(h).cx));
    path(`M${R(rb.cx)} ${rb.b} V${mid} M${Math.min(...xs)} ${mid} H${Math.max(...xs)} ` + xs.map((x) => `M${x} ${mid} V${hy}`).join(" "), "#3a4259", 2);
  }

  // execution path, in order, then dashed into the not-yet-walked stations
  const seq = [...graph.querySelectorAll<HTMLElement>(".fl-node[data-seq]")].sort((a, b) => +a.dataset.seq! - +b.dataset.seq!);
  const ghosts = [...graph.querySelectorAll<HTMLElement>(".fl-node[data-ghost]")].filter((g) => g.dataset.ghost !== "unverified-cite");
  const chain = (list: HTMLElement[], stroke: string, dash: string, op: number) => {
    for (let i = 1; i < list.length; i++) {
      const a = box(list[i - 1]), b = box(list[i]);
      const mid = R((a.b + b.t) / 2);
      path(`M${R(a.cx)} ${a.b} V${mid} H${R(b.cx)} V${b.t}`, stroke, 2, dash, op);
    }
  };
  if (seq[0] && heads.length) {
    const first = box(seq[0]);
    const lh = heads.map(box).find((h) => Math.abs(h.cx - first.cx) < 2);
    if (lh) path(`M${R(first.cx)} ${lh.b} V${first.t}`, color, 2, "", 0.5);
  }
  chain(seq, color, "", 0.85);
  chain([...seq.slice(-1), ...ghosts], "#5b6070", "3 4", 0.9);

  // citation rail into the answer
  const rail = graph.querySelector("[data-rail]");
  const ans = graph.querySelector("[data-answer]");
  const cited = [...graph.querySelectorAll<HTMLElement>(".fl-node[data-cited]")];
  if (rail && ans && cited.length) {
    const x = R(box(rail).cx);
    const at = box(ans).t;
    let top = Infinity;
    for (const c of cited) {
      const b = box(c);
      const bad = c.classList.contains("bad") || c.classList.contains("ghost");
      path(`M${b.r} ${R(b.cy)} H${x}`, bad ? "#ff5d6c" : "#5ef2a0", 2, bad ? "3 3" : "", bad ? 0.9 : 0.7);
      top = Math.min(top, R(b.cy));
    }
    path(`M${x} ${top} V${at - 6}`, "#5ef2a0", 2, "", 0.7);
    const tri = document.createElementNS(NS, "path");
    tri.setAttribute("d", `M${x - 5} ${at - 7} H${x + 5} L${x} ${at - 1} Z`);
    tri.setAttribute("fill", "#5ef2a0");
    svg.appendChild(tri);
  }
}
