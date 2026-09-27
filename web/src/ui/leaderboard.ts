// OWNED BY: ui-v3. The Gym's River leaderboard: a DOM board shown while the camera is in or near the Gym
// (rooms/gym.ts decides when). Three honest sections, all read from fixtures, nothing invented:
//   1. One card per department agent: a generation ladder base -> gen1 -> gen2 -> gen3 from
//      fixtures/gym-scoreboard.json (written by river-serve), grounded % as the bar, Claude as a dashed
//      reference line, a "promoted" badge on the champion. "eval pending" until the file exists.
//   2. River jobs: fixtures/river-runs.json (real SFT/RL jobs with their loss/reward curves).
//   3. Runs improve with use: explore vs learned runs of the recorded quest replays and contract run1 -> run2,
//      scored by the flow model (web/src/flow/model.ts, read-only). In-quest training there is a local sim.
import type { Palace } from "../../../server/schema";
import { PalaceEvent } from "../../../server/schema";
import { buildFlows, runsFor, type Flow, type Segment } from "../flow/model";
import { fetchJsonOptional, fetchTextOptional } from "../rooms/layout";

/** Window events between the HUD and the Gym. */
export const GYM_EVENTS = {
  go: "mp:gym-go", // detail: {}  (HUD "Gym" button -> fly there and open the board)
  state: "mp:gym-state", // detail: { open: boolean }  (board shown/hidden -> HUD highlights the button)
  scoreboard: "mp:gym-scoreboard", // detail: { rows: ScoreRow[] | null }  (fresh scoreboard -> party bar model tags)
} as const;

// ---------------------------------------------------------------- data

export interface RiverJob {
  jobId: string;
  run?: string;
  team: string;
  kind: "sft" | "rl";
  base: string;
  steps: number;
  metric: { name: string; values: number[] };
  start: number | null;
  end: number | null;
  heldOut?: { n?: number; before?: HeldOut; after?: HeldOut; note?: string };
  status: string;
  failure?: "river-backend" | "resume-rejected" | string;
  checkpoint?: string;
  note?: string;
  source?: string;
}
interface HeldOut { reward?: number; correct?: number; compliant?: number }
/** One row of fixtures/gym-scoreboard.json (river-serve). `key: "claude"` rows are the reference model. */
export interface ScoreRow {
  team: string; model: string; key?: string; generation?: number; checkpoint?: string; jobId?: string; trainedOn?: string;
  n?: number; grounded?: number; correct?: number; latency_ms?: number; promoted?: boolean;
  /** "training": a generation River is still training (no metrics yet). */
  status?: string; note?: string;
}
const scored = (r: ScoreRow) => num(r.grounded) || num(r.correct);
interface RunGain { name: string; label: string; color: string; task: string; harness?: string; before: { hops: number; calls: number }; after: { hops: number; calls: number }; sim?: { steps: number; first?: number; last?: number } }

/** Quest replays to score (browser can't list fixtures/replays/, so ids come from quests.json + known files). */
const KNOWN_QUEST_REPLAYS = ["quest-onboarding", "quest-onboarding-qm", "quest-security-questionnaire"];

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const frac = (v: number | undefined) => (!num(v) ? -1 : v <= 1 ? v : v / 100);
const pct = (v: number | undefined) => (!num(v) ? "–" : `${Math.round(frac(v) * 100)}%`);
const secs = (ms?: number) => (!num(ms) ? "–" : `${(ms / 1000).toFixed(1)} s`);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export const isClaude = (r: ScoreRow) => r.key === "claude" || /claude/i.test(r.model);

/** Read the scoreboard (array, or {rows}); null when river-serve hasn't written it yet. */
export async function loadScoreboard(url = new URLSearchParams(location.search).get("gymScoreboard") || "/gym-scoreboard.json"): Promise<ScoreRow[] | null> {
  const sb = await fetchJsonOptional<{ rows?: ScoreRow[] } | ScoreRow[]>(url);
  const rows = Array.isArray(sb) ? sb : sb?.rows;
  return Array.isArray(rows) ? rows.filter((r) => r && typeof r.team === "string" && typeof r.model === "string") : null;
}

