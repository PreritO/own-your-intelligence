// OWNED BY: ui (polish, ui-v2, ui-v3). Game HUD: quest board (the centrepiece: free text + 6 quest cards), quest log (left), party bar
// (bottom), route checklist + memory page (right), activity drawer (bottom left, closed), toasts.
// Everything except the memory panel is a pure function of rt.events (same run rules as presence).
import type { Memory, PalaceEvent, Trace } from "../../../server/schema";
import { emitUI, UI_EVENTS, type Plugin } from "../api";
import { names, PRESENCE_EVENTS, registerSpawn, subscribeRuns } from "../agents/run";
import { CAMERA_EVENTS, HUD_INSETS } from "../controls";
import { champions, GYM_EVENTS, loadScoreboard, modelTag, type ScoreRow } from "./leaderboard";
import { CSS } from "./style";
import { commissionQuest, mountQuestBoard } from "./questBoard";

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Walk (web/src/walk.ts) talks to the UI through these; no-ops until mountUI runs. */
export const walkUI = {
  showAnswer(_trace: Trace, _source: string) {},
  showHop(_text: string) {},
  hide() {},
};

type Phase = "plan" | "explore" | "gym" | "execute" | "done";
const PHASES: Phase[] = ["plan", "explore", "gym", "execute", "done"];
const PHASE_LABEL: Record<Phase, string> = { plan: "Plan", explore: "Explore", gym: "Gym", execute: "Execute", done: "Done" };
type Tone = "" | "warn" | "ok" | "bad";
type AnswerEv = Extract<PalaceEvent, { type: "answer" }>;

interface Quest {
  agent: string;
  task: string;
  commissioned: boolean;
  route: string[];
  routeLabel: string;
  verdicts: Map<string, { verdict: string; note?: string }>; // this agent's verdict per station
  covered: Set<string>; // stations answered for this agent by a handoff reply
  claimed: string | null;
  status: string;
  tone: Tone;
  phase: Phase | null;
  hops: { explore: number; execute: number; total: number };
  rewards: number[];
  artifact: Memory | null;
  answer: AnswerEv | null;
  el: HTMLElement;
}

