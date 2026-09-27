// OWNED BY: training. Workshop, Loose Ends and Gym rooms. See skill river-gym.
// Special rooms are not in palace.json: they sit at fixed diagonal slots outside the wings
// (Loose Ends -24,-24 · Workshop 24,-24 · Gym 24,24; nudged outward if a wing would overlap).
// Built only against PalaceRuntime (web/src/api.ts), so any scene implementation works.
import type { Plugin } from "../api";
import { flyTo, placeRooms, type SpecialRoomId } from "./layout";
import { mountLooseEnds } from "./looseEnds";
import { mountWorkshop } from "./workshop";
import { mountGym } from "./gym";

export const mountRooms: Plugin = (rt) => {
  const slots = placeRooms(rt.palace);
  const looseEnds = mountLooseEnds(rt, slots["loose-ends"]);
  const workshop = mountWorkshop(rt, slots.workshop);
  const gym = mountGym(rt, slots.gym);
  const poses: Record<SpecialRoomId, () => ReturnType<typeof looseEnds.pose>> = {
    "loose-ends": looseEnds.pose,
    workshop: workshop.pose,
    gym: gym.pose,
  };
  const go = (id: SpecialRoomId) => { const p = poses[id](); flyTo(rt, p.eye, p.target); };

  // ---------- HUD: small room switcher, bottom-right ----------
  // ONE compact collapsible panel (bottom-right); collapsed it's a single chip with the open count.
  const hud = document.createElement("details");
  hud.className = "mp-rooms";
  hud.innerHTML = `<style>
    .mp-rooms{position:absolute;right:16px;bottom:16px;max-width:220px;font:600 12px/1.2 ui-sans-serif,system-ui,sans-serif;color:#d7dae0;background:rgba(20,23,32,.86);border:1px solid rgba(255,255,255,.12);border-radius:12px;backdrop-filter:blur(6px)}
    .mp-rooms summary{list-style:none;cursor:pointer;padding:8px 12px;display:flex;gap:8px;align-items:center}
    .mp-rooms summary::-webkit-details-marker{display:none}
    .mp-rooms summary .n{background:#f7768e;color:#11131a;border-radius:999px;padding:1px 7px;font-weight:800}
    .mp-rooms summary .n.zero{background:#3a3f52;color:#9aa0b4}
    .mp-rooms.pulse summary .n{animation:mpPulse 1.2s ease-out 3}
    .mp-rooms .body{display:grid;gap:4px;padding:0 8px 8px}
    .mp-rooms button{all:unset;cursor:pointer;padding:6px 8px;border-radius:8px}
    .mp-rooms button:hover{background:rgba(255,255,255,.08)}
    .mp-rooms .row{display:flex;gap:4px}
    .mp-rooms .hint{color:#7b8199;font-weight:400;padding:2px 8px}
    @keyframes mpPulse{0%{box-shadow:0 0 0 0 rgba(247,118,142,.8)}100%{box-shadow:0 0 0 10px rgba(247,118,142,0)}}
  </style>
  <summary>Rooms <span class="n zero">0</span><span class="hint" style="padding:0">loose ends</span></summary>
  <div class="body">
    <button data-room="loose-ends">Loose Ends board</button>
    <button data-room="workshop">Workshop · learned routes</button>
    <button data-room="gym">The Gym · training</button>
    <div class="row replays" hidden></div>
    <span class="hint">Esc returns to your view</span>
  </div>`;
  rt.hud.appendChild(hud);
  hud.querySelectorAll<HTMLButtonElement>("button[data-room]").forEach((b) => b.addEventListener("click", () => go(b.dataset.room as SpecialRoomId)));
  const n = hud.querySelector<HTMLSpanElement>("summary .n")!;
  let lastCount = 0;
  looseEnds.onCount((count) => {
    n.textContent = String(count);
    n.classList.toggle("zero", count === 0);
    if (count > lastCount) { hud.classList.remove("pulse"); void hud.offsetWidth; hud.classList.add("pulse"); }
    lastCount = count;
  });

  // Run 1 / run 2 replay buttons appear only once seed has shipped the canned replays.
  workshop.availableReplays().then((names) => {
    if (!names.length) return;
    const row = hud.querySelector<HTMLDivElement>(".replays")!;
    row.hidden = false;
    names.forEach((name, i) => {
      const b = document.createElement("button");
      b.textContent = `▶ replay run ${i + 1}`;
      b.title = `replay ${name}`;
      b.addEventListener("click", () => { rt.events.restart(name); go("workshop"); });
      row.appendChild(b);
    });
  });

  const start = new URLSearchParams(location.search).get("room") as SpecialRoomId | null;
  if (start && start in poses) setTimeout(() => go(start), 300);

  (window as any).rooms = { go, looseEnds, workshop, gym, slots }; // browser QA
  return () => { looseEnds.dispose(); workshop.dispose(); gym.dispose(); hud.remove(); };
};