/** The champion per team: the promoted River row, else the best grounded (then correct) River row. */
export function champions(rows: ScoreRow[]): Map<string, ScoreRow> {
  const out = new Map<string, ScoreRow>();
  const better = (a: ScoreRow, b: ScoreRow) =>
    !!a.promoted !== !!b.promoted ? !!a.promoted
    : frac(a.grounded) !== frac(b.grounded) ? frac(a.grounded) > frac(b.grounded)
    : frac(a.correct) !== frac(b.correct) ? frac(a.correct) > frac(b.correct)
    : (a.generation ?? 0) > (b.generation ?? 0);
  for (const r of rows) {
    if (isClaude(r) || !scored(r)) continue;
    const cur = out.get(r.team);
    if (!cur || better(r, cur)) out.set(r.team, r);
  }
  return out;
}

/** Short model name for the party bar: "River gen2", "base Qwen". */
export function modelTag(r: ScoreRow): string {
  if (isClaude(r)) return r.model;
  const g = r.generation ?? 0;
  return g <= 0 ? "base Qwen" : `River gen${g}`;
}

async function loadEvents(name: string): Promise<PalaceEvent[] | null> {
  const text = await fetchTextOptional(`/replays/${name}.jsonl`);
  if (!text) return null;
  const out: PalaceEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const p = PalaceEvent.safeParse(JSON.parse(line));
      if (p.success) out.push(p.data);
    } catch { /* skip a bad line */ }
  }
  return out;
}

function trainOf(events: PalaceEvent[], agent: string) {
  const steps = events.filter((e): e is Extract<PalaceEvent, { type: "train_step" }> => e.type === "train_step" && e.agent === agent);
  return steps.length ? { steps: steps.length, first: steps[0].reward, last: steps[steps.length - 1].reward } : undefined;
}

async function loadRunGains(palace: Palace): Promise<RunGain[]> {
  const quests = await fetchJsonOptional<unknown>("/quests.json");
  const list: unknown[] = Array.isArray(quests) ? quests : Array.isArray((quests as { quests?: unknown[] })?.quests) ? (quests as { quests: unknown[] }).quests : [];
  const ids = list.map((q) => (q as { id?: unknown })?.id).filter((x): x is string => typeof x === "string");
  const names = [...new Set([...KNOWN_QUEST_REPLAYS, ...ids.map((id) => `quest-${id}`)])];
  const gains: RunGain[] = [];
  for (const name of names) {
    const events = await loadEvents(name);
    if (!events?.length) continue;
    const flows = buildFlows([{ events, archived: false }], palace);
    for (const f of flows) {
      const runs = runsFor(f, flows);
      if (runs.length < 2) continue;
      const [a, b] = [runs[0].attempt, runs[runs.length - 1].attempt];
      gains.push({
        name: name.replace(/^quest-/, "").replace(/-qm$/, " (QM)").replace(/-/g, " "),
        label: f.label, color: f.color, task: f.task, harness: f.harness ?? (name.endsWith("-qm") ? "qm" : undefined),
        before: { hops: a.score.hops, calls: a.score.toolCalls }, after: { hops: b.score.hops, calls: b.score.toolCalls },
        sim: trainOf(events, f.agent),
      });
    }
  }
  // Contract: run 1 (explore) -> run 2 (learned route), two separate replays of the same task.
  const [r1, r2] = await Promise.all([loadEvents("contract-run1"), loadEvents("contract-run2")]);
  if (r1 && r2) {
    const segs: Segment[] = [{ events: r1, archived: true }, { events: r2, archived: false }];
    const flows = buildFlows(segs, palace);
    const cur = flows.find((f: Flow) => !f.archived && f.task);
    const runs = cur ? runsFor(cur, flows) : [];
    if (cur && runs.length === 2) {
      const [a, b] = runs.map((r) => r.attempt);
      gains.push({ name: "contract", label: `${cur.label} (contract)`, color: cur.color, task: cur.task, before: { hops: a.score.hops, calls: a.score.toolCalls }, after: { hops: b.score.hops, calls: b.score.toolCalls } });
    }
  }
  return gains;
}

// ---------------------------------------------------------------- view pieces

