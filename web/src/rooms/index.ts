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
  const hud = document.createElement("div");
  hud.className = "mp-rooms";
  hud.innerHTML = `<style>
    .mp-rooms{position:absolute;right:16px;bottom:16px;display:flex;flex-direction:column;gap:6px;align-items:flex-end;font:600 12px/1 ui-sans-serif,system-ui,sans-serif}
    .mp-rooms button{all:unset;cursor:pointer;padding:7px 11px;border-radius:999px;background:rgba(20,23,32,.82);color:#d7dae0;border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(6px)}
    .mp-rooms button:hover{border-color:rgba(255,255,255,.35)}
    .mp-rooms .le{border-color:rgba(247,118,142,.6)}
    .mp-rooms .le.pulse{animation:mpPulse 1.2s ease-out 3}
    .mp-rooms .row{display:flex;gap:6px}
    .mp-rooms .hint{color:#7b8199;font-weight:400}
    @keyframes mpPulse{0%{box-shadow:0 0 0 0 rgba(247,118,142,.8)}100%{box-shadow:0 0 0 12px rgba(247,118,142,0)}}
  </style>
  <div class="row replays" hidden></div>
  <button class="le" data-room="loose-ends">Loose Ends <b class="n">0</b></button>
  <button data-room="workshop">Workshop</button>
  <button data-room="gym">The Gym</button>
  <span class="hint">Esc returns</span>`;
  rt.hud.appendChild(hud);
  hud.querySelectorAll<HTMLButtonElement>("button[data-room]").forEach((b) => b.addEventListener("click", () => go(b.dataset.room as SpecialRoomId)));
  const le = hud.querySelector<HTMLButtonElement>(".le")!;
  const n = le.querySelector(".n")!;
  let lastCount = 0;
  looseEnds.onCount((count) => {
    n.textContent = String(count);
    if (count > lastCount) { le.classList.remove("pulse"); void le.offsetWidth; le.classList.add("pulse"); }
    lastCount = count;
  });

  // Run 1 / run 2 replay buttons appear only once seed has shipped the canned replays.
  workshop.availableReplays().then((names) => {
    if (!names.length) return;
    const row = hud.querySelector<HTMLDivElement>(".replays")!;
    row.hidden = false;
    names.forEach((name, i) => {
      const b = document.createElement("button");
      b.textContent = `▶ run ${i + 1}`;
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
