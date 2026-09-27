// OWNED BY: presence. HUD styles (scoped under .mp-ui).
export const CSS = /* css */ `
.mp-ui { position: fixed; inset: 0; pointer-events: none; z-index: 10;
  --panel: rgba(13, 15, 22, 0.84); --line: rgba(255,255,255,0.08); --text: #d7dae0; --muted: #8b90a0;
  --ok: #5ef2a0; --amber: #ffb020; --stale: #d9a441; --red: #ff5d6c;
  font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--text); }
.mp-ui * { box-sizing: border-box; }
.mp-panel { pointer-events: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); box-shadow: 0 10px 30px rgba(0,0,0,0.35); }
.mp-h { font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin: 0 0 6px; }

/* right column: roster, answers, feed */
.mp-right { position: absolute; top: 12px; right: 12px; bottom: 12px; width: 360px; display: flex; flex-direction: column; gap: 8px; }
.mp-roster { padding: 10px 12px; }
.mp-agent { display: grid; grid-template-columns: 12px 1fr auto; gap: 8px; align-items: center; padding: 5px 6px; border-radius: 8px; cursor: pointer; }
.mp-agent:hover { background: rgba(255,255,255,0.05); }
.mp-agent.on { background: rgba(255,255,255,0.08); }
.mp-dot { width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 0 10px currentColor; background: currentColor; }
.mp-agent .nm { font-weight: 650; }
.mp-agent .st { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mp-agent .pg { font-variant-numeric: tabular-nums; color: var(--muted); font-size: 12px; }
.mp-agent .key { display: inline-block; min-width: 16px; padding: 0 4px; margin-right: 6px; border: 1px solid var(--line); border-radius: 4px; font-size: 10px; color: var(--muted); text-align: center; }
.mp-answers { display: flex; flex-direction: column; gap: 8px; max-height: 58vh; overflow-y: auto; scrollbar-width: thin; flex-shrink: 0; }
.mp-answers:empty { display: none; }
.mp-card { padding: 10px 12px; border-left: 3px solid var(--c, #fff); animation: mp-in .35s ease-out; }
.mp-card .who { font-weight: 700; color: var(--c); font-size: 12px; display: flex; justify-content: space-between; }
.mp-card .q { color: var(--muted); font-size: 12px; margin: 2px 0 4px; }
.mp-card .txt { margin: 2px 0 6px; }
.mp-card.blocked { border-left-color: var(--red); }
.mp-card .ban { color: var(--red); font-weight: 700; font-size: 12px; }
.mp-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.mp-chip { pointer-events: auto; cursor: pointer; font-size: 11.5px; padding: 1px 8px; border-radius: 999px; border: 1px solid rgba(94,242,160,0.45); color: var(--ok); background: rgba(94,242,160,0.08); }
.mp-chip:hover { background: rgba(94,242,160,0.2); }
.mp-chip.gap { border-color: rgba(255,176,32,0.8); color: #1a1204; background: var(--amber); font-weight: 650; }
.mp-chip.stale { border-color: rgba(217,164,65,0.6); color: var(--stale); background: rgba(217,164,65,0.1); }
.mp-feed { flex: 1; min-height: 120px; overflow: hidden; display: flex; flex-direction: column; padding: 10px 0 6px; }
.mp-feed .mp-h { padding: 0 12px; display: flex; justify-content: space-between; }
.mp-log { overflow-y: auto; flex: 1; padding: 0 12px; scrollbar-width: thin; }
.mp-row { display: grid; grid-template-columns: 38px 1fr; gap: 6px; padding: 3px 0; border-top: 1px solid rgba(255,255,255,0.04); animation: mp-in .25s ease-out; }
.mp-row .t { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 11px; padding-top: 1px; }
.mp-row b { color: var(--c); font-weight: 650; }
.mp-row.gap { color: var(--amber); }
.mp-row.stale { color: var(--stale); }
.mp-row.handoff .x, .mp-row.reply .x { color: #e8e3ff; }
.mp-row.blocked { color: var(--red); }
.mp-row .m { color: #fff; }

/* left: memory panel */
.mp-mem { position: absolute; top: 12px; left: 12px; width: 330px; max-height: calc(100vh - 236px); overflow-y: auto; padding: 14px 16px; animation: mp-in-l .25s ease-out; }
.mp-mem .ttl { font-size: 17px; font-weight: 700; margin: 0 0 2px; padding-right: 20px; }
.mp-mem .meta { color: var(--muted); font-size: 12px; margin-bottom: 8px; }
.mp-mem .ex { margin: 8px 0 12px; white-space: pre-wrap; }
.mp-mem .ex.empty { color: var(--amber); font-style: italic; }
.mp-mem .x { position: absolute; top: 10px; right: 12px; cursor: pointer; color: var(--muted); font-size: 16px; }
.mp-fresh { height: 4px; border-radius: 2px; background: rgba(255,255,255,0.08); overflow: hidden; margin: 6px 0 2px; }
.mp-fresh > i { display: block; height: 100%; background: linear-gradient(90deg, #d9a441, #ffd98a); }
.mp-link { display: flex; justify-content: space-between; gap: 8px; padding: 5px 8px; border-radius: 7px; cursor: pointer; }
.mp-link:hover { background: rgba(255,255,255,0.06); }
.mp-link .k { color: var(--muted); font-size: 11.5px; }
.mp-verdicts { margin: 0 0 10px; display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
.mp-verdicts b { color: var(--c); }

/* top centre: mode, dispatch, hints, toast (scene owns bottom-centre hint + bottom-left minimap) */
.mp-bottom { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); display: flex; gap: 8px; align-items: center; }
.mp-hints { padding: 6px 12px; color: var(--muted); font-size: 12px; white-space: nowrap; }
.mp-hints kbd { font: inherit; color: var(--text); border: 1px solid var(--line); border-radius: 4px; padding: 0 5px; margin: 0 2px 0 8px; background: rgba(255,255,255,0.04); }
.mp-hints kbd:first-child { margin-left: 0; }
.mp-mode { padding: 6px 12px; font-weight: 650; font-size: 12px; }
.mp-btn { pointer-events: auto; cursor: pointer; border: 1px solid var(--line); background: rgba(255,255,255,0.06); color: var(--text); border-radius: 8px; padding: 6px 12px; font: inherit; font-weight: 650; }
.mp-btn:hover { background: rgba(255,255,255,0.12); }
.mp-toast { position: absolute; left: 50%; top: 58px; transform: translateX(-50%); padding: 7px 14px; font-size: 12.5px; transition: opacity .4s; }
.mp-toast.warn { color: var(--amber); }

/* top: ask bar */
.mp-ask { position: absolute; top: 58px; left: 0; right: 0; margin: 0 auto; width: min(620px, calc(100vw - 32px)); padding: 6px; display: flex; gap: 6px; animation: mp-in .2s ease-out; }
.mp-ask input { flex: 1; background: transparent; border: 0; outline: 0; color: #fff; font: inherit; font-size: 16px; padding: 8px 10px; }
.mp-ask input::placeholder { color: var(--muted); }

/* walk answer panel */
.mp-walk { position: absolute; left: 0; right: 0; margin: 0 auto; bottom: 24px; width: min(640px, calc(100vw - 32px)); padding: 14px 18px; border-left: 3px solid #ffd98a; animation: mp-in .35s ease-out; }
.mp-walk .q { color: var(--muted); margin-bottom: 4px; }
.mp-walk .a { font-size: 15.5px; margin-bottom: 8px; }
.mp-walk .esc { color: var(--muted); font-size: 11.5px; float: right; }
.mp-walk .hop { color: #ffd98a; font-size: 12.5px; }

@keyframes mp-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes mp-in-l { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: none; } }
@media (max-width: 900px) { .mp-right { width: 300px; } .mp-hints { display: none; } }
`;