function sparkline(values: number[], color: string, lowerIsBetter: boolean): string {
  const W = 132, H = 30, P = 3;
  if (values.length < 2) return `<svg class="spark empty" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><line x1="${P}" y1="${H / 2}" x2="${W - P}" y2="${H / 2}" /></svg>`;
  const lo = Math.min(...values), hi = Math.max(...values);
  const X = (i: number) => P + (i / (values.length - 1)) * (W - 2 * P);
  const Y = (v: number) => P + (1 - (v - lo) / Math.max(1e-9, hi - lo)) * (H - 2 * P);
  const pts = values.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const last = values.length - 1;
  const good = lowerIsBetter ? values[last] < values[0] : values[last] > values[0];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${values.length} points, ${values[0]} to ${values[last]}">` +
    `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" />` +
    `<circle cx="${X(0).toFixed(1)}" cy="${Y(values[0]).toFixed(1)}" r="2.5" fill="#aaa292" />` +
    `<circle cx="${X(last).toFixed(1)}" cy="${Y(values[last]).toFixed(1)}" r="3" fill="${good ? "#6ee07a" : "#ffb020"}" /></svg>`;
}

function jobLabel(j: RiverJob): { text: string; cls: string } {
  if (j.status === "failed") return { text: "RL (real) · failed", cls: "bad" };
  if (j.kind === "sft") return { text: "River SFT (real)", cls: "real" };
  return { text: "RL (real, noisy)", cls: "noisy" };
}

/** ▲/▼ change from the previous generation: points for %, seconds for latency (lower is better). */
function delta(cur: number | undefined, prev: number | undefined, kind: "pct" | "ms"): string {
  if (!num(cur) || !num(prev)) return "";
  if (kind === "pct") {
    const d = Math.round((frac(cur) - frac(prev)) * 100);
    return d === 0 ? `<span class="d0">=</span>` : `<span class="${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"}${Math.abs(d)}</span>`;
  }
  const d = (cur - prev) / 1000;
  return Math.abs(d) < 0.05 ? `<span class="d0">=</span>` : `<span class="${d < 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"}${Math.abs(d).toFixed(1)}s</span>`;
}

/** One card per department agent: base -> gen1 -> gen2 -> gen3, grounded % as the bar, Claude dashed. */
function ladders(rows: ScoreRow[], teamLabel: (t: string) => string, teamColor: (t: string) => string): string {
  const champ = champions(rows);
  const teams = [...new Set(rows.filter((r) => !isClaude(r)).map((r) => r.team))];
  const globalClaude = rows.find((r) => isClaude(r) && !teams.includes(r.team));
  const out: string[] = [];
  if (!teams.length) out.push(`<div class="pending"><b>eval pending</b> · only Claude reference rows so far.</div>`);
  for (const team of teams) {
    const mine = rows.filter((r) => r.team === team && !isClaude(r));
    const claude = rows.find((r) => r.team === team && isClaude(r)) ?? globalClaude;
    const byGen = new Map<number, ScoreRow>();
    mine.forEach((r, i) => {
      const g = num(r.generation) ? r.generation : i;
      const cur = byGen.get(g);
      if (!cur || (r.promoted && !cur.promoted)) byGen.set(g, r);
    });
    const maxGen = Math.max(3, ...byGen.keys());
    const best = champ.get(team);
    const color = teamColor(team);
    const cl = claude && num(claude.grounded) ? Math.max(0, Math.min(1, frac(claude.grounded))) : null;
    out.push(`<div class="agent" style="--c:${color}"><div class="ah"><b style="color:${color}">${esc(teamLabel(team))} agent</b>` +
      (best ? `<span class="promo${best.promoted ? "" : " best"}" title="${best.promoted ? "promoted: this model serves the department now" : "best so far (not marked promoted)"}">${best.promoted ? "★ promoted" : "best"} · ${esc(modelTag(best))}</span>` : "") +
      (claude ? `<span class="ref" title="${esc(claude.model)}${claude.n ? ` · ${claude.n} held-out tasks` : ""}">┆ Claude: ${pct(claude.grounded)} grounded · ${pct(claude.correct)} correct · ${secs(claude.latency_ms)}</span>` : "") +
      `</div><div class="ladder"><div class="lh"><span>generation</span><span>grounded</span><span class="num">correct</span><span class="num">latency</span></div>`);
    let prev: ScoreRow | undefined;
    for (let g = 0; g <= maxGen; g++) {
      const r = byGen.get(g);
      const name = g === 0 ? "base" : `gen${g}`;
      if (!r || !scored(r)) {
        const training = r?.status === "training";
        out.push(`<div class="rung empty${training ? " training" : ""}"${r?.jobId ? ` title="River job ${esc(r.jobId)}"` : ""}><span class="gn">${name}</span><span class="miss">${training ? `${name} training on River…` : g === 0 ? "base model not scored yet" : "not trained yet"}</span></div>`);
        continue;
      }
      const tip = [r.model, r.jobId ? `River job ${r.jobId}` : "", r.checkpoint ?? "", r.trainedOn ? `trained on: ${r.trainedOn}` : "", r.n ? `${r.n} held-out tasks` : ""].filter(Boolean).join("\n");
      const w = Math.max(0, Math.min(1, frac(r.grounded)));
      out.push(`<div class="rung${r === best ? " champ" : ""}" title="${esc(tip)}"><span class="gn">${name}${r === best && r.promoted ? " ★" : ""}<i>${g === 0 ? "Qwen3.5-9B" : "River (real)"}</i></span>` +
        `<span class="bar"><i style="width:${(w * 100).toFixed(1)}%"></i>${cl !== null ? `<u style="left:${(cl * 100).toFixed(1)}%"></u>` : ""}<em>${pct(r.grounded)} ${prev ? delta(r.grounded, prev.grounded, "pct") : ""}</em></span>` +
        `<span class="num">${pct(r.correct)} ${prev ? delta(r.correct, prev.correct, "pct") : ""}</span>` +
        `<span class="num">${secs(r.latency_ms)} ${prev ? delta(r.latency_ms, prev.latency_ms, "ms") : ""}</span></div>`);
      if (r.note || r.promoted === false) out.push(`<div class="rnote">${r.promoted === false ? `<span class="np">not promoted</span> ` : ""}${esc(r.note ?? "")}</div>`);
      prev = r;
    }
    out.push(`</div></div>`);
  }
  return out.join("");
}

