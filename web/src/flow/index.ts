// OWNED BY: flow. Task-flow view: the quest's breakdown and execution path as a 2D graph, with correctness per step.
// A DOM/SVG overlay that is a pure function of rt.events (plus, in ?demo, the previous replay of a
// numbered run for the explore-vs-learned comparison). G or the launcher toggles it.
import { PalaceEvent, type PalaceEvent as Ev } from "../../../server/schema";
import { emitUI, UI_EVENTS, type Plugin } from "../api";
import { buildFlows, runsFor, wantsComparison, type Flow, type RunRef, type Segment } from "./model";
import { CSS, FONT_HREF } from "./style";
import { drawEdges, esc, graphHTML, lanesFor, lookupFor, phasesHTML, scoreHTML, type Tip } from "./view";

type Size = "half" | "full";
type RunView = "last" | "both" | number;

const STORE = "mp-flow-ui";
const load = (): { open?: boolean; size?: Size } => {
  try { return JSON.parse(localStorage.getItem(STORE) || "{}"); } catch { return {}; }
};
const save = (v: { open: boolean; size: Size }) => {
  try { localStorage.setItem(STORE, JSON.stringify(v)); } catch { /* private mode */ }
};

export const mountFlow: Plugin = (rt) => {
  const params = new URLSearchParams(location.search);
  if (!document.querySelector(`link[href="${FONT_HREF}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONT_HREF;
    document.head.appendChild(link);
  }
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.className = "fl-root";
  root.style.pointerEvents = "none"; // beats `#hud > *` so the canvas stays clickable
  root.innerHTML = `
<button class="fl-launch fl-px" data-act="toggle" title="Task flow (G)">▤ TASK FLOW <span class="n"></span><kbd>G</kbd></button>
<section class="fl-panel" hidden>
  <header class="fl-head">
    <div class="fl-title">TASK FLOW<small>was the path right?</small></div>
    <nav class="fl-tabs"></nav>
    <span class="fl-sp"></span>
    <button class="fl-btn" data-act="size" title="Half / full screen"></button>
    <button class="fl-btn" data-act="toggle" title="Close (G)">✕</button>
  </header>
  <div class="fl-body"></div>
  <footer class="fl-legend">
    <span><i style="border-color:#5ef2a0;background:rgba(94,242,160,.15)"></i>cited · useful path</span>
    <span><i style="border-color:#555;background:#333;opacity:.6"></i>visited, never cited</span>
    <span><i style="border-color:#ffb020;border-style:dashed"></i>gap</span>
    <span><i style="border-color:#d9a441;background:#d9a441"></i>stale</span>
    <span><i style="border-color:#ff5d6c"></i>protocol / grounding problem</span>
    <span><i style="border-color:#5b6070;border-style:dotted"></i>not walked</span>
    <span>◆ claim · ⌛ wait · ⇄ handoff · click a step to fly there</span>
  </footer>
</section>
<div class="fl-tip fl-px" hidden></div>`;
  rt.hud.appendChild(root);
  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const launch = $(".fl-launch"), panel = $(".fl-panel"), tabs = $(".fl-tabs"), body = $(".fl-body"), tip = $(".fl-tip"), sizeBtn = $("[data-act=size]");

  // ---------------------------------------------------------------- state
  const saved = load();
  const qp = params.get("flow");
  const st = {
    open: qp !== null ? qp !== "0" : !!saved.open,
    size: (qp === "full" ? "full" : qp === "half" ? "half" : saved.size ?? "half") as Size,
    sel: null as string | null, // flow key picked by the user
    autoSel: null as string | null,
    run: (params.get("flowrun") === "both" ? "both" : params.get("flowrun") ? Number(params.get("flowrun")) - 1 : "last") as RunView,
  };
  const segments: Segment[] = [{ events: [], archived: false }];
  const prior: Segment[] = []; // earlier replays fetched for comparison (demo only)
  let flows: Flow[] = [];
  let lastT = -1;
  let tips: Tip[] = [];
  let released = false;

  const onEvent = (e: Ev) => {
    let cur = segments.at(-1)!;
    // Replays and live dispatches both restart t at 0 (restart() emits no reset event).
    const restarted = cur.events.length > 0 && e.t + 0.5 < lastT;
    if (restarted) {
      cur.archived = true; // a new dispatch/replay: the old one stays available for comparison only
      segments.push((cur = { events: [], archived: false }));
      st.run = "last";
    }
    cur.events.push(e);
    lastT = e.t;
    dirty();
  };
  const unsub = rt.events.subscribe(onEvent);

  // ---------------------------------------------------------------- render
  let raf = 0;
  function dirty() {
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); });
  }

  function selected(): Flow | undefined {
    const live = flows.filter((f) => !f.archived);
    return live.find((f) => f.key === st.sel) ?? live.find((f) => f.key === st.autoSel) ?? live[0];
  }

  function render() {
    flows = buildFlows([...prior, ...segments], rt.palace);
    const live = flows.filter((f) => !f.archived);
    // A commissioned quest is the main demo flow: jump to it when it spawns.
    const quest = [...live].reverse().find((f) => f.spawned);
    if (quest && quest.key !== st.autoSel) { st.autoSel = quest.key; if (!st.sel || !live.some((f) => f.key === st.sel)) st.sel = null; }
    if (!st.autoSel && live[0]) st.autoSel = live[0].key;
    const flags = live.reduce((k, f) => k + (f.attempts.at(-1)?.score.redFlags ?? 0), 0);
    launch.querySelector(".n")!.innerHTML = live.length ? `· ${live.length}${flags ? ` <span class="bad">✗${flags}</span>` : ""}` : "";
    launch.classList.toggle("on", st.open);
    panel.hidden = !st.open;
    panel.classList.toggle("full", st.size === "full");
    sizeBtn.textContent = st.size === "full" ? "◧ HALF" : "⛶ FULL";
    if (!st.open) { tip.hidden = true; return; }

    const cur = selected();
    tabs.innerHTML = live.map((f) => {
      const a = f.attempts.at(-1);
      const s = a?.score;
      const em = !f.answer ? `<em class="run">…</em>` : s && s.redFlags ? `<em class="bad">✗${s.redFlags}</em>` : `<em class="ok">✓</em>`;
      return `<button class="fl-tab ${f === cur ? "on" : ""}" data-flow="${esc(f.key)}" style="--c:${f.color}" title="${esc(f.task)}"><i></i>${esc(f.label)}<span>${esc(f.task)}</span>${em}</button>`;
    }).join("");

    const scroll = body.scrollTop;
    tips = [];
    body.innerHTML = cur ? flowHTML(cur) : `<div class="fl-empty">No tasks yet.<br>Press <span class="fl-key">T</span> to dispatch the demo tasks, or commission a quest.<br>Each task's plan, path and answer shows up here.</div>`;
    body.scrollTop = scroll;
    body.querySelectorAll<HTMLElement>("[data-graph]").forEach(drawEdges);
    if (cur && wantsComparison(cur, flows)) fetchPrior();
  }

  function flowHTML(f: Flow): string {
    const runs = runsFor(f, flows);
    const L = lookupFor(rt.palace, f);
    if (!runs.length) return `<div class="fl-rootn" style="--c:${f.color}"><div class="k"><b>${esc(f.label)}</b> · task</div><div class="txt">${esc(f.task)}</div></div>${phasesHTML(f)}<div class="fl-empty">Planning…</div>`;
    const idx = st.run === "last" ? runs.length - 1 : st.run === "both" ? -1 : Math.min(st.run, runs.length - 1);
    const shown: RunRef[] = idx < 0 ? runs.slice(-2) : [runs[idx]];
    const { lanes, laneOf } = lanesFor(f, shown.map((r) => r.attempt), L);
    const label = (r: RunRef) => `run ${runs.indexOf(r) + 1}${runs.length > 1 ? ` of ${runs.length}` : ""}`;
    const droppedFor = (r: RunRef) => {
      const next = runs[runs.indexOf(r) + 1];
      if (!next) return new Set<string>();
      const keep = new Set(next.attempt.steps.map((s) => s.memoryId));
      return new Set(r.attempt.steps.map((s) => s.memoryId).filter((id) => !keep.has(id)));
    };

    let h = `<div class="fl-sum">${phasesHTML(f)}${shown.length === 1 ? scoreHTML(shown[0].attempt.score) : ""}</div>`;
    if (runs.length > 1) {
      const a = runs.at(-2)!.attempt, b = runs.at(-1)!.attempt;
      const pct = (x: number, y: number) => (x ? Math.round(((y - x) / x) * 100) : 0);
      const d = (x: number, y: number, unit = "") => `<span class="delta ${y > x ? "up" : ""}">${y - x > 0 ? "+" : ""}${unit === "%" ? pct(x, y) + "%" : (y - x).toFixed(unit === "s" ? 1 : 0) + unit}</span>`;
      const dropped = [...droppedFor(runs.at(-2)!)];
      h += `<div class="fl-cmp"><span class="lbl">COMPARE</span>
${runs.map((r, i) => `<button class="fl-btn ${idx === i ? "on" : ""}" data-run="${i}">RUN ${i + 1} · ${esc((r.attempt.source ?? "run").toUpperCase())}</button>`).join("")}
<button class="fl-btn ${idx < 0 ? "on" : ""}" data-run="both">BOTH</button>
<span>hops <b>${a.score.hops}→${b.score.hops}</b> ${d(a.score.hops, b.score.hops)}</span>
<span>tool calls <b>${a.score.toolCalls}→${b.score.toolCalls}</b> ${d(a.score.toolCalls, b.score.toolCalls, "%")}</span>
<span>time <b>${a.score.duration.toFixed(1)}s→${b.score.duration.toFixed(1)}s</b></span>
<span>useful <b>${a.score.useful}/${a.score.hops}→${b.score.useful}/${b.score.hops}</b></span>
${dropped.length ? `<div class="drop">Dropped by the learned route: ${dropped.map((id) => `<s>${esc(L.memory(id).title)}</s>`).join(", ")}</div>` : ""}</div>`;
    }
    if (shown.length === 1) h += graphHTML(shown[0], lanes, laneOf, L, tips, droppedFor(shown[0]), label(shown[0]));
    else
      h += `<div class="fl-pair">${shown.map((r) => `<div class="fl-col"><div class="fl-colh"><b>RUN ${runs.indexOf(r) + 1}</b> · ${esc(r.attempt.source ?? "")}</div>${scoreHTML(r.attempt.score)}<div style="height:10px"></div>${graphHTML(r, lanes, laneOf, L, tips, droppedFor(r), label(r))}</div>`).join("")}</div>`;
    return h;
  }

  // ---------------------------------------------------------------- comparison source (demo)
  const tried = new Set<string>();
  async function fetchPrior() {
    if (rt.events.mode !== "demo") return;
    const name = params.get("demo") || "demo-1";
    const m = name.match(/run(\d+)/);
    if (!m || Number(m[1]) < 2) return;
    const prev = name.replace(/run(\d+)/, `run${Number(m[1]) - 1}`);
    if (tried.has(prev)) return;
    tried.add(prev);
    try {
      const res = await fetch(`/replays/${prev}.jsonl`);
      if (!res.ok) return;
      const events = (await res.text()).split("\n").filter(Boolean).flatMap((l) => {
        const p = PalaceEvent.safeParse(JSON.parse(l));
        return p.success ? [p.data] : [];
      });
      prior.unshift({ events, archived: true });
      dirty();
    } catch { /* comparison is optional */ }
  }

  // ---------------------------------------------------------------- interaction
  function setOpen(open: boolean) {
    st.open = open;
    if (open && rt.controls.locked) { rt.controls.release(); released = true; }
    if (!open && released) { rt.controls.restore(); released = false; }
    save({ open: st.open, size: st.size });
    dirty();
  }

  root.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    const act = t.closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "toggle") return setOpen(!st.open);
    if (act === "size") { st.size = st.size === "full" ? "half" : "full"; save({ open: st.open, size: st.size }); return dirty(); }
    const tab = t.closest<HTMLElement>("[data-flow]");
    if (tab) { st.sel = tab.dataset.flow!; st.run = "last"; return dirty(); }
    const run = t.closest<HTMLElement>("[data-run]");
    if (run) {
      st.run = run.dataset.run === "both" ? "both" : Number(run.dataset.run);
      if (st.run === "both" && innerWidth < 1500) st.size = "full";
      return dirty();
    }
    const mem = t.closest<HTMLElement>("[data-mem]");
    if (mem) {
      if (st.size === "full") { st.size = "half"; dirty(); } // let the palace show where we're flying
      emitUI(UI_EVENTS.flyTo, { memoryId: mem.dataset.mem });
    }
  });

  body.addEventListener("mousemove", (ev) => {
    const n = (ev.target as HTMLElement).closest<HTMLElement>("[data-tip]");
    const t = n ? tips[Number(n.dataset.tip)] : undefined;
    if (!t) { tip.hidden = true; return; }
    if (tip.dataset.i !== n!.dataset.tip) { tip.innerHTML = t.html; tip.dataset.i = n!.dataset.tip; }
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(ev.clientX + 16, innerWidth - w - 8) + "px";
    tip.style.top = Math.min(ev.clientY + 14, innerHeight - h - 8) + "px";
  });
  body.addEventListener("mouseleave", () => { tip.hidden = true; tip.dataset.i = ""; });
  body.addEventListener("scroll", () => { tip.hidden = true; tip.dataset.i = ""; });

  const onKey = (ev: KeyboardEvent) => {
    const t = ev.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key.toLowerCase() === "g") setOpen(!st.open);
  };
  const onResize = () => dirty();
  addEventListener("keydown", onKey);
  addEventListener("resize", onResize);
  if (st.open && rt.controls.locked) { rt.controls.release(); released = true; }
  document.fonts?.ready.then(() => dirty());
  dirty();

  (window as any).flow = { st, get flows() { return flows; }, setOpen, render }; // browser QA

  return () => {
    unsub();
    removeEventListener("keydown", onKey);
    removeEventListener("resize", onResize);
    cancelAnimationFrame(raf);
    root.remove();
    style.remove();
  };
};
