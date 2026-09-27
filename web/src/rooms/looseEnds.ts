// OWNED BY: loose-ends. The Loose Ends room: every gap/stale verdict any agent hits lands on a board as
// a card under the memory's owning team, with the question that hit it and who asked. Live, clicking a
// card opens a small answer form; submitting POSTs the protocol service's
// /loose-ends/<memoryId>/resolve (server/protocol/loose_ends.py), which writes the seed-brain page,
// `gbrain put`s it into the isolated brain, notifies the team and re-checks the page. The card flips to
// RESOLVED; the lectern gets its book back when the re-check's `visit: verified` arrives.
// Under ?demo (a replay) the board is read-only. `?protocol=http://localhost:8891` points at another service.
import * as THREE from "three";
import { PORTS, type PalaceEvent } from "../../../server/schema";
import type { PalaceRuntime } from "../api";
import { buildShell, departments, signAbove, framePose, makeBoard, memoryOwner, mountOnFarWall, roundRect, teamColor, teamLabel, wrapText, type Placement } from "./layout";

export interface LooseEnd {
  memoryId: string;
  title: string;
  verdict: "gap" | "stale";
  note: string;
  agent: string; // the agent whose visit found it
  team: string; // owning team of the memory
  question: string; // the question that hit it
  askedBy: string; // label of the agent (or quest agent) that asked
  quest?: string; // the commissioned quest's task, when a quest asked
  t: number;
  born: number; // performance.now() when it landed
  status: "open" | "resolved";
  answer?: string;
  by?: string;
  channel?: string; // where the owner was notified (slack | outbox)
  verified?: boolean; // the page re-checked as verified after the answer
  flipAt?: number; // performance.now() when a human's answer flipped it
  resolvedAt?: number; // performance.now() when it closed (answer, or a verified re-visit)
}

/** GET /loose-ends item (server/protocol/loose_ends.py; the legacy loci list has a subset of these keys). */
interface ServerItem {
  memoryId: string; title?: string; team: string; verdict?: "gap" | "stale"; note?: string | null; question?: string;
  askedBy?: { agent: string; label: string; quest?: string }; foundBy?: string; status: string;
  answer?: string; resolvedBy?: string; channel?: string; verified?: boolean;
}
interface ServerConfig { channel: "slack" | "outbox"; brainDir: string; gbrain: { home: string; sync: boolean; unavailable: string | null } }

const VERDICT_COLOR = { gap: "#f7768e", stale: "#e0af68" } as const;
const OK = "#9ece6a";
const MIN_COLUMNS = 3;
const MAX_COLUMNS = 5;
const GLOW_MS = 3500;
const RESOLVED_MS = 6000; // a card closed by a verified re-visit in the stream
const ANSWERED_MS = 25000; // a card a human answered stays up (green) this long
const FLIP_MS = 900;
const CONFETTI_MS = 1500;
const CARD_H = 300;
const POLL_MS = 8000;
const PIXEL_FONT = `"Pixelify Sans", ui-monospace, monospace`;