/** "What the Gym bought us": measured numbers only (scoreboard, replays via flow/model.ts, river-runs.json). */
function valueStrip(score: ScoreRow[] | null, gains: RunGain[] | null, jobs: RiverJob[], teamLabel: (t: string) => string): string {
  const items: string[] = [];
  // regressions the gate caught: a generation whose grounding fell below the previous one and wasn't promoted
  for (const team of new Set((score ?? []).filter((r) => !isClaude(r)).map((r) => r.team))) {
    const gens = (score ?? []).filter((r) => r.team === team && !isClaude(r) && scored(r)).sort((a, b) => (a.generation ?? 0) - (b.generation ?? 0));
    for (let i = 1; i < gens.length; i++) {
      const [a, b] = [gens[i - 1], gens[i]];
      if (frac(b.grounded) < frac(a.grounded) && !b.promoted)
        items.push(`<div class="vi bad"><b>Caught a regression</b>${esc(teamLabel(team))} fine-tune gen${b.generation ?? i} dropped grounding ${pct(a.grounded)} → ${pct(b.grounded)}, not promoted</div>`);
    }
  }
  const g = (gains ?? []).filter((x) => x.after.hops < x.before.hops);
  if (g.length) {
    const pick = g.filter((x) => /security|contract/.test(x.name));
    const show = (pick.length ? pick : g).map((x) => `${esc(x.name)} ${x.before.hops} → ${x.after.hops}`).join("; ");
    items.push(`<div class="vi"><b>Learned routes</b>${show} stations</div>`);
    const saved = g.reduce((s, x) => s + Math.max(0, x.before.calls - x.after.calls), 0);
    const before = g.reduce((s, x) => s + x.before.calls, 0);
    items.push(`<div class="vi"><b>Tool calls saved</b>${saved} of ${before} (${Math.round((saved / Math.max(1, before)) * 100)}%) across ${g.length} replayed task${g.length === 1 ? "" : "s"}, run 1 → run 2</div>`);
  }
  if (jobs.length) {
    const failed = jobs.filter((j) => j.status === "failed");
    const backend = failed.filter((j) => j.failure === "river-backend").length;
    const other = failed.length - backend;
    items.push(`<div class="vi"><b>River jobs run: ${jobs.length}</b>${failed.length} failed (${backend} on River's backend${other ? `, ${other} rejected resume` : ""})</div>`);
  }
  const ns = [...new Set((score ?? []).filter(scored).map((r) => r.n).filter(num))];
  if (ns.length === 1) items.push(`<div class="vi"><b>Every row: n=${ns[0]} held-out</b>grounding = every claim quoted verbatim</div>`);
  return items.length ? `<div class="value"><div class="vh">What the Gym bought us</div>${items.join("")}</div>` : "";
}