export const mountUI: Plugin = (rt) => {
  const N = names(rt.palace);
  const style = h("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  const params = new URLSearchParams(location.search);

  const root = h("div", "mp-ui");
  root.style.pointerEvents = "none"; // beats `#hud > *` so the canvas stays clickable
  rt.hud.appendChild(root);
  rt.setLayerVisible?.("links", params.has("links"));

  // =====================================================================================================
  // Quest log (left): New quest box, department demo, quest cards
  const logPanel = h("div", "mp-panel mp-log-panel");
  const hero = h("div", "mp-hero");
  hero.innerHTML =
    `<div class="brand">Mind Palace</div>` +
    `<div class="pitch">Harnesses like QM and UFO run agents. Mind Palace makes sure they can't bluff, and shows you.</div>` +
    `<ul class="claims"><li><b>Grounded</b> by construction: every answer cites a page it checked</li>` +
    `<li><b>Multiplayer</b> by design: departments own knowledge, so agents ask the owner</li>` +
    `<li><b>Gets better</b> with use: each run leaves a learned route</li></ul>`;
  const title = h("h2", "", "Quest log");
  const sub = h("div", "sub", "Pick a quest. A new agent asks each department that owns the answer, trains in the Gym, then does the job.");
  const form = h("form", "mp-newquest");
  const input = h("input");
  input.placeholder = "Give the company a task, e.g. Create an onboarding page for new engineers";
  input.autocomplete = "off";
  input.setAttribute("aria-label", "New quest");
  const go = h("button", "mp-btn go", "▶ Commission");
  go.type = "submit";
  form.append(input, go);
  form.onsubmit = (ev) => {
    ev.preventDefault();
    const typed = input.value.trim();
    // an empty box commissions the placeholder, which is the onboarding quest
    if (typed) commissionQuest(typed);
    else commissionQuest(input.placeholder.replace(/^.*e\.g\. /, ""), "onboarding");
    input.blur();
  };
  input.addEventListener("keydown", (ev) => ev.stopPropagation()); // typing must not steer the camera
  input.addEventListener("keyup", (ev) => ev.stopPropagation());
  const actions = h("div", "mp-actions");
  const demoBtn = h("button", "mp-btn small", "▶ Demo: 3 department tasks");
  demoBtn.onclick = () => window.dispatchEvent(new CustomEvent(PRESENCE_EVENTS.dispatch));
  demoBtn.title = "Legal, Finance and Eng each get a task (T)";
  const replayBtn = h("button", "mp-btn small", "↻ Replay");
  replayBtn.title = "Play the last run again from the start";
  replayBtn.onclick = () => window.dispatchEvent(new CustomEvent(PRESENCE_EVENTS.replay, { detail: {} }));
  actions.append(demoBtn, replayBtn);
  const quests = h("div", "mp-quests");
  const empty = h("div", "mp-empty", "No quests yet. Type one above and press Commission, or run the department demo.");
  quests.appendChild(empty);
  logPanel.append(hero, title, quests);
  root.appendChild(logPanel);
  // the New quest box is the centrepiece: top centre. Collapsed by default to the input + Commission;
  // "▾ Example quests" expands the six quest cards (and the demo buttons) underneath.
  const top = h("div", "mp-panel mp-top");
  input.id = "mp-quest-input";
  const exBtn = h("button", "mp-btn small mp-extoggle");
  exBtn.type = "button";
  exBtn.setAttribute("aria-controls", "mp-quest-examples");
  form.appendChild(exBtn);
  const drawer = h("div", "mp-drawer");
  drawer.id = "mp-quest-examples";
  const board = h("div", "mp-board");
  void mountQuestBoard(board, rt.palace).then((qs) => ((window as any).quests = qs)); // browser QA
  drawer.append(board, sub, actions);
  top.append(form, drawer);
  root.appendChild(top);
  const EX_KEY = "mp:quest-examples-open";
  let examplesOpen = false;
  try { examplesOpen = localStorage.getItem(EX_KEY) === "1"; } catch { /* storage blocked: start collapsed */ }
  /** remember=true for the viewer's own toggles; automatic collapses (quest started) aren't a preference. */
  function setExamples(open: boolean, remember = false) {
    examplesOpen = open;
    drawer.hidden = !open;
    top.classList.toggle("open", open);
    exBtn.textContent = open ? "▴ Hide examples" : "▾ Example quests";
    exBtn.setAttribute("aria-expanded", String(open));
    exBtn.title = open ? "Hide the example quests" : "Show six example quests to commission";
    if (remember) try { localStorage.setItem(EX_KEY, open ? "1" : "0"); } catch { /* ignore */ }
  }
  setExamples(examplesOpen);
  exBtn.onclick = () => setExamples(!examplesOpen, true);
  // a card click or a typed quest commissions; either way the drawer folds away for the run
  const onCommissioned = () => setExamples(false);
  addEventListener(PRESENCE_EVENTS.commission, onCommissioned);
  // Frame the overview below the compact bar (controls.ts reads HUD_INSETS on every overview pose).
  // Measured on the collapsed bar only, so expanding the examples never moves the camera.
  requestAnimationFrame(() => {
    const wasOpen = examplesOpen;
    if (wasOpen) drawer.hidden = true;
    const bottom = Math.ceil(top.getBoundingClientRect().bottom);
    if (wasOpen) drawer.hidden = false;
    if (bottom > 0 && bottom + 24 !== HUD_INSETS.top) {
      HUD_INSETS.top = bottom + 24;
      window.dispatchEvent(new CustomEvent(CAMERA_EVENTS.home));
    }
  });

  // =====================================================================================================
  // Party bar (bottom): commissioned agents first, then the department staff
  const partyEl = h("div", "mp-panel mp-party");
  root.appendChild(partyEl);
  const mapSlot = h("button", "mp-slot map on", "⌂ Map");
  mapSlot.title = "Back to the overview (Esc)";
  mapSlot.onclick = () => follow("overview");
  const gymSlot = h("button", "mp-slot map gym", "🏋 Gym");
  gymSlot.title = "Fly to the Gym: River training leaderboard (Esc returns)";
  gymSlot.onclick = () => {
    setExamples(false); // the example cards would sit under the leaderboard
    window.dispatchEvent(new CustomEvent(GYM_EVENTS.go));
  };
  const onGymState = (ev: Event) => gymSlot.classList.toggle("on", !!(ev as CustomEvent).detail?.open);
  // Party bar shows each department agent's promoted River model (fixtures/gym-scoreboard.json), if any.
  const promotedModel = new Map<string, string>();
  const applyScoreboard = (rows: ScoreRow[] | null) => {
    promotedModel.clear();
    for (const [team, r] of champions(rows ?? [])) if (r.promoted) promotedModel.set(team, modelTag(r));
    renderParty();
  };
  const onScoreboard = (ev: Event) => applyScoreboard((ev as CustomEvent).detail?.rows ?? null);
  addEventListener(GYM_EVENTS.scoreboard, onScoreboard);
  void loadScoreboard().then(applyScoreboard);
  addEventListener(GYM_EVENTS.state, onGymState);
  const keysEl = h("div", "mp-keys");
  keysEl.innerHTML = `<b>1-9</b> follow · <b>G</b> flow<br><b>Esc</b> map · <b>T</b> demo`;
  const slotStatus = new Map<string, { text: string; tone: Tone }>();
  const spawned: string[] = [];
  let following = "overview";
  const partyOrder = () => [...spawned, ...rt.palace.agents.map((a) => a.id)];
  function face(agent: string) {
    const f = h("span", "mp-face", N.agent(agent).charAt(0).toUpperCase());
    f.style.setProperty("--c", N.color(agent));
    return f;
  }
  function renderParty() {
    partyEl.replaceChildren(mapSlot, gymSlot);
    mapSlot.classList.toggle("on", following === "overview");
    partyOrder().forEach((id, i) => {
      const slot = h("button", spawned.includes(id) ? "mp-slot quest" : "mp-slot");
      slot.style.setProperty("--c", N.color(id));
      slot.classList.toggle("on", following === id);
      slot.title = `Follow ${N.agent(id)} (${i + 1})`;
      const key = h("span", "key", i < 9 ? String(i + 1) : "");
      if (i >= 9) key.hidden = true;
      const mid = h("div");
      const team = rt.palace.agents.find((a) => a.id === id)?.team ?? id;
      const idle = promotedModel.get(team); // e.g. "River gen2" once river-serve promotes one
      const st = slotStatus.get(id) ?? { text: spawned.includes(id) ? "on a quest" : idle ?? "at their desk", tone: "" as Tone };
      mid.append(h("div", "nm", N.agent(id)), h("div", `doing ${st.tone}`, st.text));
      slot.append(key, face(id), mid);
      slot.onclick = () => follow(id);
      partyEl.appendChild(slot);
    });
    partyEl.appendChild(keysEl);
  }
  const follow = (mode: string) => window.dispatchEvent(new CustomEvent(PRESENCE_EVENTS.camera, { detail: { mode } }));

  // =====================================================================================================
  // Right column: memory page + route checklist (follow mode)
  const right = h("div", "mp-right");
  root.appendChild(right);
  let memPanel: HTMLElement | null = null;
  let routePanel: HTMLElement | null = null;
  let currentMem: string | null = null;

  // =====================================================================================================
  // Dock (bottom left): activity drawer + links toggle
  const dock = h("div", "mp-dock");
  const activity = h("div", "mp-panel mp-activity");
  activity.hidden = true;
  const row = h("div", "row");
  const actBtn = h("button", "mp-btn small", "Activity ▸");
  let actCount = 0;
  actBtn.onclick = () => {
    activity.hidden = !activity.hidden;
    actBtn.classList.toggle("on", !activity.hidden);
    syncActBtn();
  };
  const syncActBtn = () => (actBtn.textContent = `${activity.hidden ? "Activity ▸" : "Activity ▾"}${actCount ? ` ${actCount}` : ""}`);
  let linksOn = params.has("links");
  const linksBtn = h("button", `mp-btn small${linksOn ? " on" : ""}`, "Links");
  linksBtn.title = "Show the links between memories";
  linksBtn.onclick = () => {
    linksOn = !linksOn;
    linksBtn.classList.toggle("on", linksOn);
    rt.setLayerVisible?.("links", linksOn);
  };
  row.append(actBtn, linksBtn);
  dock.append(activity, row);
  root.appendChild(dock);

  // =====================================================================================================
  // Quest state from the stream
  const questMap = new Map<string, Quest>();
  const handoffs = new Map<string, { from: string; to: string; memoryId: string; question: string }>();
  const verdictsByMem = new Map<string, { agent: string; verdict: string; note?: string }[]>();

  function quest(agent: string, task?: string, commissioned = false): Quest {
    let q = questMap.get(agent);
    if (!q) {
      const el = h("div", "mp-quest");
      el.tabIndex = 0;
      el.onclick = (ev) => {
        if ((ev.target as HTMLElement).closest(".mp-chip, .mp-btn")) return;
        follow(agent);
      };
      q = {
        agent, task: task ?? "", commissioned, route: [], routeLabel: "", verdicts: new Map(), covered: new Set(), claimed: null,
        status: "Queued", tone: "", phase: null, hops: { explore: 0, execute: 0, total: 0 }, rewards: [], artifact: null, answer: null, el,
      };
      questMap.set(agent, q);
      empty.remove();
      if (commissioned) quests.prepend(el);
      else quests.appendChild(el);
    }
    if (task) q.task = task;
    if (commissioned) q.commissioned = true;
    return q;
  }

  const doneCount = (q: Quest) => q.route.filter((m) => q.verdicts.has(m) || q.covered.has(m)).length;

  function renderQuest(q: Quest) {
    const el = q.el;
    el.style.setProperty("--c", N.color(q.agent));
    el.classList.toggle("on", following === q.agent);
    el.classList.toggle("hero", q.commissioned);
    el.replaceChildren();
    const top = h("div", "top");
    top.append(face(q.agent), h("span", "who", N.agent(q.agent)));
    if (q.route.length) top.appendChild(h("span", "step", `${doneCount(q)}/${q.route.length}`));
    el.append(top, h("div", "q", q.task || "…"));

    if (q.commissioned) {
      const steps = h("div", "mp-phases");
      const cur = q.phase ? PHASES.indexOf(q.phase) : -1;
      PHASES.forEach((p, i) => {
        const s = h("span", i < cur || q.phase === "done" ? "past" : i === cur ? "now" : "", PHASE_LABEL[p]);
        steps.appendChild(s);
      });
      el.appendChild(steps);
    }
    if (q.route.length) {
      const bar = h("div", "mp-bar");
      const firstOpen = q.route.findIndex((m) => !q.verdicts.has(m) && !q.covered.has(m));
      q.route.forEach((m, i) => {
        const v = q.verdicts.get(m)?.verdict;
        const cls = v === "gap" ? "gap" : v === "stale" ? "stale" : v || q.covered.has(m) ? "done" : i === firstOpen && !q.answer ? "cur" : "";
        const seg = h("i", cls);
        seg.title = N.memory(m);
        bar.appendChild(seg);
      });
      el.appendChild(bar);
    }
    el.appendChild(h("div", `st ${q.tone}`, q.status));
    if (q.commissioned && (q.hops.explore || q.hops.execute)) {
      const hops = h("div", "mp-hops");
      hops.innerHTML = q.hops.execute
        ? `Explore <b>${q.hops.explore}</b> hops → learned route <b>${q.hops.execute}</b> hops`
        : `Explore <b>${q.hops.explore}</b> hops`;
      el.appendChild(hops);
    }
    if (q.rewards.length > 1) el.appendChild(sparkline(q.rewards, N.color(q.agent)));
    if (q.artifact) {
      const art = h("div", "mp-artifact");
      art.append(h("span", "", `📜 New page: ${q.artifact.title}`));
      const view = h("button", "mp-btn small", "View page");
      const mem = q.artifact;
      view.onclick = () => viewMemory(mem);
      art.appendChild(view);
      el.appendChild(art);
    }
    if (q.answer) {
      const a = q.answer;
      const ans = h("div", "ans");
      if (a.blocked) ans.appendChild(h("div", "ban", "Blocked: it cited a station nobody verified"));
      ans.appendChild(h("div", "", a.text));
      const chips = h("div", "mp-chips");
      a.citations.forEach((c) => chips.appendChild(chip(c)));
      a.gaps?.forEach((c) => chips.appendChild(chip(c, "gap")));
      a.stale?.forEach((c) => chips.appendChild(chip(c, "stale")));
      ans.appendChild(chips);
      el.appendChild(ans);
    }
    if (following === q.agent) renderRoute();
  }

  function chip(memId: string, kind: "" | "gap" | "stale" = "") {
    const c = h("span", `mp-chip ${kind}`, (kind === "gap" ? "gap: " : kind === "stale" ? "stale: " : "") + N.memory(memId));
    c.title = memId;
    c.onclick = () => openMemory(memId, true);
    return c;
  }

  function sparkline(values: number[], color: string) {
    const w = 300, hgt = 34;
    const lo = Math.min(...values), hi = Math.max(...values);
    const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(hgt - 3 - ((v - lo) / (hi - lo || 1)) * (hgt - 6)).toFixed(1)}`).join(" ");
    const wrap = h("div", "mp-spark");
    wrap.innerHTML = `<span>Gym reward ${values[values.length - 1].toFixed(2)}</span><svg viewBox="0 0 ${w} ${hgt}" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke="${color}" stroke-width="3" points="${pts}"/></svg>`;
    return wrap;
  }

  // ---- activity lines (plain words)
  const A = (id: string) => `<b style="--c:${N.color(id)}">${esc(N.agent(id))}</b>`;
  const M = (id: string) => `<span class="m">${esc(N.memory(id))}</span>`;
  function line(e: PalaceEvent, html: string, cls = "") {
    const r = h("div", `mp-row ${cls}`);
    r.style.setProperty("--c", N.color(e.agent));
    const x = h("span", "x");
    x.innerHTML = html;
    r.append(h("span", "t", `${e.t.toFixed(1)}s`), x);
    activity.prepend(r);
    while (activity.children.length > 120) activity.lastChild?.remove();
    actCount++;
    syncActBtn();
  }
  const slot = (agent: string, text: string, tone: Tone = "") => slotStatus.set(agent, { text, tone });

  function reset() {
    questMap.clear();
    quests.replaceChildren(empty);
    handoffs.clear();
    verdictsByMem.clear();
    slotStatus.clear();
    spawned.length = 0;
    activity.replaceChildren();
    actCount = 0;
    syncActBtn();
    hideBanner();
    renderParty();
    renderRoute();
  }

  function handle(e: PalaceEvent) {
    if (e.type === "train_step") {
      const q = questMap.get(e.agent);
      if (q && (q.phase === "gym" || q.commissioned)) {
        q.rewards.push(e.reward);
        q.status = `Training in the Gym · step ${e.step}`;
        renderQuest(q);
      }
      return;
    }
    const q = questMap.get(e.agent);
    switch (e.type) {
      case "spawn": {
        registerSpawn(N, e);
        setExamples(false); // a quest started: fold the example cards away
        if (!spawned.includes(e.agent)) spawned.unshift(e.agent);
        const nq = quest(e.agent, e.task, true);
        nq.status = "Arrived in the foyer";
        nq.phase = "plan";
        slot(e.agent, "just arrived");
        line(e, `${A(e.agent)} arrived for a new quest${e.task ? `: “${esc(e.task)}”` : ""}`);
        renderQuest(nq);
        break;
      }
      case "phase": {
        const pq = quest(e.agent);
        pq.phase = e.phase;
        const words: Record<Phase, string> = {
          plan: "Planning the route",
          explore: "Touring the departments",
          gym: "Training in the Gym",
          execute: "Running the learned route",
          done: "Quest complete",
        };
        pq.status = e.note ? `${words[e.phase]}: ${e.note}` : words[e.phase];
        pq.tone = e.phase === "done" ? "ok" : "";
        slot(e.agent, words[e.phase].toLowerCase(), e.phase === "done" ? "ok" : "");
        line(e, `${A(e.agent)} ${esc(words[e.phase].toLowerCase())}${e.note ? ` (${esc(e.note)})` : ""}`);
        renderQuest(pq);
        if (e.phase === "done") maybeBanner(pq);
        break;
      }
      case "artifact": {
        N.mems.set(e.memory.id, e.memory);
        const aq = quest(e.agent);
        aq.artifact = e.memory;
        aq.status = `Wrote a new page: ${e.memory.title}`;
        slot(e.agent, "wrote a page", "ok");
        line(e, `${A(e.agent)} wrote a new page ${M(e.memory.id)}`);
        toast(`📜 New page: ${e.memory.title}`);
        renderQuest(aq);
        break;
      }
      case "task": {
        const tq = quest(e.agent, e.text, !!q?.commissioned);
        tq.status = "Picking a route";
        slot(e.agent, "picking a route");
        line(e, `${A(e.agent)} got a task: “${esc(e.text)}”`);
        renderQuest(tq);
        break;
      }
      case "route": {
        const rq = quest(e.agent);
        rq.route = e.stations;
        rq.verdicts = new Map();
        rq.covered = new Set();
        rq.routeLabel = rt.palace.routes.find((r) => r.id === e.routeId)?.label ?? e.routeId;
        const how = e.source === "learned" ? "Learned route" : e.source === "explore" ? "Exploring" : "Route";
        rq.status = `${how}: ${rq.routeLabel}, ${e.stations.length} stops`;
        line(e, `${A(e.agent)} picked ${esc(how.toLowerCase())} <span class="m">${esc(rq.routeLabel)}</span> · ${e.stations.length} stops`);
        renderQuest(rq);
        break;
      }
      case "move": {
        const room = N.rooms.get(e.to);
        const team = N.agents.get(e.agent)?.team;
        const foreign = !!room && !!team && room.owner !== "shared" && room.owner !== team;
        const text = foreign ? `At the door of ${N.room(e.to)} (${room!.owner}'s room)` : `Walking to ${N.room(e.to)}`;
        slot(e.agent, foreign ? `at ${N.room(e.to)} door` : `walking to ${N.room(e.to)}`);
        line(e, foreign ? `${A(e.agent)} stopped at the door of ${esc(N.room(e.to))} (${esc(room!.owner)} owns it)` : `${A(e.agent)} walked to ${esc(N.room(e.to))}`);
        if (q && !q.answer) {
          q.status = text;
          q.tone = "";
          renderQuest(q);
        }
        break;
      }
      case "claim": {
        const i = q ? q.route.indexOf(e.memoryId) : -1;
        const text = i >= 0 ? `Step ${i + 1} of ${q!.route.length}: reading ${N.memory(e.memoryId)}` : `Reading ${N.memory(e.memoryId)}`;
        slot(e.agent, `reading ${N.memory(e.memoryId)}`);
        line(e, `${A(e.agent)} claimed ${M(e.memoryId)}`);
        if (q) {
          q.claimed = e.memoryId;
          q.status = text;
          q.tone = "";
          renderQuest(q);
        }
        break;
      }
      case "wait":
        slot(e.agent, `waiting on ${N.agent(e.heldBy)}`, "warn");
        line(e, `${A(e.agent)} waits: ${A(e.heldBy)} holds ${M(e.memoryId)}`, "wait");
        if (q) {
          q.status = `Waiting on ${N.agent(e.heldBy)} (${N.memory(e.memoryId)})`;
          q.tone = "warn";
          renderQuest(q);
        }
        break;
      case "visit": {
        const list = verdictsByMem.get(e.memoryId) ?? [];
        list.push({ agent: e.agent, verdict: e.verdict, note: e.note });
        verdictsByMem.set(e.memoryId, list);
        if (q) {
          q.verdicts.set(e.memoryId, { verdict: e.verdict, note: e.note });
          q.hops.total++;
          if (q.phase === "execute") q.hops.execute++;
          else if (q.commissioned) q.hops.explore++;
        }
        if (e.verdict === "gap") {
          slot(e.agent, `gap: ${N.memory(e.memoryId)}`, "warn");
          line(e, `${A(e.agent)} found a gap at ${M(e.memoryId)}: ${esc(e.note ?? "nothing recorded")}`, "gap");
          if (q) (q.status = `Gap found: ${N.memory(e.memoryId)}, ${e.note ?? "nothing recorded"}`), (q.tone = "warn");
        } else if (e.verdict === "stale") {
          line(e, `${A(e.agent)}: ${M(e.memoryId)} is stale${e.note ? ` (${esc(e.note)})` : ""}`, "stale");
          if (q) (q.status = `${N.memory(e.memoryId)} is stale${e.note ? `: ${e.note}` : ""}`), (q.tone = "warn");
        } else {
          line(e, `${A(e.agent)} verified ${M(e.memoryId)}${e.note ? ` (${esc(e.note)})` : ""}`);
          if (q) (q.status = `Verified ${N.memory(e.memoryId)}`), (q.tone = "");
        }
        if (q) renderQuest(q);
        if (currentMem === e.memoryId) openMemory(e.memoryId, false);
        break;
      }
      case "handoff": {
        handoffs.set(e.id, { from: e.agent, to: e.toAgent, memoryId: e.memoryId, question: e.question });
        slot(e.agent, `asking ${N.agent(e.toAgent)}`);
        slot(e.toAgent, `answering ${N.agent(e.agent)}`);
        line(e, `${A(e.agent)} asked ${A(e.toAgent)}: “${esc(e.question)}”`, "handoff");
        if (q) {
          q.status = `Asking ${N.agent(e.toAgent)}: ${e.question}`;
          q.tone = "";
          renderQuest(q);
        }
        break;
      }
      case "reply": {
        const hnd = handoffs.get(e.id);
        line(e, `${A(e.agent)} answered ${hnd ? A(hnd.from) : "the handoff"}: “${esc(e.answer)}”`, "reply");
        if (hnd) {
          slot(e.agent, `answered ${N.agent(hnd.from)}`, "ok");
          const fq = questMap.get(hnd.from);
          if (fq) {
            if (fq.route.includes(hnd.memoryId)) fq.covered.add(hnd.memoryId);
            fq.status = `${N.agent(e.agent)} answered: ${e.answer}`;
            fq.tone = "";
            renderQuest(fq);
          }
        }
        break;
      }
      case "answer": {
        const aq = quest(e.agent);
        aq.answer = e;
        aq.status = e.blocked ? "Answer blocked" : e.gaps?.length ? "Done, with a gap reported" : "Done";
        aq.tone = e.blocked ? "bad" : e.gaps?.length ? "warn" : "ok";
        slot(e.agent, e.blocked ? "blocked" : e.gaps?.length ? "done, gap" : "done", e.blocked ? "bad" : e.gaps?.length ? "warn" : "ok");
        line(e, `${A(e.agent)} posted an answer${e.gaps?.length ? " and reported a gap" : ""}`, e.blocked ? "blocked" : e.gaps?.length ? "gap" : "");
        renderQuest(aq);
        maybeBanner(aq);
        break;
      }
    }
    renderParty();
  }

  const unsub = subscribeRuns(rt, reset, handle);

  // =====================================================================================================
  // Completion banner (commissioned quests): answer + phase done
  const banner = h("div", "mp-panel mp-banner");
  banner.hidden = true;
  root.appendChild(banner);
  function hideBanner() {
    banner.hidden = true;
  }
  function maybeBanner(q: Quest) {
    if (!q.commissioned || !q.answer || q.phase !== "done") return;
    banner.replaceChildren();
    banner.style.setProperty("--c", N.color(q.agent));
    const close = h("button", "mp-btn small x", "✕");
    close.onclick = hideBanner;
    close.title = "Close";
    banner.append(close, h("div", "big", "Quest complete"), h("div", "task", q.task));
    banner.appendChild(h("div", "txt", q.answer.text));
    const chips = h("div", "mp-chips");
    q.answer.citations.forEach((c) => chips.appendChild(chip(c)));
    q.answer.gaps?.forEach((c) => chips.appendChild(chip(c, "gap")));
    q.answer.stale?.forEach((c) => chips.appendChild(chip(c, "stale")));
    banner.appendChild(chips);
    if (q.artifact) {
      const mem = q.artifact;
      const view = h("button", "mp-btn go", `📜 View page: ${mem.title}`);
      view.onclick = () => {
        hideBanner();
        viewMemory(mem);
      };
      banner.appendChild(view);
    }
    banner.hidden = false;
  }

  // =====================================================================================================
  // Follow mode: route checklist on the right
  function renderRoute() {
    routePanel?.remove();
    routePanel = null;
    if (following === "overview") return;
    const q = questMap.get(following);
    const p = h("div", "mp-panel mp-route");
    p.style.setProperty("--c", N.color(following));
    const hd = h("div", "hd");
    const names2 = h("div");
    names2.append(h("div", "nm", N.agent(following)), h("div", "rt", q?.routeLabel ? `Route: ${q.routeLabel}` : "No route yet"));
    hd.append(face(following), names2);
    p.appendChild(hd);
    if (q?.task) p.appendChild(h("div", "q", q.task));
    if (q?.route.length) {
      const ol = h("ol", "mp-stops");
      const firstOpen = q.route.findIndex((m) => !q.verdicts.has(m) && !q.covered.has(m));
      q.route.forEach((m, i) => {
        const v = q.verdicts.get(m);
        const cls = v?.verdict === "gap" ? "gap" : v?.verdict === "stale" ? "stale" : v || q.covered.has(m) ? "done" : i === firstOpen && !q.answer ? "cur" : "";
        const li = h("li", `mp-stop ${cls}`);
        const mid = h("div");
        const vtext = v
          ? v.verdict === "verified" ? `✓ verified${v.note ? `, ${v.note}` : ""}` : `${v.verdict}${v.note ? `: ${v.note}` : ""}`
          : q.covered.has(m) ? "✓ answered by the owner (handoff)" : cls === "cur" ? (q.claimed === m ? "reading now" : "next") : "not yet";
        mid.append(h("div", "t", N.memory(m)), h("div", "r", N.room(N.mems.get(m)?.room ?? "")), h("div", "v", vtext));
        li.append(h("span", "n", v?.verdict === "gap" ? "!" : cls === "done" ? "✓" : String(i + 1)), mid);
        li.onclick = () => openMemory(m, true);
        ol.appendChild(li);
      });
      p.appendChild(ol);
    } else p.appendChild(h("div", "rt", "Waiting for this agent to pick a route."));
    const back = h("button", "mp-btn back", "◀ Back to map (Esc)");
    back.onclick = () => follow("overview");
    p.appendChild(back);
    right.appendChild(p);
    routePanel = p;
  }

  const onMode = (ev: Event) => {
    const d = (ev as CustomEvent).detail ?? {};
    following = d.mode === "free" || d.mode === "overhead" || !d.mode ? "overview" : d.mode;
    for (const q of questMap.values()) q.el.classList.toggle("on", q.agent === following);
    renderParty();
    renderRoute();
  };
  addEventListener(PRESENCE_EVENTS.mode, onMode);

  // =====================================================================================================
  // Memory page (right, above the route)
  function closeMemory() {
    memPanel?.remove();
    memPanel = null;
    currentMem = null;
  }
  function viewMemory(m: Memory) {
    window.dispatchEvent(new CustomEvent(CAMERA_EVENTS.focus, { detail: { pos: m.pos, distance: 12 } }));
    openMemory(m.id, false);
  }
  function openMemory(id: string, fly: boolean) {
    const m = N.mems.get(id);
    if (!m) return;
    if (fly) window.dispatchEvent(new CustomEvent(CAMERA_EVENTS.focus, { detail: { pos: m.pos, distance: 12 } }));
    closeMemory();
    currentMem = id;
    const p = h("div", "mp-panel mp-mem");
    const x = h("button", "mp-btn small x", "✕");
    x.title = "Close (Esc)";
    x.onclick = closeMemory;
    const room = N.rooms.get(m.room);
    const wing = rt.palace.wings.find((w) => w.id === room?.wing);
    const ttl = h("div", "ttl", m.title);
    if (wing) ttl.style.color = wing.color;
    const meta = h("div", "meta", `${room?.label ?? m.room}${wing ? `, ${wing.label} wing` : ""}`);
    const fresh = h("div", "mp-fresh");
    const bar = h("i");
    bar.style.width = `${Math.round(m.freshness * 100)}%`;
    fresh.appendChild(bar);
    const fl = h("div", "meta", `Freshness ${Math.round(m.freshness * 100)}%${m.freshness < 0.3 ? ", stale" : ""}`);
    p.append(x, ttl, meta, fresh, fl);
    const vs = verdictsByMem.get(id);
    if (vs?.length) {
      p.appendChild(h("h3", "", "What the agents found"));
      const box = h("div", "mp-verdicts");
      for (const v of vs) {
        const r = h("div");
        r.innerHTML = `${A(v.agent)}: <span style="color:${v.verdict === "verified" ? "var(--ok)" : v.verdict === "gap" ? "var(--amber)" : "var(--stale)"}">${v.verdict}</span>${v.note ? `, ${esc(v.note)}` : ""}`;
        box.appendChild(r);
      }
      p.appendChild(box);
    }
    p.appendChild(h("div", `ex${m.excerpt ? "" : " empty"}`, m.excerpt || "This page is empty. Nothing is recorded here yet."));
    const seen = new Set<string>();
    const links = rt.palace.links.filter((l) => {
      const other = l.from === id ? l.to : l.to === id ? l.from : null;
      if (!other || other === id || seen.has(other)) return false;
      seen.add(other);
      return true;
    });
    if (links.length) {
      p.appendChild(h("h3", "", "Linked pages"));
      for (const l of links) {
        const other = l.from === id ? l.to : l.from;
        const r = h("div", "mp-link");
        r.append(h("span", "", N.memory(other)), h("span", "k", l.kind));
        r.onclick = () => openMemory(other, true);
        p.appendChild(r);
      }
    }
    right.prepend(p);
    memPanel = p;
  }
  const onSelect = (ev: Event) => {
    const id = (ev as CustomEvent).detail?.memoryId;
    if (typeof id === "string") openMemory(id, false);
  };
  addEventListener(UI_EVENTS.select, onSelect);

  // =====================================================================================================
  // Toast
  const toastEl = h("div", "mp-panel mp-toast");
  toastEl.style.opacity = "0";
  root.appendChild(toastEl);
  let toastTimer = 0;
  function toast(text: string, tone = "") {
    toastEl.textContent = text;
    toastEl.className = `mp-panel mp-toast ${tone}`;
    toastEl.style.opacity = "1";
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toastEl.style.opacity = "0"), 3200);
  }
  const onStatus = (ev: Event) => {
    const d = (ev as CustomEvent).detail ?? {};
    toast(d.text ?? "", d.tone === "warn" ? "warn" : "");
  };
  addEventListener(PRESENCE_EVENTS.status, onStatus);

  // =====================================================================================================
  // Ask bar ("/"), walk answer panel
  let ask: HTMLElement | null = null;
  function openAsk() {
    if (ask) return ask.querySelector("input")!.focus();
    ask = h("form", "mp-panel mp-ask");
    const inp = h("input");
    inp.placeholder = "Ask the palace, e.g. Can we sign the Gripworks contract this week?";
    inp.autocomplete = "off";
    const b = h("button", "mp-btn", "Walk it");
    b.type = "submit";
    ask.append(inp, b);
    (ask as HTMLFormElement).onsubmit = (ev) => {
      ev.preventDefault();
      const question = inp.value.trim() || inp.placeholder.replace(/^.*e\.g\. /, "");
      closeAsk();
      emitUI(UI_EVENTS.ask, { question });
    };
    inp.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Escape") closeAsk();
    });
    inp.addEventListener("keyup", (ev) => ev.stopPropagation());
    root.appendChild(ask);
    inp.focus();
  }
  function closeAsk() {
    ask?.remove();
    ask = null;
  }
  let walkPanel: HTMLElement | null = null;
  walkUI.hide = () => {
    walkPanel?.remove();
    walkPanel = null;
  };
  walkUI.showHop = (text) => {
    if (!walkPanel) {
      walkPanel = h("div", "mp-panel mp-walk");
      root.appendChild(walkPanel);
    }
    walkPanel.replaceChildren(h("span", "esc", "Esc to return"), h("div", "hop", text));
  };
  walkUI.showAnswer = (trace, source) => {
    walkUI.hide();
    const p = h("div", "mp-panel mp-walk");
    p.append(h("span", "esc", `Esc to return · ${source}`), h("div", "q", trace.question), h("div", "a", trace.answer));
    const chips = h("div", "mp-chips");
    trace.answerMemoryIds.forEach((id) => chips.appendChild(chip(id)));
    p.appendChild(chips);
    root.appendChild(p);
    walkPanel = p;
  };

  const onKey = (ev: KeyboardEvent) => {
    const t = ev.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (ev.key === "/") {
      ev.preventDefault();
      openAsk();
    } else if (ev.key === "n" || ev.key === "N") {
      ev.preventDefault();
      input.focus();
    } else if (ev.key === "Escape") {
      if (ask) closeAsk();
      else if (!banner.hidden) hideBanner();
      else if (memPanel) closeMemory();
    }
  };
  addEventListener("keydown", onKey);

  renderParty();

  return () => {
    unsub();
    removeEventListener(UI_EVENTS.select, onSelect);
    removeEventListener(PRESENCE_EVENTS.status, onStatus);
    removeEventListener(PRESENCE_EVENTS.mode, onMode);
    removeEventListener("keydown", onKey);
    removeEventListener(PRESENCE_EVENTS.commission, onCommissioned);
    removeEventListener(GYM_EVENTS.state, onGymState);
    removeEventListener(GYM_EVENTS.scoreboard, onScoreboard);
    root.remove();
    style.remove();
  };
};
