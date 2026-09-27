// OWNED BY: presence. Memory side panel, ask bar, answer panel, event feed.
// The feed/roster/answers are a pure function of rt.events (same rules as the presence layer).
import type { PalaceEvent, Trace } from "../../../server/schema";
import { emitUI, UI_EVENTS, type Plugin } from "../api";
import { names, PRESENCE_EVENTS, subscribeRuns } from "../agents/run";
import { CSS } from "./style";

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Walk (web/src/walk.ts) talks to the UI through these; no-ops until mountUI runs. */
export const walkUI = {
  showAnswer(_trace: Trace, _source: string) {},
  showHop(_text: string) {},
  hide() {},
};

type Verdicts = Map<string, { agent: string; verdict: string; note?: string }[]>;

export const mountUI: Plugin = (rt) => {
  const N = names(rt.palace);
  const style = h("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = h("div", "mp-ui");
  root.style.pointerEvents = "none"; // beats `#hud > *` so the canvas stays clickable
  rt.hud.appendChild(root);

  const verdicts: Verdicts = new Map();
  const chip = (memId: string, kind: "" | "gap" | "stale" = "") => {
    const c = h("span", `mp-chip ${kind}`, (kind === "gap" ? "gap: " : kind === "stale" ? "stale: " : "") + N.memory(memId));
    c.title = memId;
    c.onclick = () => openMemory(memId, true);
    return c;
  };

  // ---------- right column
  const right = h("div", "mp-right");
  const roster = h("div", "mp-panel mp-roster");
  const answers = h("div", "mp-answers");
  const feed = h("div", "mp-panel mp-feed");
  const feedHead = h("div", "mp-h");
  feedHead.append(h("span", "", "Agent feed"), h("span", "", rt.events.mode === "demo" ? `replay · ${rt.events.speed}×` : "live"));
  const log = h("div", "mp-log");
  feed.append(feedHead, log);
  right.append(roster, answers, feed);
  root.appendChild(right);

  roster.appendChild(h("div", "mp-h", "Agents"));
  const rows = new Map<string, { el: HTMLElement; st: HTMLElement; pg: HTMLElement }>();
  rt.palace.agents.forEach((a, i) => {
    const el = h("div", "mp-agent");
    const dot = h("span", "mp-dot");
    dot.style.color = a.color;
    const mid = h("div");
    const nm = h("div", "nm");
    nm.append(Object.assign(h("span", "key", String(i + 1)), { title: `Press ${i + 1} to follow` }), N.agent(a.id));
    const st = h("div", "st", "idle");
    mid.append(nm, st);
    const pg = h("span", "pg", "");
    el.append(dot, mid, pg);
    el.onclick = () => window.dispatchEvent(new CustomEvent(PRESENCE_EVENTS.camera, { detail: { mode: a.id } }));
    roster.appendChild(el);
    rows.set(a.id, { el, st, pg });
  });

  const routes = new Map<string, string[]>();
  const done = new Map<string, Set<string>>();
  const handoffs = new Map<string, { from: string; to: string; memoryId: string }>();
  const setStatus = (agent: string, text: string) => {
    const r = rows.get(agent);
    if (r) r.st.textContent = text;
  };
  const setProgress = (agent: string) => {
    const r = rows.get(agent);
    const route = routes.get(agent);
    if (r && route) r.pg.textContent = `${done.get(agent)?.size ?? 0}/${route.length}`;
  };

  function line(e: PalaceEvent, html: string, cls = "") {
    const row = h("div", `mp-row ${cls}`);
    row.style.setProperty("--c", N.color(e.agent));
    const t = h("span", "t", `${e.t.toFixed(1)}s`);
    const x = h("span", "x");
    x.innerHTML = html;
    row.append(t, x);
    log.prepend(row);
    while (log.children.length > 80) log.lastChild?.remove();
  }
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const A = (id: string) => `<b style="--c:${N.color(id)}">${esc(N.agent(id))}</b>`;
  const M = (id: string) => `<span class="m">${esc(N.memory(id))}</span>`;

  function reset() {
    log.replaceChildren();
    answers.replaceChildren();
    routes.clear();
    done.clear();
    handoffs.clear();
    verdicts.clear();
    for (const r of rows.values()) {
      r.st.textContent = "idle";
      r.pg.textContent = "";
      r.st.style.color = "";
    }
  }

  function handle(e: PalaceEvent) {
    switch (e.type) {
      case "task":
        setStatus(e.agent, `task: ${e.text}`);
        line(e, `${A(e.agent)} got a task: “${esc(e.text)}”`);
        break;
      case "route": {
        routes.set(e.agent, e.stations);
        done.set(e.agent, new Set());
        setProgress(e.agent);
        const label = rt.palace.routes.find((r) => r.id === e.routeId)?.label ?? e.routeId;
        const how = e.source === "learned" ? "learned route" : e.source === "explore" ? "exploring for" : "route";
        line(e, `${A(e.agent)} picked ${how} <span class="m">${esc(label)}</span> · ${e.stations.length} stations`);
        break;
      }
      case "move": {
        const room = N.rooms.get(e.to);
        const team = N.agents.get(e.agent)?.team;
        const foreign = room && team && room.owner !== "shared" && room.owner !== team;
        setStatus(e.agent, foreign ? `at the door of ${N.room(e.to)}` : `walking to ${N.room(e.to)}`);
        line(
          e,
          foreign
            ? `${A(e.agent)} stopped at the door of <span class="m">${esc(N.room(e.to))}</span> (${esc(room!.owner)} owns it)`
            : `${A(e.agent)} walked to <span class="m">${esc(N.room(e.to))}</span>`,
        );
        break;
      }
      case "claim":
        setStatus(e.agent, `reading ${N.memory(e.memoryId)}`);
        line(e, `${A(e.agent)} claimed ${M(e.memoryId)}`);
        break;
      case "wait":
        setStatus(e.agent, `waiting on ${N.agent(e.heldBy)} at ${N.memory(e.memoryId)}`);
        line(e, `${A(e.agent)} waits: ${A(e.heldBy)} holds the claim on ${M(e.memoryId)}`, "wait");
        break;
      case "visit": {
        if (routes.get(e.agent)?.includes(e.memoryId)) done.get(e.agent)?.add(e.memoryId);
        setProgress(e.agent);
        const list = verdicts.get(e.memoryId) ?? [];
        list.push({ agent: e.agent, verdict: e.verdict, note: e.note });
        verdicts.set(e.memoryId, list);
        if (e.verdict === "gap") {
          setStatus(e.agent, `gap at ${N.memory(e.memoryId)}`);
          line(e, `${A(e.agent)} found a gap at ${M(e.memoryId)}: ${esc(e.note ?? "nothing recorded")}`, "gap");
        } else if (e.verdict === "stale") {
          line(e, `${A(e.agent)}: ${M(e.memoryId)} is stale${e.note ? ` (${esc(e.note)})` : ""}`, "stale");
        } else {
          line(e, `${A(e.agent)} verified ${M(e.memoryId)}${e.note ? ` <span style="opacity:.7">(${esc(e.note)})</span>` : ""}`);
        }
        if (currentMem === e.memoryId) openMemory(e.memoryId, false);
        break;
      }
      case "handoff":
        handoffs.set(e.id, { from: e.agent, to: e.toAgent, memoryId: e.memoryId });
        setStatus(e.agent, `asked ${N.agent(e.toAgent)}, waiting for reply`);
        line(e, `${A(e.agent)} asked ${A(e.toAgent)}: “${esc(e.question)}”`, "handoff");
        break;
      case "reply": {
        const hnd = handoffs.get(e.id);
        line(e, `${A(e.agent)} answered ${hnd ? A(hnd.from) : "the handoff"}: “${esc(e.answer)}”`, "reply");
        if (hnd) {
          setStatus(hnd.from, `got ${N.agent(e.agent)}'s reply`);
          // the owner's verified answer covers the asker's station
          if (routes.get(hnd.from)?.includes(hnd.memoryId)) done.get(hnd.from)?.add(hnd.memoryId);
          setProgress(hnd.from);
        }
        break;
      }
      case "answer":
        answerCard(e);
        setStatus(e.agent, e.blocked ? "answer blocked" : e.gaps?.length ? "answered, with a gap" : "answered");
        rows.get(e.agent)!.st.style.color = e.blocked ? "var(--red)" : e.gaps?.length ? "var(--amber)" : "var(--ok)";
        line(e, `${A(e.agent)} posted an answer${e.gaps?.length ? " and reported a gap" : ""}`, e.blocked ? "blocked" : e.gaps?.length ? "gap" : "");
        break;
      case "train_step":
        break;
    }
  }

  const tasks = new Map<string, string>();
  function answerCard(e: Extract<PalaceEvent, { type: "answer" }>) {
    const card = h("div", `mp-panel mp-card${e.blocked ? " blocked" : ""}`);
    card.style.setProperty("--c", N.color(e.agent));
    const who = h("div", "who");
    who.append(h("span", "", `${N.agent(e.agent)} answered`), h("span", "", `${e.t.toFixed(1)}s`));
    card.appendChild(who);
    const q = tasks.get(e.agent);
    if (q) card.appendChild(h("div", "q", q));
    if (e.blocked) card.appendChild(h("div", "ban", "Blocked: cites a station that was not verified"));
    card.appendChild(h("div", "txt", e.text));
    const chips = h("div", "mp-chips");
    e.citations.forEach((c) => chips.appendChild(chip(c)));
    e.gaps?.forEach((c) => chips.appendChild(chip(c, "gap")));
    e.stale?.forEach((c) => chips.appendChild(chip(c, "stale")));
    card.appendChild(chips);
    answers.appendChild(card);
  }

  const unsub = subscribeRuns(rt, () => (reset(), tasks.clear()), (e) => {
    if (e.type === "task") tasks.set(e.agent, e.text);
    handle(e);
  });

  // ---------- left: memory side panel
  let memPanel: HTMLElement | null = null;
  let currentMem: string | null = null;
  function closeMemory() {
    memPanel?.remove();
    memPanel = null;
    currentMem = null;
  }
  function openMemory(id: string, fly: boolean) {
    const m = N.mems.get(id);
    if (!m) return;
    if (fly) emitUI(UI_EVENTS.flyTo, { memoryId: id });
    closeMemory();
    currentMem = id;
    const p = h("div", "mp-panel mp-mem");
    const x = h("span", "x", "✕");
    x.onclick = closeMemory;
    const room = N.rooms.get(m.room);
    const wing = rt.palace.wings.find((w) => w.id === room?.wing);
    const ttl = h("div", "ttl", m.title);
    if (wing) ttl.style.color = wing.color;
    const meta = h("div", "meta", `${m.type} · ${room?.label ?? m.room}${wing ? ` · ${wing.label} wing` : ""} · ${m.id}`);
    const fresh = h("div", "mp-fresh");
    const bar = h("i");
    bar.style.width = `${Math.round(m.freshness * 100)}%`;
    fresh.appendChild(bar);
    const fl = h("div", "meta", `freshness ${Math.round(m.freshness * 100)}%${m.freshness < 0.3 ? " · stale" : ""}`);
    p.append(x, ttl, meta, fresh, fl);

    const vs = verdicts.get(id);
    if (vs?.length) {
      const box = h("div", "mp-verdicts");
      box.appendChild(h("div", "mp-h", "Agent verdicts"));
      for (const v of vs) {
        const row = h("div");
        row.innerHTML = `${A(v.agent)} · <span style="color:${v.verdict === "verified" ? "var(--ok)" : v.verdict === "gap" ? "var(--amber)" : "var(--stale)"}">${v.verdict}</span>${v.note ? ` · ${esc(v.note)}` : ""}`;
        box.appendChild(row);
      }
      p.appendChild(box);
    }

    p.appendChild(h("div", `ex${m.excerpt ? "" : " empty"}`, m.excerpt || "This page is empty. Nothing is recorded here yet."));
    const links = rt.palace.links.filter((l) => l.from === id || l.to === id);
    if (links.length) {
      p.appendChild(h("div", "mp-h", "Linked memories"));
      for (const l of links) {
        const other = l.from === id ? l.to : l.from;
        const row = h("div", "mp-link");
        row.append(h("span", "", N.memory(other)), h("span", "k", l.from === id ? `${l.kind} →` : `← ${l.kind}`));
        row.onclick = () => openMemory(other, true);
        p.appendChild(row);
      }
    }
    root.appendChild(p);
    memPanel = p;
  }
  const onSelect = (ev: Event) => {
    const id = (ev as CustomEvent).detail?.memoryId;
    if (typeof id === "string") openMemory(id, false);
  };
  addEventListener(UI_EVENTS.select, onSelect);

  // ---------- bottom: hints, camera mode, dispatch, toast
  const bottom = h("div", "mp-bottom");
  const mode = h("div", "mp-panel mp-mode", "Free walk");
  const hints = h("div", "mp-panel mp-hints");
  hints.innerHTML = `<kbd>T</kbd>dispatch <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd>follow <kbd>0</kbd>overhead <kbd>F</kbd>free <kbd>/</kbd>ask`;
  const btn = h("button", "mp-btn", "▶ Dispatch");
  btn.onclick = () => window.dispatchEvent(new CustomEvent(PRESENCE_EVENTS.dispatch));
  bottom.append(mode, btn, hints);
  root.appendChild(bottom);
  const toast = h("div", "mp-panel mp-toast");
  toast.style.opacity = "0";
  root.appendChild(toast);
  let toastTimer = 0;
  const onStatus = (ev: Event) => {
    const d = (ev as CustomEvent).detail ?? {};
    toast.textContent = d.text ?? "";
    toast.className = `mp-panel mp-toast ${d.tone ?? ""}`;
    toast.style.opacity = "1";
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toast.style.opacity = "0"), 2600);
  };
  const onMode = (ev: Event) => {
    const d = (ev as CustomEvent).detail ?? {};
    mode.textContent = d.label ?? "Free walk";
    for (const [id, r] of rows) r.el.classList.toggle("on", id === d.mode);
  };
  addEventListener(PRESENCE_EVENTS.status, onStatus);
  addEventListener(PRESENCE_EVENTS.mode, onMode);

  // ---------- top: ask bar (opens on "/")
  let ask: HTMLElement | null = null;
  function openAsk() {
    if (ask) return ask.querySelector("input")!.focus();
    if (document.pointerLockElement) document.exitPointerLock();
    ask = h("form", "mp-panel mp-ask");
    const input = h("input");
    input.placeholder = "Ask the palace… e.g. Can we sign the Gripworks contract this week?";
    input.autocomplete = "off";
    const go = h("button", "mp-btn", "Walk it");
    go.type = "submit";
    ask.append(input, go);
    (ask as HTMLFormElement).onsubmit = (ev) => {
      ev.preventDefault();
      const question = input.value.trim() || input.placeholder.replace(/^.*e\.g\. /, "");
      closeAsk();
      emitUI(UI_EVENTS.ask, { question });
    };
    // keep typing from reaching the player controls / hotkeys on window
    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Escape") closeAsk();
    });
    input.addEventListener("keyup", (ev) => ev.stopPropagation());
    root.appendChild(ask);
    input.focus();
  }
  function closeAsk() {
    ask?.remove();
    ask = null;
  }

  // ---------- walk answer panel
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
    } else if (ev.key === "Escape") {
      if (ask) closeAsk();
      else if (memPanel) closeMemory();
    }
  };
  addEventListener("keydown", onKey);

  return () => {
    unsub();
    removeEventListener(UI_EVENTS.select, onSelect);
    removeEventListener(PRESENCE_EVENTS.status, onStatus);
    removeEventListener(PRESENCE_EVENTS.mode, onMode);
    removeEventListener("keydown", onKey);
    root.remove();
    style.remove();
  };
};