// ---------------------------------------------------------------- the board

export interface Leaderboard {
  el: HTMLElement;
  show(): void;
  hide(): void;
  readonly visible: boolean;
  onClose(cb: () => void): void;
}

export function mountLeaderboard(hud: HTMLElement, palace: Palace): Leaderboard {
  const wing = (team: string) => palace.wings.find((w) => w.owner === team || w.id === team);
  const teamLabel = (t: string) => wing(t)?.label ?? t.charAt(0).toUpperCase() + t.slice(1);
  const teamColor = (t: string) => wing(t)?.color ?? "#aaa292";

  const wrap = document.createElement("div");
  wrap.className = "mp-ui mp-gymlb-root";
  wrap.style.pointerEvents = "none";
  const style = document.createElement("style");
  style.textContent = CSS;
  const el = document.createElement("section");
  el.className = "mp-panel mp-gymlb";
  el.setAttribute("aria-label", "River leaderboard");
  el.hidden = true;
  wrap.append(style, el);
  hud.appendChild(wrap);

  let jobs: RiverJob[] = [];
  let gains: RunGain[] | null = null;
  let score: ScoreRow[] | null = null;
  let closeCb: () => void = () => {};
  let poll = 0;

  async function refresh() {
    const [rr, sb] = await Promise.all([
      jobs.length ? Promise.resolve(null) : fetchJsonOptional<{ jobs?: RiverJob[] } | RiverJob[]>("/river-runs.json"),
      loadScoreboard(), // re-read on every open (and every 15 s while open): river-serve writes it during the day
    ]);
    if (rr) jobs = Array.isArray(rr) ? rr : rr.jobs ?? [];
    score = sb;
    window.dispatchEvent(new CustomEvent(GYM_EVENTS.scoreboard, { detail: { rows: sb } }));
    if (!gains) gains = await loadRunGains(palace).catch(() => []);
    if (!el.hidden) render();
  }

  function render() {
    const parts: string[] = [];
    parts.push(`<button class="mp-btn small x" type="button" title="Close (it reopens next time you come to the Gym)">✕</button>`);
    parts.push(`<header><div class="ttl">🏋 River leaderboard</div><div class="lede">The palace is the reward model: each agent trains on its own verified runs.</div>` +
      `<div class="sub">Department agents fine-tuned on River AI (Qwen/Qwen3.5-9B + LoRA), scored on held-out tasks against Claude. Every number comes from a log or a replay.</div></header>`);

    parts.push(valueStrip(score, gains, jobs, teamLabel));

    // 1. Per-agent generation ladders
    parts.push(`<h3>Each agent, generation by generation <span class="tag">River (real) · held-out eval</span></h3>`);
    if (score?.length) parts.push(ladders(score, teamLabel, teamColor));
    else parts.push(`<div class="pending"><b>eval pending</b> · each department agent's base model, River generations and Claude on the same held-out tasks. Cards appear here when <code>fixtures/gym-scoreboard.json</code> lands.</div>`);

    // 2. River jobs
    parts.push(`<h3>River jobs <span class="tag">real</span></h3><div class="jobs">`);
    if (!jobs.length) parts.push(`<div class="none">fixtures/river-runs.json not found.</div>`);
    for (const j of jobs) {
      const lab = jobLabel(j);
      const curve = j.metric.values.length
        ? `${sparkline(j.metric.values, teamColor(j.team), j.metric.name === "loss")}<div class="mv">${esc(j.metric.name)} <b>${j.start}</b> → <b>${j.end}</b></div>`
        : `<div class="mv fail">no optimizer step completed</div>`;
      const ho = j.heldOut;
      const heldTxt = ho?.after
        ? `held-out${ho.n ? ` (${ho.n} tasks)` : ""}: ${ho.before ? `${pct(ho.before.correct)} → ` : ""}<b>${pct(ho.after.correct)}</b> correct · reward ${num(ho.before?.reward) ? `${ho.before!.reward!.toFixed(3)} → ` : ""}<b>${ho.after.reward?.toFixed(3)}</b>` +
          (num(ho.before?.compliant) && num(ho.after.compliant) ? ` · compliant ${pct(ho.before!.compliant)} → ${pct(ho.after.compliant)}` : "")
        : "";
      parts.push(`<div class="job ${j.status}"><div class="jl"><span class="lbl ${lab.cls}">${lab.text}</span>` +
        `<div class="jn"><b style="color:${teamColor(j.team)}">${esc(teamLabel(j.team))}</b> ${esc(j.run ?? j.kind)} · ${j.steps} step${j.steps === 1 ? "" : "s"}</div>` +
        `<div class="jid" title="${esc(j.jobId)}">${esc(j.jobId.split(":")[0].slice(0, 8))}… · ${esc(j.status)}</div></div>` +
        `<div class="jc">${curve}</div>` +
        `<div class="jt">${heldTxt ? `<div class="ho">${heldTxt}</div>` : ""}<div class="note">${esc(j.note ?? "")}</div></div></div>`);
    }
    parts.push(`</div>`);

    // 3. Runs improve with use
    parts.push(`<h3>Runs improve with use <span class="tag sim">in-quest training: local sim</span></h3>`);
    parts.push(`<div class="subnote">Recorded replays, scored by the task-flow model: run 1 explores, run 2 walks the learned route. The Gym step inside a quest is a local RL sim (same palace env and reward), not River.</div>`);
    parts.push(`<table class="gain"><thead><tr><th>Run</th><th class="num">Stations</th><th class="num">Tool calls</th><th class="num">Gym (local sim)</th></tr></thead><tbody>`);
    if (!gains) parts.push(`<tr><td colspan="4" class="none">scoring replays…</td></tr>`);
    else if (!gains.length) parts.push(`<tr><td colspan="4" class="none">no explore → learned replays found</td></tr>`);
    for (const g of gains ?? []) {
      const d = (a: number, b: number) => `${a} → <b>${b}</b>${a > 0 && b < a ? ` <span class="dn">−${Math.round((1 - b / a) * 100)}%</span>` : ""}`;
      parts.push(`<tr><td><b style="color:${g.color}">${esc(g.label)}</b>${g.harness ? ` <span class="h">${esc(g.harness)}</span>` : ""}<div class="task">${esc(g.task)}</div></td>` +
        `<td class="num">${d(g.before.hops, g.after.hops)}</td><td class="num">${d(g.before.calls, g.after.calls)}</td>` +
        `<td class="num">${g.sim ? `${g.sim.steps} steps · ${g.sim.first?.toFixed(2)} → ${g.sim.last?.toFixed(2)}` : "–"}</td></tr>`);
    }
    parts.push(`</tbody></table>`);
    const scrollTop = el.scrollTop; // keep the reader's place across the 15 s refresh
    el.innerHTML = parts.join("");
    el.scrollTop = scrollTop;
    el.querySelector<HTMLButtonElement>(".x")!.onclick = () => { api.hide(); closeCb(); };
  }

  const api: Leaderboard = {
    el,
    get visible() { return !el.hidden; },
    show() {
      if (!el.hidden) return;
      el.hidden = false;
      render();
      void refresh();
      poll = window.setInterval(() => void refresh(), 15000);
      window.dispatchEvent(new CustomEvent(GYM_EVENTS.state, { detail: { open: true } }));
    },
    hide() {
      if (el.hidden) return;
      el.hidden = true;
      clearInterval(poll);
      window.dispatchEvent(new CustomEvent(GYM_EVENTS.state, { detail: { open: false } }));
    },
    onClose(cb) { closeCb = cb; },
  };
  (window as any).gymLeaderboard = api; // browser QA
  return api;
}

