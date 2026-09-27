// OWNED BY: polish (presence), ui-v3. Game-HUD styles, scoped under .mp-ui. Pixel type, bevelled translucent
// panels, one colour per team. Big text, few elements.
export const CSS = /* css */ `
.mp-ui { position: fixed; inset: 0; pointer-events: none; z-index: 10;
  --ink: rgba(16, 14, 22, 0.86); --ink-2: rgba(30, 27, 40, 0.92);
  --hi: rgba(255, 255, 255, 0.22); --lo: rgba(0, 0, 0, 0.65);
  --text: #f2ecdc; --muted: #aaa292; --dim: #6f6a60;
  --ok: #6ee07a; --amber: #ffb020; --stale: #c9a24a; --red: #ff5d6c; --gold: #ffd35a;
  font: 400 16px/1.35 "Pixelify Sans", ui-monospace, "SF Mono", Menlo, monospace; color: var(--text);
  -webkit-font-smoothing: antialiased; }
.mp-ui * { box-sizing: border-box; }
.mp-panel { pointer-events: auto; background: var(--ink); border: 3px solid;
  border-color: var(--hi) var(--lo) var(--lo) var(--hi); border-radius: 4px;
  box-shadow: 0 0 0 2px rgba(0,0,0,0.55), 0 12px 28px rgba(0,0,0,0.45); }
.mp-ui button { font: inherit; }
.mp-btn { pointer-events: auto; cursor: pointer; color: var(--text); background: #4a4658; padding: 8px 14px;
  border: 3px solid; border-color: #8a85a0 #232030 #232030 #8a85a0; border-radius: 3px; font-weight: 600; letter-spacing: .02em; }
.mp-btn:hover { background: #5a5570; }
.mp-btn:active { border-color: #232030 #8a85a0 #8a85a0 #232030; }
.mp-btn:focus-visible, .mp-slot:focus-visible, .mp-quest:focus-visible { outline: 3px solid var(--gold); outline-offset: 2px; }
.mp-btn.go { background: #2f8f46; border-color: #7fe39a #145226 #145226 #7fe39a; font-size: 20px; padding: 10px 16px; flex: 1; color: #fff; text-shadow: 0 2px 0 rgba(0,0,0,.35); }
.mp-btn.go:hover { background: #38a452; }
.mp-btn.go[disabled] { background: #3b4a3f; border-color: #5d7564 #1d271f #1d271f #5d7564; color: #b8c4ba; cursor: default; }
.mp-btn.small { padding: 4px 10px; font-size: 14px; }
.mp-btn.on { background: #6b5a24; border-color: #e9c96b #3a2f0c #3a2f0c #e9c96b; }

/* ---- quest log (left) */
.mp-log-panel { position: absolute; top: 14px; left: 14px; width: 350px; max-height: calc(100vh - 150px);
  display: flex; flex-direction: column; padding: 12px; gap: 10px; }
.mp-log-panel h2 { margin: 0; font-size: 24px; font-weight: 700; color: var(--gold); text-shadow: 0 2px 0 rgba(0,0,0,.6); }
.mp-log-panel .sub { color: var(--muted); font-size: 14px; margin-top: -6px; }
.mp-actions { display: flex; gap: 8px; }
.mp-quests { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; scrollbar-width: thin; padding-right: 2px; }
.mp-quest { pointer-events: auto; cursor: pointer; background: var(--ink-2); border: 2px solid rgba(255,255,255,0.08);
  border-left: 6px solid var(--c); border-radius: 3px; padding: 9px 10px 10px; }
.mp-quest:hover { border-color: rgba(255,255,255,0.22); border-left-color: var(--c); }
.mp-quest.on { background: rgba(60, 54, 80, 0.95); border-color: var(--c); }
.mp-quest .top { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.mp-face { width: 26px; height: 26px; flex: none; display: grid; place-items: center; font-weight: 700; font-size: 16px;
  color: #120f18; background: var(--c); border: 2px solid; border-color: rgba(255,255,255,.55) rgba(0,0,0,.45) rgba(0,0,0,.45) rgba(255,255,255,.55); }
.mp-quest .who { font-weight: 700; color: var(--c); font-size: 15px; }
.mp-quest .step { margin-left: auto; font-size: 14px; color: var(--muted); font-variant-numeric: tabular-nums; }
.mp-quest .q { font-size: 17px; line-height: 1.25; margin: 2px 0 7px; }
.mp-quest .st { font-size: 14.5px; color: var(--muted); min-height: 1.3em; }
.mp-quest .st.warn { color: var(--amber); }
.mp-quest .st.ok { color: var(--ok); }
.mp-quest .st.bad { color: var(--red); }
.mp-bar { display: flex; gap: 3px; margin: 7px 0 6px; }
.mp-bar i { flex: 1; height: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(0,0,0,.5); }
.mp-bar i.done { background: var(--ok); }
.mp-bar i.gap { background: var(--amber); }
.mp-bar i.stale { background: var(--stale); }
.mp-bar i.cur { background: var(--c); animation: mp-blink 1s steps(2) infinite; }
.mp-quest .ans { margin-top: 8px; padding-top: 8px; border-top: 2px dashed rgba(255,255,255,0.12); font-size: 15px; line-height: 1.35; }
.mp-quest .ans .ban { color: var(--red); font-weight: 700; }
.mp-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
.mp-chip { pointer-events: auto; cursor: pointer; font-size: 13.5px; padding: 1px 7px; border: 2px solid rgba(110,224,122,0.55); color: var(--ok); background: rgba(110,224,122,0.08); border-radius: 2px; }
.mp-chip:hover { background: rgba(110,224,122,0.2); }
.mp-chip.gap { border-color: #ffe2a0; color: #1a1204; background: var(--amber); font-weight: 700; }
.mp-chip.stale { border-color: rgba(201,162,74,0.7); color: #f0d59a; background: rgba(201,162,74,0.16); }

/* ---- party bar (bottom centre) */
.mp-party { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; gap: 6px; align-items: stretch; padding: 6px; max-width: calc(100vw - 20px); }
.mp-slot { pointer-events: auto; cursor: pointer; position: relative; width: 112px; display: grid; grid-template-columns: 28px 1fr; gap: 6px; align-items: center;
  padding: 4px 6px; background: var(--ink-2); border: 3px solid; border-color: rgba(255,255,255,0.18) rgba(0,0,0,0.6) rgba(0,0,0,0.6) rgba(255,255,255,0.18); color: var(--text); text-align: left; }
.mp-slot:hover { background: rgba(55, 50, 72, 0.95); }
.mp-slot > div { min-width: 0; }
.mp-slot.on { border-color: var(--gold); box-shadow: 0 0 0 2px rgba(255,211,90,0.35), 0 0 18px rgba(255,211,90,0.25); }
.mp-slot .key { position: absolute; top: -9px; left: -7px; min-width: 20px; padding: 0 5px; font-size: 13px; font-weight: 700; text-align: center;
  background: #1a1722; color: var(--gold); border: 2px solid #4b465c; }
.mp-slot .mp-face { width: 28px; height: 28px; font-size: 16px; }
.mp-slot .nm { font-weight: 700; font-size: 14px; color: var(--c); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mp-slot .doing { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mp-slot .doing.warn { color: var(--amber); }
.mp-slot .doing.ok { color: var(--ok); }
.mp-slot.quest { width: 176px; grid-template-columns: 36px 1fr; border-color: var(--c) rgba(0,0,0,0.6) rgba(0,0,0,0.6) var(--c); }
.mp-slot.quest .mp-face { width: 36px; height: 36px; font-size: 20px; }
.mp-slot.quest .nm { font-size: 15px; }
.mp-slot.map { width: auto; grid-template-columns: auto; padding: 6px 14px; font-weight: 700; place-items: center; white-space: nowrap; }
.mp-keys { align-self: center; color: var(--muted); font-size: 12.5px; padding: 0 6px 0 4px; line-height: 1.5; white-space: nowrap; }
.mp-keys b { color: var(--text); }

/* ---- right column: memory panel + route checklist */
.mp-right { position: absolute; top: 14px; right: 14px; width: 340px; max-height: calc(100vh - 150px); display: flex; flex-direction: column; gap: 10px; }
.mp-right:empty { display: none; }
.mp-route { padding: 12px; overflow-y: auto; scrollbar-width: thin; }
.mp-route .hd { display: flex; gap: 10px; align-items: center; }
.mp-route .hd .nm { font-weight: 700; font-size: 19px; color: var(--c); }
.mp-route .hd .rt { color: var(--muted); font-size: 14px; }
.mp-route .q { font-size: 16px; margin: 8px 0 10px; }
.mp-stops { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.mp-stop { display: grid; grid-template-columns: 30px 1fr; gap: 8px; padding: 6px 6px; background: rgba(255,255,255,0.04); border: 2px solid transparent; }
.mp-stop .n { width: 28px; height: 28px; display: grid; place-items: center; font-weight: 700; background: rgba(255,255,255,0.1); color: var(--muted); }
.mp-stop .t { font-size: 15.5px; }
.mp-stop .r { font-size: 13px; color: var(--dim); }
.mp-stop .v { font-size: 14px; color: var(--muted); }
.mp-stop.done .n { background: var(--ok); color: #07170d; }
.mp-stop.done .v { color: var(--ok); }
.mp-stop.gap { border-color: var(--amber); }
.mp-stop.gap .n { background: var(--amber); color: #1a1204; }
.mp-stop.gap .v { color: var(--amber); font-weight: 700; }
.mp-stop.stale .n { background: var(--stale); color: #1a1204; }
.mp-stop.stale .v { color: #f0d59a; }
.mp-stop.cur { border-color: var(--c); }
.mp-stop.cur .n { background: var(--c); color: #120f18; animation: mp-blink 1s steps(2) infinite; }
.mp-stop.cur .v { color: var(--text); }
.mp-route .back { margin-top: 10px; width: 100%; }

.mp-mem { padding: 12px 14px; overflow-y: auto; position: relative; flex: none; max-height: 52vh; scrollbar-width: thin; }
.mp-mem .ttl { font-size: 20px; font-weight: 700; margin: 0 0 2px; padding-right: 26px; }
.mp-mem .meta { color: var(--muted); font-size: 13.5px; margin-bottom: 6px; }
.mp-mem .ex { margin: 8px 0 10px; white-space: pre-wrap; font-size: 15px; line-height: 1.4; }
.mp-mem .ex.empty { color: var(--amber); }
.mp-mem .x { position: absolute; top: 8px; right: 8px; }
.mp-fresh { height: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(0,0,0,.5); margin: 4px 0 2px; }
.mp-fresh > i { display: block; height: 100%; background: var(--gold); }
.mp-mem h3 { font-size: 15px; color: var(--gold); margin: 8px 0 4px; font-weight: 700; }
.mp-link { display: flex; justify-content: space-between; gap: 8px; padding: 4px 6px; cursor: pointer; font-size: 14.5px; }
.mp-link:hover { background: rgba(255,255,255,0.08); }
.mp-link .k { color: var(--dim); font-size: 13px; }
.mp-verdicts { display: flex; flex-direction: column; gap: 2px; font-size: 14px; }
.mp-verdicts b { color: var(--c); }

/* ---- activity drawer + toggles (bottom left) */
.mp-dock { position: absolute; left: 14px; bottom: 14px; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.mp-dock .row { display: flex; gap: 8px; }
.mp-activity { width: 350px; max-height: 38vh; overflow-y: auto; padding: 8px 10px; scrollbar-width: thin; }
.mp-row { display: grid; grid-template-columns: 44px 1fr; gap: 6px; padding: 3px 0; font-size: 14px; border-top: 1px solid rgba(255,255,255,0.05); }
.mp-row .t { color: var(--dim); font-variant-numeric: tabular-nums; }
.mp-row b { color: var(--c); }
.mp-row.gap { color: var(--amber); }
.mp-row.stale { color: #f0d59a; }
.mp-row.blocked { color: var(--red); }
.mp-row .m { color: #fff; }

/* ---- toast, ask bar, walk answer */
.mp-toast { position: absolute; left: 50%; top: 200px; white-space: nowrap; transform: translateX(-50%); padding: 8px 16px; font-size: 17px; transition: opacity .4s; }
.mp-toast.warn { color: var(--amber); }
.mp-ask { position: absolute; top: 64px; left: 0; right: 0; margin: 0 auto; width: min(620px, calc(100vw - 32px)); padding: 6px; display: flex; gap: 6px; }
.mp-ask input { flex: 1; background: transparent; border: 0; outline: 0; color: #fff; font: inherit; font-size: 18px; padding: 8px 10px; }
.mp-ask input::placeholder { color: var(--dim); }
.mp-walk { position: absolute; left: 0; right: 0; margin: 0 auto; bottom: 110px; width: min(640px, calc(100vw - 32px)); padding: 12px 16px; border-left: 6px solid var(--gold); }
.mp-walk .q { color: var(--muted); margin-bottom: 4px; }
.mp-walk .a { font-size: 17px; margin-bottom: 6px; }
.mp-walk .esc { color: var(--muted); font-size: 13px; float: right; }
.mp-walk .hop { color: var(--gold); font-size: 15px; }


/* ---- Quest board (top centre, the centrepiece) */
.mp-top { position: absolute; top: 14px; left: calc(50% + 20px); transform: translateX(-50%); width: min(640px, calc(100vw - 800px)); min-width: 460px; padding: 6px; display: grid; grid-template-columns: 1fr; gap: 6px; }
.mp-top.open { width: min(760px, calc(100vw - 800px)); padding: 6px 6px 10px; }
.mp-top .mp-newquest input { font-size: 17px; padding: 7px 10px; }
.mp-top .mp-newquest .go { font-size: 18px; padding: 6px 14px; }
.mp-extoggle { flex: none; white-space: nowrap; align-self: stretch; }
.mp-drawer { display: grid; gap: 6px; padding: 0 6px; }
.mp-drawer[hidden] { display: none; }
.mp-slot.gym.on { border-color: #9ece6a; box-shadow: 0 0 0 2px rgba(158,206,106,0.35), 0 0 18px rgba(158,206,106,0.25); }
.mp-top .lbl { font-size: 15px; font-weight: 700; color: var(--gold); }
.mp-newquest { display: flex; gap: 8px; }
.mp-newquest input { flex: 1; min-width: 0; font: inherit; font-size: 18px; color: #fff; padding: 9px 11px; background: rgba(0,0,0,0.45);
  border: 3px solid; border-color: var(--lo) var(--hi) var(--hi) var(--lo); border-radius: 2px; outline: 0; }
.mp-newquest input::placeholder { color: #8d877b; }
.mp-newquest input:focus { border-color: var(--gold); }
.mp-newquest .go { flex: none; }
.mp-top .sub { color: var(--muted); font-size: 13.5px; }
.mp-board { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
@media (min-width: 1900px) { .mp-top.open { width: min(1080px, calc(100vw - 820px)); } .mp-board { grid-template-columns: repeat(6, 1fr); } }
.mp-qcard { pointer-events: auto; cursor: pointer; text-align: left; color: var(--text); background: var(--ink-2); padding: 5px 7px 6px;
  border: 2px solid rgba(255,255,255,0.1); border-top: 4px solid var(--c); border-radius: 3px; display: grid; gap: 3px; min-width: 0; }
.mp-qcard:hover { background: rgba(60, 54, 80, 0.95); border-color: rgba(255,255,255,0.3); border-top-color: var(--c); }
.mp-qcard:focus-visible { outline: 3px solid var(--gold); outline-offset: 1px; }
.mp-qcard .t { font-weight: 700; font-size: 15px; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mp-qcard .deps { display: flex; flex-wrap: wrap; gap: 3px; }
.mp-qcard .dep { font-size: 11.5px; line-height: 1; padding: 2px 4px 3px; color: #120f18; background: var(--c); border-radius: 2px; }
.mp-qcard .why { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 11.5px; color: var(--muted); line-height: 1.25;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
/* hero copy (top of the quest log) */
.mp-hero { display: grid; gap: 4px; padding-bottom: 8px; border-bottom: 2px solid rgba(255,255,255,0.08); }
.mp-hero .brand { font-size: 28px; font-weight: 700; color: var(--gold); text-shadow: 0 3px 0 rgba(0,0,0,.6); line-height: 1; }
.mp-hero .pitch { font-size: 15.5px; line-height: 1.3; }
.mp-hero .claims { margin: 2px 0 0; padding: 0; list-style: none; display: grid; gap: 2px; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12.5px; color: var(--muted); }
.mp-hero .claims li::before { content: "■ "; color: var(--gold); font-size: 9px; vertical-align: 2px; }
.mp-hero .claims b { color: var(--text); font-weight: 600; }
.mp-top .mp-actions { justify-content: flex-start; }
.mp-empty { color: var(--muted); font-size: 15px; line-height: 1.4; padding: 4px 2px; }

/* quest card extras: hero, phase stepper, hops, sparkline, artifact */
.mp-quest.hero { border-left-width: 8px; background: rgba(44, 38, 62, 0.95); }
.mp-quest.hero .q { font-size: 19px; }
.mp-phases { display: flex; gap: 3px; margin: 2px 0 6px; }
.mp-phases span { flex: 1; text-align: center; font-size: 12.5px; padding: 3px 0; background: rgba(255,255,255,0.06); color: var(--dim); border: 1px solid rgba(0,0,0,.5); }
.mp-phases span.past { background: rgba(110,224,122,0.18); color: var(--ok); }
.mp-phases span.now { background: var(--c); color: #120f18; font-weight: 700; animation: mp-blink 1.2s steps(2) infinite; }
.mp-hops { font-size: 14px; color: var(--muted); margin-top: 4px; }
.mp-hops b { color: var(--text); }
.mp-spark { margin-top: 6px; font-size: 13px; color: var(--muted); }
.mp-spark svg { display: block; width: 100%; height: 34px; background: rgba(0,0,0,0.3); border: 1px solid rgba(0,0,0,.5); }
.mp-artifact { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; font-size: 15px; color: var(--gold); }

/* completion banner */
.mp-banner { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(560px, calc(100vw - 40px)); padding: 18px 20px 20px;
  border-color: var(--gold) #6b5a24 #6b5a24 var(--gold); text-align: left; animation: mp-pop .35s steps(4); }
.mp-banner .big { font-size: 34px; font-weight: 700; color: var(--gold); text-shadow: 0 3px 0 rgba(0,0,0,.6); }
.mp-banner .task { font-size: 18px; color: var(--muted); margin: 2px 0 10px; }
.mp-banner .txt { font-size: 17px; line-height: 1.4; }
.mp-banner .go { margin-top: 14px; width: 100%; }
.mp-banner .x, .mp-mem .x { position: absolute; top: 8px; right: 8px; }
@keyframes mp-pop { from { transform: translate(-50%, -50%) scale(.85); opacity: 0; } to { transform: translate(-50%, -50%) scale(1); opacity: 1; } }

@keyframes mp-blink { 50% { filter: brightness(1.45); } }
@media (prefers-reduced-motion: reduce) { .mp-bar i.cur, .mp-stop.cur .n { animation: none; } }
@media (max-width: 1500px) { .mp-keys { display: none; } }
@media (max-width: 1250px) { .mp-slot { width: auto; grid-template-columns: 28px; } .mp-slot > div { display: none; } .mp-slot.quest { width: 150px; grid-template-columns: 36px 1fr; } .mp-slot.quest > div { display: block; } }
@media (max-width: 800px) { .mp-log-panel { width: calc(100vw - 28px); max-height: 40vh; } .mp-right { display: none; } .mp-party { bottom: 8px; } .mp-slot { width: auto; grid-template-columns: 32px; } .mp-slot > div:not(.mp-face) { display: none; } }

/* The overview replaces the scene's first-person minimap and its "Click to walk" hint (both scene-owned DOM). */
.mp-minimap, .mp-hint { display: none !important; }
`;