export function mountLooseEnds(rt: PalaceRuntime, pl: Placement) {
  const g = buildShell(rt, pl, "Loose Ends", "#f7768e");
  const board = makeBoard(8, 4.5, 2048);
  mountOnFarWall(pl, board.mesh, 4.5);
  board.mesh.name = "loose-ends-board";
  g.add(board.mesh);
  signAbove(g, board.mesh, 4.5);

  const cards = new Map<string, LooseEnd>();
  const listeners = new Set<(n: number) => void>();
  const dismissed = new Set<string>(); // answered cards that left the board (server keeps them as history)
  // Columns: every department from palace.json that has a card (wing order), padded to 3 so the
  // board never looks empty, capped at 5 so cards stay readable. Shared (People/foyer) goes last.
  const DEPTS = departments(rt.palace);
  const TEAM_LABEL = (t: string) => (t === "shared" ? "Shared" : teamLabel(rt.palace, t));
  const titleOf = (id: string) => rt.palace.memories.find((m) => m.id === id)?.title ?? id;

  // ---------- server (live only) ----------
  const params = new URLSearchParams(location.search);
  const PROTO = (params.get("protocol") ?? `http://localhost:${PORTS.protocol}`).replace(/\/$/, "");
  const canTalk = rt.events.mode === "live" || params.has("protocol");
  let server: "off" | "unknown" | "up" | "down" = canTalk ? "unknown" : "off";
  let config: ServerConfig | null = null;
  const writable = () => server === "up";

  // ---------- who asked what, from the stream (same rules as the server) ----------
  interface Ctx { tasks: Map<string, string>; spawned: Map<string, { label: string; task?: string }>; subtasks: Map<string, string>; handoffs: Map<string, { from: string; question: string }> }
  const runs = new Map<string, Ctx>();
  const ctxOf = (run?: string) => {
    let c = runs.get(run ?? "");
    if (!c) runs.set(run ?? "", (c = { tasks: new Map(), spawned: new Map(), subtasks: new Map(), handoffs: new Map() }));
    return c;
  };
  const labelOf = (agent: string, c?: Ctx) => rt.palace.agents.find((a) => a.id === agent)?.label ?? c?.spawned.get(agent)?.label ?? agent;

  function asked(e: Extract<PalaceEvent, { type: "visit" }>) {
    const c = ctxOf(e.run);
    const h = c.handoffs.get(`${e.agent}|${e.memoryId}`);
    const asker = h?.from ?? e.agent;
    const question = h?.question || (e.subtask && c.subtasks.get(e.subtask)) || c.tasks.get(asker)
      || `${titleOf(e.memoryId)}: ${e.verdict === "gap" ? "what should it say?" : "is it still true?"}`;
    return { question, askedBy: labelOf(asker, c), quest: c.spawned.get(asker)?.task };
  }

  function upsertFromVisit(e: Extract<PalaceEvent, { type: "visit" }>, verdict: "gap" | "stale") {
    const prev = cards.get(e.memoryId);
    // An open card: a gap outranks stale; keep the first note unless a better one shows up.
    if (prev && prev.status === "open" && !prev.resolvedAt) {
      if (verdict === "gap" && prev.verdict === "stale") { prev.verdict = "gap"; prev.note = e.note ?? prev.note; changed(); }
      return;
    }
    dismissed.delete(e.memoryId);
    cards.set(e.memoryId, {
      memoryId: e.memoryId, verdict,
      title: titleOf(e.memoryId),
      note: e.note ?? (verdict === "gap" ? "nothing recorded" : "needs review"),
      agent: e.agent,
      team: memoryOwner(rt.palace, e.memoryId),
      ...asked(e),
      t: e.t,
      born: performance.now(),
      status: "open",
    });
    changed();
  }

  function flip(c: LooseEnd, answer: string, by: string, channel?: string) {
    if (c.status === "resolved") return;
    c.status = "resolved";
    c.answer = answer;
    c.by = by;
    c.channel = channel ?? c.channel;
    c.flipAt = c.resolvedAt = performance.now();
    // The lectern's orb flares while the owning agent re-checks the page.
    rt.setMemoryGlow(c.memoryId, 3);
    setTimeout(() => rt.setMemoryGlow(c.memoryId, null), 2600);
    changed();
  }

  const off = rt.events.subscribe((e) => {
    const c = ctxOf(e.run);
    if (e.type === "task") c.tasks.set(e.agent, e.text);
    else if (e.type === "spawn") { c.spawned.set(e.agent, { label: e.label, task: e.task }); if (e.task && !c.tasks.has(e.agent)) c.tasks.set(e.agent, e.task); }
    else if (e.type === "phase") e.subtasks?.forEach((s) => c.subtasks.set(s.id, s.title));
    else if (e.type === "handoff") c.handoffs.set(`${e.toAgent}|${e.memoryId}`, { from: e.agent, question: e.question });
    else if (e.type === "visit") {
      if (e.verdict === "gap" || e.verdict === "stale") { upsertFromVisit(e, e.verdict); scheduleSync(); }
      else {
        const card = cards.get(e.memoryId);
        if (!card || e.t < card.t) return;
        if (card.status === "resolved") { if (!card.verified) { card.verified = true; changed(); } }
        // A verified visit after a gap with no answer on record = the page was fixed elsewhere.
        else if (!card.resolvedAt) { card.resolvedAt = performance.now(); card.verified = true; changed(); }
      }
    } else if (e.type === "resolved") {
      const card = cards.get(e.memoryId);
      if (card) flip(card, e.text, e.by, e.channel);
    } else if (e.type === "answer") {
      for (const id of [...(e.gaps ?? []), ...(e.stale ?? [])]) {
        if (cards.has(id)) continue;
        const verdict = e.gaps?.includes(id) ? "gap" : "stale";
        upsertFromVisit({ t: e.t, agent: e.agent, run: e.run, type: "visit", memoryId: id, verdict }, verdict);
      }
    }
  });

  function mergeServer(items: ServerItem[], first: boolean) {
    for (const it of items) {
      const card = cards.get(it.memoryId);
      if (it.status === "open") {
        const base = {
          question: it.question || card?.question || `${titleOf(it.memoryId)}: what should it say?`,
          askedBy: it.askedBy?.label ?? card?.askedBy ?? labelOf(it.foundBy ?? ""),
          quest: it.askedBy?.quest ?? card?.quest,
          note: it.note ?? card?.note ?? "nothing recorded",
        };
        if (card && card.status === "open" && !card.resolvedAt) Object.assign(card, base);
        else {
          dismissed.delete(it.memoryId);
          cards.set(it.memoryId, {
            memoryId: it.memoryId, title: it.title ?? titleOf(it.memoryId), verdict: it.verdict ?? "gap",
            agent: it.foundBy ?? it.askedBy?.agent ?? "", team: it.team || memoryOwner(rt.palace, it.memoryId),
            t: card?.t ?? 0, born: performance.now(), status: "open", ...base,
          });
        }
      } else if (it.status === "resolved" && card && card.status === "open" && !card.resolvedAt && !first) {
        if (it.answer) flip(card, it.answer, it.resolvedBy ?? "human", it.channel);
        else { card.resolvedAt = performance.now(); card.verified = true; } // fixed elsewhere, re-verified
      }
    }
    changed();
  }

  let syncTimer = 0;
  function scheduleSync() { if (canTalk) { clearTimeout(syncTimer); syncTimer = window.setTimeout(() => void sync(false), 600); } }
  async function sync(first: boolean) {
    if (!canTalk) return;
    try {
      const res = await fetch(`${PROTO}/loose-ends`, { signal: AbortSignal.timeout(2500) });
      const items = (await res.json()) as unknown;
      if (!res.ok || !Array.isArray(items)) throw new Error(`HTTP ${res.status}`);
      const was = server;
      server = "up";
      if (!config) config = await fetch(`${PROTO}/loose-ends/config`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      mergeServer(items as ServerItem[], first);
      if (was !== "up") redraw();
    } catch {
      if (server !== "down") { server = "down"; redraw(); }
    }
  }
  void sync(true);
  const poll = canTalk ? window.setInterval(() => void sync(false), POLL_MS) : 0;

  function changed() {
    const open = [...cards.values()].filter((c) => c.status === "open" && !c.resolvedAt).length;
    listeners.forEach((l) => l(open));
    redraw();
  }

  // ---------- drawing ----------
  let hits: { id: string; x: number; y: number; w: number; h: number }[] = [];
  const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

  function face(ctx: CanvasRenderingContext2D, c: LooseEnd, x: number, y: number, w: number, h: number, glow: number, resolved: boolean) {
    const color = teamColor(rt.palace, c.team);
    const closed = resolved || !!c.resolvedAt;
    const vc = closed ? OK : VERDICT_COLOR[c.verdict];
    ctx.save();
    ctx.shadowColor = vc;
    ctx.shadowBlur = 18 + 50 * glow;
    ctx.fillStyle = closed ? "rgba(26,44,30,0.97)" : "rgba(30,33,46,0.97)";
    roundRect(ctx, x, y, w, h, 22);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = vc;
    ctx.lineWidth = 5 + 6 * glow;
    roundRect(ctx, x, y, w, h, 22);
    ctx.stroke();
    ctx.fillStyle = color; // team colour accent bar
    roundRect(ctx, x + 10, y + 16, 12, h - 32, 6);
    ctx.fill();
    // badge + title on one row
    const badge = resolved ? "RESOLVED" : c.resolvedAt ? "CLOSED" : c.verdict.toUpperCase();
    ctx.font = `900 ${badge.length > 6 ? 30 : 40}px ui-sans-serif, system-ui, sans-serif`;
    const bw = ctx.measureText(badge).width + 36;
    ctx.fillStyle = vc;
    roundRect(ctx, x + 40, y + 22, bw, 58, 12);
    ctx.fill();
    ctx.fillStyle = "#11131a";
    ctx.fillText(badge, x + 58, y + (badge.length > 6 ? 37 : 32));
    ctx.fillStyle = "#f2f3f7";
    ctx.font = "800 44px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(wrapText(ctx, c.title, w - bw - 100, 1)[0] ?? "", x + 60 + bw, y + 30);
    if (resolved) {
      ctx.font = "700 38px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "#e6f5d8";
      wrapText(ctx, `“${c.answer ?? ""}”`, w - 70, 2).forEach((l, k) => ctx.fillText(l, x + 40, y + 100 + k * 46));
      ctx.font = "500 32px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "#a9c79a";
      const how = `${c.by ?? "human"} · ${c.channel === "slack" ? "Slack" : c.channel === "outbox" ? "outbox" : "notified"}${c.verified ? " · ✓ re-verified" : " · re-checking…"}`;
      ctx.fillText(wrapText(ctx, how, w - 70, 1)[0] ?? "", x + 40, y + 200);
      ctx.fillStyle = OK;
      ctx.font = "700 30px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText("written to GBrain", x + 40, y + 244);
      return;
    }
    ctx.font = "600 38px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = "#e3e6ee";
    wrapText(ctx, `“${c.question}”`, w - 70, 2).forEach((l, k) => ctx.fillText(l, x + 40, y + 100 + k * 46));
    ctx.font = "500 32px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = "#9aa0b4";
    ctx.fillText(wrapText(ctx, `asked by ${c.askedBy}${c.quest ? ` · quest: ${c.quest}` : ""}`, w - 70, 1)[0] ?? "", x + 40, y + 200);
    ctx.fillStyle = c.resolvedAt ? OK : vc;
    ctx.font = "600 30px ui-sans-serif, system-ui, sans-serif";
    const foot = c.resolvedAt ? "page re-verified" : `${TEAM_LABEL(c.team)}: ${c.note}`;
    ctx.fillText(wrapText(ctx, foot, w - 70 - (writable() && !c.resolvedAt ? 150 : 0), 1)[0] ?? "", x + 40, y + 244);
    if (writable() && !c.resolvedAt) {
      ctx.fillStyle = color;
      ctx.font = `700 30px ${PIXEL_FONT}`;
      ctx.fillText("ANSWER ▸", x + w - 170, y + 244);
    }
  }

  function redraw() {
    const now = performance.now();
    hits = [];
    board.draw((ctx, W, H) => {
      ctx.fillStyle = "rgba(14,16,24,0.94)";
      roundRect(ctx, 0, 0, W, H, 36);
      ctx.fill();
      ctx.strokeStyle = "rgba(247,118,142,0.55)";
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.fillStyle = "#e6e8ef";
      ctx.font = "700 64px ui-sans-serif, system-ui, sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText("LOOSE ENDS", 56, 40);
      ctx.font = "400 34px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "#9aa0b4";
      const open = [...cards.values()].filter((c) => c.status === "open" && !c.resolvedAt);
      const mode = server === "up" ? "click a card to answer it into GBrain" : server === "off" ? "read-only replay" : server === "down" ? "read-only: protocol service offline" : "connecting…";
      ctx.fillText(`what the company doesn't know yet · ${open.length} open · ${mode}`, 56, 116);

      const withCards = new Set([...cards.values()].map((c) => c.team));
      const teams = DEPTS.filter((d) => withCards.has(d));
      for (const d of ["eng", "legal", "finance", ...DEPTS]) if (teams.length < MIN_COLUMNS && DEPTS.includes(d) && !teams.includes(d)) teams.push(d);
      if (withCards.has("shared")) teams.push("shared");
      if (teams.length > MAX_COLUMNS) teams.splice(0, teams.length, ...teams.filter((t) => withCards.has(t)).slice(0, MAX_COLUMNS));
      const colW = (W - 56 * 2 - 32 * (teams.length - 1)) / teams.length;
      const bursts: { c: LooseEnd; cx: number; cy: number }[] = [];
      teams.forEach((team, i) => {
        const x = 56 + i * (colW + 32);
        const color = teamColor(rt.palace, team);
        ctx.fillStyle = color;
        ctx.font = `800 ${teams.length > 3 ? 48 : 60}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillText(TEAM_LABEL(team), x, 180);
        ctx.fillRect(x, 252, colW, 8);
        // Open first (oldest first), then answered ones.
        const list = [...cards.values()].filter((c) => c.team === team)
          .sort((a, b) => Number(a.status !== "open" || !!a.resolvedAt) - Number(b.status !== "open" || !!b.resolvedAt) || a.t - b.t);
        let y = 284;
        let shown = 0;
        for (const c of list) {
          if (y + CARD_H > H - 30) break;
          const age = now - c.born;
          const glow = c.flipAt && now - c.flipAt < GLOW_MS ? 1 - (now - c.flipAt) / GLOW_MS : age < GLOW_MS ? 1 - age / GLOW_MS : 0;
          const k = c.flipAt ? Math.min(1, (now - c.flipAt) / FLIP_MS) : 1;
          const resolvedFace = c.status === "resolved" && k >= 0.5;
          ctx.save();
          if (k < 1) { // flip around the card's vertical axis; the face swaps at the edge-on midpoint
            const cx = x + colW / 2;
            ctx.translate(cx, 0);
            ctx.scale(Math.max(0.03, Math.abs(Math.cos(Math.PI * k))), 1);
            ctx.translate(-cx, 0);
          }
          face(ctx, c, x, y, colW, CARD_H, glow, resolvedFace);
          ctx.restore();
          hits.push({ id: c.memoryId, x, y, w: colW, h: CARD_H });
          if (c.flipAt && now - c.flipAt < CONFETTI_MS + FLIP_MS / 2) bursts.push({ c, cx: x + colW / 2, cy: y + CARD_H / 2 });
          y += CARD_H + 24;
          shown++;
        }
        if (list.length > shown) {
          ctx.font = "600 32px ui-sans-serif, system-ui, sans-serif";
          ctx.fillStyle = "#9aa0b4";
          ctx.fillText(`+${list.length - shown} more`, x + colW - 170, H - 64);
        }
        if (!list.length) {
          ctx.font = "italic 500 40px ui-sans-serif, system-ui, sans-serif";
          ctx.fillStyle = "#5c6278";
          ctx.fillText("nothing open", x, 300);
        }
      });
      // Pixel confetti from the flipped card: square bits in the team colour and green.
      for (const { c, cx, cy } of bursts) {
        const age = now - (c.flipAt ?? now) - FLIP_MS / 2;
        if (age < 0) continue;
        const k = age / CONFETTI_MS;
        const seed = hash(c.memoryId);
        const palette = [teamColor(rt.palace, c.team), OK, "#e0af68", "#f2f3f7"];
        for (let i = 0; i < 36; i++) {
          const r = ((seed >>> (i % 24)) & 255) / 255;
          const a = (i / 36) * Math.PI * 2 + r * 0.6;
          const speed = 380 + 520 * r;
          const px = cx + Math.cos(a) * speed * k;
          const py = cy + Math.sin(a) * speed * k * 0.7 + 420 * k * k; // a little gravity
          const s = 18 - 8 * k;
          ctx.globalAlpha = Math.max(0, 1 - k);
          ctx.fillStyle = palette[i % palette.length];
          ctx.fillRect(Math.round(px / 6) * 6, Math.round(py / 6) * 6, s, s);
        }
        ctx.globalAlpha = 1;
      }
    });
  }

  // Keep glowing / flipping cards animated; drop closed cards after a while.
  let acc = 0;
  const offFrame = rt.onFrame((dt) => {
    const now = performance.now();
    let dirty = false;
    for (const [id, c] of cards) {
      const ttl = c.status === "resolved" ? ANSWERED_MS : RESOLVED_MS;
      if (c.resolvedAt && now - c.resolvedAt > ttl) { cards.delete(id); if (c.status === "resolved") dismissed.add(id); dirty = true; }
    }
    const animating = [...cards.values()].some((c) => now - c.born < GLOW_MS || (c.flipAt && now - c.flipAt < Math.max(GLOW_MS, FLIP_MS + CONFETTI_MS)));
    acc += dt;
    if (dirty) changed();
    else if (animating && acc > 1 / 30) { acc = 0; redraw(); }
  });
  redraw();

  // ---------- picking: which card is under the pointer ----------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const dom = rt.renderer.domElement;
  function cardAt(clientX: number, clientY: number): LooseEnd | null {
    if (rt.controls.locked) ndc.set(0, 0);
    else {
      const r = dom.getBoundingClientRect();
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    }
    ray.setFromCamera(ndc, rt.camera);
    const hit = ray.intersectObject(board.mesh, false)[0];
    if (!hit?.uv) return null;
    const px = hit.uv.x * board.canvas.width, py = (1 - hit.uv.y) * board.canvas.height;
    const h = hits.find((b) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
    return h ? cards.get(h.id) ?? null : null;
  }
  let down: { x: number; y: number } | null = null;
  let pointerSet = false;
  const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
  const onClick = (e: MouseEvent) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return; // a drag, not a click
    const c = cardAt(e.clientX, e.clientY);
    if (c) open(c);
  };
  const onMove = (e: PointerEvent) => {
    if (form.isConnected) return;
    const c = cardAt(e.clientX, e.clientY);
    const want = !!c;
    if (want !== pointerSet) { dom.style.cursor = want ? "pointer" : ""; pointerSet = want; }
  };
  dom.addEventListener("pointerdown", onDown);
  dom.addEventListener("click", onClick);
  dom.addEventListener("pointermove", onMove);

  // ---------- the answer form (DOM, pixel style) ----------
  const style = document.createElement("style");
  style.textContent = `
  .mp-le{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(520px,calc(100vw - 32px));z-index:40;
    font:400 15px/1.35 ${PIXEL_FONT};color:#e6e8ef;background:#141722;border:4px solid var(--team);
    box-shadow:0 0 0 4px #0b0d12,8px 8px 0 4px rgba(0,0,0,.55);image-rendering:pixelated;animation:mpLeIn .18s steps(3) both}
  .mp-le header{background:var(--team);color:#0f1117;padding:8px 14px;display:flex;justify-content:space-between;align-items:center;font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:13px}
  .mp-le header .v{background:#0f1117;color:var(--verdict);padding:2px 8px}
  .mp-le .in{padding:14px 16px 16px;display:grid;gap:10px}
  .mp-le h3{margin:0;font:700 21px/1.25 ${PIXEL_FONT}}
  .mp-le .meta{color:#9aa0b4;font-size:13px}
  .mp-le .meta b{color:#d5d9e4;font-weight:600}
  .mp-le textarea,.mp-le input{all:unset;box-sizing:border-box;width:100%;background:#0b0d12;border:3px solid #3a3f52;padding:8px 10px;font:400 16px/1.35 ${PIXEL_FONT};color:#f2f3f7}
  .mp-le textarea{min-height:84px;resize:vertical;white-space:pre-wrap}
  .mp-le textarea:focus,.mp-le input:focus{border-color:var(--team)}
  .mp-le .row{display:flex;gap:10px;align-items:center}
  .mp-le .row label{color:#9aa0b4;font-size:13px;white-space:nowrap}
  .mp-le .btns{display:flex;justify-content:flex-end;gap:10px}
  .mp-le button{all:unset;cursor:pointer;padding:8px 14px;font:700 15px ${PIXEL_FONT};border:3px solid #3a3f52;color:#d5d9e4;background:#1d2130;box-shadow:3px 3px 0 #0b0d12}
  .mp-le button.go{background:var(--team);border-color:var(--team);color:#0f1117}
  .mp-le button:active{transform:translate(2px,2px);box-shadow:1px 1px 0 #0b0d12}
  .mp-le button[disabled]{opacity:.55;cursor:progress}
  .mp-le .where{color:#7b8199;font-size:12px}
  .mp-le .err{color:#f7768e;font-size:13px;min-height:0}
  @keyframes mpLeIn{from{opacity:0;transform:translate(-50%,-46%)}to{opacity:1;transform:translate(-50%,-50%)}}
  .mp-le-toast{position:absolute;left:50%;bottom:24px;transform:translateX(-50%);z-index:41;max-width:min(640px,calc(100vw - 32px));
    font:400 14px/1.35 ${PIXEL_FONT};color:#e6e8ef;background:#141722;border:3px solid var(--c,#9ece6a);padding:8px 14px;box-shadow:4px 4px 0 rgba(0,0,0,.5)}`;
  document.head.appendChild(style);

  const form = document.createElement("form");
  form.className = "mp-le";
  form.setAttribute("role", "dialog");
  let current: LooseEnd | null = null;
  const stopKeys = (e: KeyboardEvent) => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); close(); } };
  form.addEventListener("keydown", stopKeys);
  form.addEventListener("keyup", (e) => e.stopPropagation());
  form.addEventListener("pointerdown", (e) => e.stopPropagation());

  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  const lc = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
  const byKey = "mp-loose-ends-by";
  const savedBy = () => { try { return localStorage.getItem(byKey) || ""; } catch { return ""; } };

  function open(c: LooseEnd) {
    if (c.status === "resolved" || c.resolvedAt) {
      toast(c.status === "resolved" ? `${c.title}: answered by ${c.by ?? "human"}: “${c.answer ?? ""}”` : `${c.title} re-verified; nothing to answer.`, OK);
      return;
    }
    if (!writable()) {
      toast(server === "off"
        ? `Read-only replay. “${c.question}” (${TEAM_LABEL(c.team)}, asked by ${c.askedBy}). Answer live with the protocol service on :${PORTS.protocol}.`
        : `Protocol service not reachable at ${PROTO}; the board is read-only.`, VERDICT_COLOR[c.verdict]);
      return;
    }
    current = c;
    if (rt.controls.locked) document.exitPointerLock?.();
    const color = teamColor(rt.palace, c.team);
    form.style.setProperty("--team", color);
    form.style.setProperty("--verdict", VERDICT_COLOR[c.verdict]);
    const target = config?.channel === "slack" ? "Slack" : `the ${c.team}.log outbox`;
    form.innerHTML = `
      <header><span>Loose end · ${esc(TEAM_LABEL(c.team))}</span><span class="v">${c.verdict}</span></header>
      <div class="in">
        <h3>Answer for ${esc(TEAM_LABEL(c.team))}: ${esc(lc(c.question))}</h3>
        <div class="meta"><b>${esc(c.title)}</b> · ${esc(c.memoryId)} · ${esc(c.note)}<br>asked by <b>${esc(c.askedBy)}</b>${c.quest ? ` · quest: ${esc(c.quest)}` : ""}</div>
        <textarea name="text" required maxlength="1200" placeholder="${c.verdict === "gap" ? "What the page should say, e.g. a name and role" : "What changed, or confirm it still holds"}"></textarea>
        <div class="row"><label for="mp-le-by">answered by</label><input id="mp-le-by" name="by" maxlength="80" placeholder="your name" value="${esc(savedBy())}"></div>
        <div class="where">Writes ${esc(c.memoryId)}.md in the seed brain, then gbrain put · tells ${esc(TEAM_LABEL(c.team))} via ${esc(target)}</div>
        <div class="err" role="alert"></div>
        <div class="btns"><button type="button" class="cancel">Cancel</button><button type="submit" class="go">Write to GBrain ▸</button></div>
      </div>`;
    form.querySelector<HTMLButtonElement>(".cancel")!.onclick = close;
    rt.hud.appendChild(form);
    dom.style.cursor = "";
    pointerSet = false;
    setTimeout(() => form.querySelector("textarea")?.focus(), 0);
  }

  function close() { form.remove(); current = null; }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const c = current;
    if (!c) return;
    const text = (form.querySelector("textarea") as HTMLTextAreaElement).value.trim();
    const by = (form.querySelector("input[name=by]") as HTMLInputElement).value.trim() || "human";
    const err = form.querySelector<HTMLDivElement>(".err")!;
    if (!text) { err.textContent = "Write the answer first."; return; }
    try { localStorage.setItem(byKey, by); } catch { /* private mode */ }
    const go = form.querySelector<HTMLButtonElement>("button.go")!;
    go.disabled = true;
    go.textContent = "Writing…";
    err.textContent = "";
    try {
      const r = await resolve(c.memoryId, text, by);
      close();
      flip(c, r.item?.answer ?? text, by, r.notify?.channel);
      if (r.recheck?.verdict === "verified") c.verified = true;
      const gb = r.gbrain?.status === "put" ? "GBrain updated" : `GBrain ${r.gbrain?.status ?? "?"}${r.gbrain?.reason ? ` (${r.gbrain.reason})` : ""}`;
      const told = r.notify?.channel === "slack" ? "Slack" : "outbox";
      toast(`Written to ${r.item?.write?.path ?? c.memoryId} · ${gb} · ${TEAM_LABEL(c.team)} told via ${told}` + (r.recheck?.verdict ? ` · re-check: ${r.recheck.verdict}` : ""), OK);
    } catch (e) {
      err.textContent = (e as Error).message;
      go.disabled = false;
      go.textContent = "Write to GBrain ▸";
    }
  });

  async function resolve(memoryId: string, text: string, by: string) {
    const path = memoryId.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(`${PROTO}/loose-ends/${path}/resolve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, by }) });
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    void sync(false);
    return body as {
      item?: { answer?: string; write?: { path: string } };
      gbrain?: { status: string; reason?: string };
      notify?: { channel: string };
      recheck?: { verdict?: string };
    };
  }

  let toastEl: HTMLDivElement | null = null;
  let toastTimer = 0;
  function toast(text: string, color: string) {
    toastEl?.remove();
    toastEl = document.createElement("div");
    toastEl.className = "mp-le-toast";
    toastEl.style.setProperty("--c", color);
    toastEl.textContent = text;
    rt.hud.appendChild(toastEl);
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl?.remove(), 6000);
  }

  return {
    group: g,
    cards,
    /** QA / other plugins: open the answer form for a card (same path as clicking it). */
    open(memoryId: string) { const c = cards.get(memoryId); if (c) open(c); return !!c; },
    /** QA: a card's centre in client pixels (so a headless test can click the real card). */
    cardScreen(memoryId: string) {
      const h = hits.find((b) => b.id === memoryId);
      if (!h) return null;
      const u = (h.x + h.w / 2) / board.canvas.width, v = (h.y + h.h / 2) / board.canvas.height;
      board.mesh.updateWorldMatrix(true, false);
      const p = board.mesh.localToWorld(new THREE.Vector3((u - 0.5) * 8, (0.5 - v) * 4.5, 0)).project(rt.camera);
      const r = dom.getBoundingClientRect();
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
    },
    get server() { return server; },
    onCount(cb: (n: number) => void) { listeners.add(cb); cb([...cards.values()].filter((c) => c.status === "open" && !c.resolvedAt).length); },
    pose: () => framePose(pl, board.mesh, 9.5),
    dispose() {
      off(); offFrame(); clearInterval(poll); clearTimeout(syncTimer); clearTimeout(toastTimer);
      dom.removeEventListener("pointerdown", onDown); dom.removeEventListener("click", onClick); dom.removeEventListener("pointermove", onMove);
      form.remove(); toastEl?.remove(); style.remove(); rt.scene.remove(g);
    },
  };
}