const CSS = /* css */ `
.mp-gymlb-root { z-index: 11; }
.mp-gymlb { position: absolute; top: 88px; right: 14px; width: min(660px, calc(100vw - 400px)); max-height: calc(100vh - 190px); overflow-y: auto;
  scrollbar-width: thin; padding: 12px 14px 14px; border-color: #9ece6a #3b5a22 #3b5a22 #9ece6a; }
.mp-gymlb[hidden] { display: none; }
.mp-gymlb .x { position: absolute; top: 8px; right: 8px; }
.mp-gymlb header { padding-right: 34px; }
.mp-gymlb .ttl { font-size: 24px; color: #9ece6a; text-shadow: 0 2px 0 rgba(0,0,0,.6); line-height: 1.1; }
.mp-gymlb .lede { font-size: 16px; color: var(--text, #f2ecdc); margin-top: 4px; line-height: 1.25; }
.mp-gymlb .sub, .mp-gymlb .subnote { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12.5px; color: var(--muted, #aaa292); margin-top: 3px; line-height: 1.35; }
.mp-gymlb h3 { margin: 14px 0 6px; font-size: 16px; font-weight: 400; color: var(--gold, #ffd35a); display: flex; gap: 8px; align-items: center; }
.mp-gymlb .tag { font-size: 11.5px; padding: 1px 6px 2px; background: rgba(110,224,122,0.14); color: #6ee07a; border: 1px solid rgba(110,224,122,0.45); }
.mp-gymlb .tag.sim { background: rgba(125,207,255,0.12); color: #7dcfff; border-color: rgba(125,207,255,0.45); }
.mp-gymlb table { width: 100%; border-collapse: collapse; font-size: 14px; }
.mp-gymlb th { text-align: left; font-weight: 400; font-size: 12px; color: var(--dim, #6f6a60); padding: 3px 6px; border-bottom: 2px solid rgba(255,255,255,0.1); }
.mp-gymlb td { padding: 5px 6px; border-bottom: 1px solid rgba(255,255,255,0.06); vertical-align: top; }
.mp-gymlb .num { text-align: right; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 13px; white-space: nowrap; }
.mp-gymlb b { font-weight: 400; color: var(--text, #f2ecdc); }
.mp-gymlb code { font-size: 12px; color: var(--text, #f2ecdc); }
.mp-gymlb .pending { color: var(--amber, #ffb020); font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; padding: 8px; border: 2px dashed rgba(255,176,32,0.4); }
.mp-gymlb .pending b { color: var(--amber, #ffb020); font-family: "Pixelify Sans", ui-monospace, monospace; font-size: 15px; }
/* per-agent generation ladders */
.mp-gymlb .agent { padding: 7px 8px 8px; margin-bottom: 6px; background: rgba(255,255,255,0.035); border-left: 5px solid var(--c); }
.mp-gymlb .ah { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: baseline; margin-bottom: 5px; }
.mp-gymlb .ah > b { font-size: 18px; }
.mp-gymlb .promo { font-size: 12.5px; padding: 1px 6px 2px; color: #1a1204; background: var(--gold, #ffd35a); }
.mp-gymlb .promo.best { background: rgba(255,211,90,0.18); color: var(--gold, #ffd35a); }
.mp-gymlb .ref { margin-left: auto; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11.5px; color: #c9c3ff; padding: 1px 6px; border: 1px dashed rgba(201,195,255,0.6); }
.mp-gymlb .ladder { display: grid; gap: 3px; }
.mp-gymlb .lh, .mp-gymlb .rung { display: grid; grid-template-columns: 96px 1fr 86px 96px; gap: 8px; align-items: center; }
.mp-gymlb .lh { font-size: 11.5px; color: var(--dim, #6f6a60); }
.mp-gymlb .rung { padding: 2px 0; cursor: default; }
.mp-gymlb .rung.champ { background: rgba(255,211,90,0.08); outline: 1px solid rgba(255,211,90,0.4); }
.mp-gymlb .rung.empty { opacity: .6; }
.mp-gymlb .gn { font-size: 15px; padding-left: 4px; line-height: 1.05; }
.mp-gymlb .gn i { display: block; font-style: normal; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 10.5px; color: var(--dim, #6f6a60); }
.mp-gymlb .miss { grid-column: 2 / -1; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12px; color: var(--dim, #6f6a60); border: 1px dashed rgba(255,255,255,0.14); padding: 3px 6px; }
.mp-gymlb .bar { position: relative; height: 22px; background: rgba(0,0,0,0.35); border: 1px solid rgba(0,0,0,.5); }
.mp-gymlb .bar > i { position: absolute; left: 0; top: 0; bottom: 0; background: var(--c); opacity: .8; }
.mp-gymlb .bar > u { position: absolute; top: -4px; bottom: -4px; width: 0; border-left: 2px dashed #c9c3ff; }
.mp-gymlb .bar > em { position: absolute; left: 6px; top: 2px; font-style: normal; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12.5px; color: #fff; text-shadow: 0 1px 2px #000, 0 0 3px #000; }
.mp-gymlb .up { color: #6ee07a; }
.mp-gymlb .down { color: #ff5d6c; }
.mp-gymlb .d0 { color: var(--dim, #6f6a60); }
.mp-gymlb .rnote { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12px; color: var(--muted, #aaa292); padding: 0 4px 3px 108px; line-height: 1.3; }
.mp-gymlb .np { font-family: "Pixelify Sans", ui-monospace, monospace; font-size: 11.5px; padding: 0 5px; color: #1b0508; background: #ff5d6c; }
.mp-gymlb .rung.training .miss { color: #7dcfff; border-color: rgba(125,207,255,0.5); animation: mp-gym-pulse 1.4s steps(2) infinite; }
@keyframes mp-gym-pulse { 50% { opacity: .55; } }
/* value strip */
.mp-gymlb .value { margin-top: 10px; display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 5px; }
.mp-gymlb .value .vh { grid-column: 1 / -1; font-size: 15px; color: var(--gold, #ffd35a); }
.mp-gymlb .vi { padding: 5px 7px; background: rgba(110,224,122,0.07); border: 1px solid rgba(110,224,122,0.3); font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12px; color: var(--muted, #aaa292); line-height: 1.3; }
.mp-gymlb .vi b { display: block; font-family: "Pixelify Sans", ui-monospace, monospace; font-size: 14px; color: #6ee07a; }
.mp-gymlb .vi.bad { background: rgba(255,93,108,0.08); border-color: rgba(255,93,108,0.4); }
.mp-gymlb .vi.bad b { color: #ff8a95; }
/* River jobs */
.mp-gymlb .jobs { display: grid; gap: 5px; }
.mp-gymlb .job { display: grid; grid-template-columns: 150px 140px 1fr; gap: 10px; align-items: start; padding: 6px 7px; background: rgba(255,255,255,0.035); border-left: 4px solid #6ee07a; }
.mp-gymlb .job.partial { border-left-color: #ffb020; }
.mp-gymlb .job.failed { border-left-color: #ff5d6c; opacity: .85; }
.mp-gymlb .lbl { display: inline-block; font-size: 12px; padding: 1px 6px 2px; margin-bottom: 3px; }
.mp-gymlb .lbl.real { background: #6ee07a; color: #07170d; }
.mp-gymlb .lbl.noisy { background: #ffb020; color: #1a1204; }
.mp-gymlb .lbl.bad { background: #ff5d6c; color: #1b0508; }
.mp-gymlb .jn { font-size: 14px; line-height: 1.2; }
.mp-gymlb .jid { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11px; color: var(--dim, #6f6a60); margin-top: 2px; }
.mp-gymlb .spark { display: block; background: rgba(0,0,0,0.3); border: 1px solid rgba(0,0,0,.5); }
.mp-gymlb .spark.empty line { stroke: rgba(255,93,108,0.5); stroke-dasharray: 4 4; }
.mp-gymlb .mv { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11.5px; color: var(--muted, #aaa292); margin-top: 2px; }
.mp-gymlb .mv.fail { color: #ff5d6c; font-family: ui-sans-serif, system-ui, sans-serif; }
.mp-gymlb .ho { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; color: var(--text, #f2ecdc); margin-bottom: 2px; }
.mp-gymlb .ho b { color: #6ee07a; }
.mp-gymlb .note { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12px; color: var(--muted, #aaa292); line-height: 1.3; }
/* runs improve with use */
.mp-gymlb .task { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12px; color: var(--muted, #aaa292); }
.mp-gymlb .h { font-size: 11px; padding: 0 4px; color: var(--muted, #aaa292); border: 1px solid rgba(255,255,255,0.2); }
.mp-gymlb .gain td.num b { color: #6ee07a; }
.mp-gymlb .dn { color: #6ee07a; font-size: 11.5px; }
.mp-gymlb .none { color: var(--muted, #aaa292); font-size: 13px; }
@media (max-width: 1100px) { .mp-gymlb { width: calc(100vw - 28px); max-height: 55vh; } .mp-gymlb .job { grid-template-columns: 1fr 140px; } .mp-gymlb .jt { grid-column: 1 / -1; } }
`;
