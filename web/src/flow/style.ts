// OWNED BY: flow. Task-flow panel styles (scoped under .fl-root). Game-HUD look: dark translucent,
// square pixel borders with a hard drop shadow, Pixelify Sans for labels, monospace for evidence.
export const FONT_HREF = "https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@400;500;600;700&display=swap";

export const CSS = /* css */ `
.fl-root { position: fixed; inset: 0; pointer-events: none; z-index: 30;
  --bg: rgba(9, 11, 17, 0.93); --bg2: rgba(19, 22, 32, 0.96); --line: #2b3144; --line2: #3a4259;
  --text: #e3e6ee; --muted: #8b90a0; --dim: #5b6070;
  --ok: #5ef2a0; --amber: #ffb020; --stale: #d9a441; --red: #ff5d6c;
  --px: "Pixelify Sans", ui-monospace, "SF Mono", Menlo, monospace;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font: 13px/1.35 var(--px); color: var(--text); font-synthesis: none; -webkit-font-smoothing: antialiased; }
.fl-root * { box-sizing: border-box; }
.fl-px { border: 2px solid var(--line); box-shadow: 0 0 0 2px #04050a, 4px 4px 0 2px rgba(0,0,0,0.45); border-radius: 0; }

/* launcher: sits above the scene's bottom-left minimap */
.fl-launch { position: absolute; left: 12px; bottom: 208px; pointer-events: auto; cursor: pointer; background: var(--bg);
  color: var(--text); font: 400 12px/1 var(--px); letter-spacing: 0.08em; padding: 8px 10px; display: flex; gap: 8px; align-items: center; }
.fl-launch:hover { border-color: var(--line2); background: var(--bg2); }
.fl-launch kbd, .fl-key { font: 400 10px/1 var(--px); border: 1px solid var(--line2); padding: 2px 4px; color: var(--muted); }
.fl-launch .n { color: var(--muted); }
.fl-launch .bad { color: var(--red); }
.fl-launch.on { display: none; }

/* panel */
.fl-panel { position: absolute; top: 0; left: 0; bottom: 0; width: max(50vw, min(640px, 100vw)); pointer-events: auto; background: var(--bg);
  border-width: 0 2px 0 0; box-shadow: 2px 0 0 #04050a, 8px 0 0 rgba(0,0,0,0.35); display: flex; flex-direction: column;
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); animation: fl-in .18s steps(4); }
.fl-panel.full { width: 100vw; border-width: 0; box-shadow: none; }
.fl-panel[hidden] { display: none; }
@keyframes fl-in { from { transform: translateX(-24px); opacity: 0; } to { transform: none; opacity: 1; } }

.fl-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; padding: 10px 12px 8px; border-bottom: 2px solid var(--line); }
.fl-title { font: 400 15px/1 var(--px); letter-spacing: 0.12em; color: #fff; white-space: nowrap; }
.fl-title small { display: block; font: 400 10px/1.2 var(--px); letter-spacing: 0.06em; color: var(--muted); margin-top: 3px; }
.fl-head .fl-sp { flex: 1; }
.fl-tabs { display: flex; flex-wrap: wrap; gap: 6px; order: 3; flex-basis: 100%; }
.fl-tabs:empty { display: none; }
.fl-tab { cursor: pointer; background: transparent; color: var(--muted); border: 2px solid var(--line); padding: 5px 8px; font: 400 12px/1.1 var(--px);
  display: flex; align-items: center; gap: 6px; white-space: nowrap; max-width: 340px; }
.fl-tab i { width: 8px; height: 8px; flex: none; background: var(--c); box-shadow: 0 0 0 1px #000; }
.fl-tab span { overflow: hidden; text-overflow: ellipsis; }
.fl-tab em { font-style: normal; font-size: 11px; }
.fl-tab em.ok { color: var(--ok); } .fl-tab em.bad { color: var(--red); } .fl-tab em.run { color: var(--muted); }
.fl-tab:hover { color: var(--text); border-color: var(--line2); }
.fl-tab.on { color: #fff; border-color: var(--c); background: rgba(255,255,255,0.05); }
.fl-btn { cursor: pointer; background: var(--bg2); color: var(--text); border: 2px solid var(--line); font: 400 12px/1 var(--px); padding: 6px 8px; white-space: nowrap; }
.fl-btn:hover { border-color: var(--line2); color: #fff; }
.fl-btn.on { border-color: #fff; color: #fff; }

.fl-body { flex: 1; overflow: auto; padding: 12px 14px 20px; scrollbar-width: thin; scrollbar-color: var(--line2) transparent; }
.fl-empty { color: var(--muted); padding: 40px 10px; text-align: center; line-height: 1.8; }

/* task summary strip */
.fl-sum { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; margin-bottom: 10px; }
.fl-phases { display: flex; gap: 0; align-items: center; }
.fl-ph { font: 400 11px/1 var(--px); letter-spacing: 0.06em; padding: 4px 7px; border: 2px solid var(--line); color: var(--dim); text-transform: uppercase; }
.fl-ph + .fl-ph { border-left: 0; }
.fl-ph.done { color: var(--muted); }
.fl-ph.cur { color: #0b0d12; background: var(--c, #7dcfff); border-color: var(--c, #7dcfff); }
.fl-ph small { font-size: 10px; opacity: 0.8; margin-left: 4px; text-transform: none; }

.fl-score { display: flex; flex-wrap: wrap; gap: 6px; }
.fl-sc { border: 2px solid var(--line); background: var(--bg2); padding: 4px 8px 3px; min-width: 64px; }
.fl-sc b { display: block; font: 600 15px/1.15 var(--mono); color: #fff; }
.fl-sc span { font: 400 10px/1.2 var(--px); letter-spacing: 0.05em; color: var(--muted); text-transform: uppercase; }
.fl-sc.ok { border-color: rgba(94,242,160,0.55); } .fl-sc.ok b { color: var(--ok); }
.fl-sc.bad { border-color: var(--red); } .fl-sc.bad b { color: var(--red); }
.fl-sc.na b { color: var(--dim); }

.fl-cmp { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 10px; padding: 8px 10px; border: 2px dashed var(--line2); }
.fl-cmp .lbl { font: 400 11px/1 var(--px); letter-spacing: 0.08em; color: var(--muted); }
.fl-cmp b, .fl-cmp .delta { font: 600 12.5px/1 var(--mono); color: #fff; }
.fl-cmp .delta { color: var(--ok); }
.fl-cmp .delta.up { color: var(--red); }
.fl-cmp .drop { flex-basis: 100%; color: var(--muted); font-size: 12px; }
.fl-cmp .drop s { color: var(--dim); }

.fl-pair { display: flex; gap: 16px; align-items: flex-start; }
.fl-pair > .fl-col { flex: 1; min-width: 0; }
.fl-colh { font: 400 12px/1 var(--px); letter-spacing: 0.1em; margin: 0 0 8px; color: var(--muted); }
.fl-colh b { color: #fff; }

/* graph */
.fl-graph { position: relative; padding-bottom: 4px; }
.fl-edges { position: absolute; left: 0; top: 0; pointer-events: none; overflow: visible; z-index: 0; }
.fl-rootn { position: relative; z-index: 1; margin: 0 auto 22px; max-width: 560px; padding: 8px 12px; background: var(--bg2); border: 2px solid var(--c); text-align: center; }
.fl-rootn .k { font: 400 10px/1 var(--px); letter-spacing: 0.1em; color: var(--muted); text-transform: uppercase; margin-bottom: 5px; }
.fl-rootn .k b { color: var(--c); }
.fl-rootn .txt { font: 400 14px/1.3 var(--px); color: #fff; }
.fl-grid { position: relative; z-index: 1; display: grid; column-gap: 10px; row-gap: 14px; }
.fl-laneb { background: linear-gradient(180deg, color-mix(in srgb, var(--c) 10%, transparent), transparent 85%); border-top: 2px solid color-mix(in srgb, var(--c) 45%, transparent); }
.fl-lh { padding: 6px 6px 2px; min-width: 0; }
.fl-lh .t { font: 400 12px/1.15 var(--px); color: var(--c); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fl-lh .s { font: 400 10px/1.2 var(--px); color: var(--muted); letter-spacing: 0.04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fl-railh { font: 400 9px/1 var(--px); letter-spacing: 0.08em; color: var(--ok); writing-mode: vertical-rl; align-self: end; justify-self: center; opacity: 0.75; }

.fl-node { position: relative; min-width: 0; cursor: pointer; background: var(--bg2); border: 2px solid color-mix(in srgb, var(--c) 45%, var(--line));
  border-left-width: 5px; border-left-color: var(--c); padding: 5px 7px 5px 6px; box-shadow: 3px 3px 0 rgba(0,0,0,0.45); }
.fl-node:hover { border-color: #fff; border-left-color: var(--c); z-index: 2; }
.fl-node .l1 { display: flex; gap: 6px; align-items: baseline; }
.fl-node .ord { font: 600 10px/1 var(--mono); color: var(--muted); flex: none; min-width: 12px; }
.fl-node .ttl { font: 400 12.5px/1.2 var(--px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fl-node .l2 { display: flex; flex-wrap: wrap; gap: 4px 6px; align-items: center; margin-top: 4px; }
.fl-node .l3 { font: 11px/1.3 var(--mono); color: var(--muted); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fl-node .l3 i { font: 400 10px/1 var(--px); font-style: normal; color: var(--h); letter-spacing: 0.06em; margin-right: 4px; }
.fl-node .l3.fl { color: var(--red); font-family: var(--px); font-size: 11px; }
.fl-v { font: 400 10px/1 var(--px); letter-spacing: 0.07em; padding: 2px 5px; border: 1px solid; text-transform: uppercase; }
.fl-v.verified { color: var(--ok); border-color: rgba(94,242,160,0.5); background: rgba(94,242,160,0.08); }
.fl-v.stale { color: #1b1306; background: var(--stale); border-color: var(--stale); }
.fl-v.gap { color: var(--amber); border: 1px dashed var(--amber); background: rgba(255,176,32,0.1); }
.fl-v.pending { color: var(--muted); border-color: var(--line2); animation: fl-blink 1s steps(2) infinite; }
.fl-v.ghost { color: var(--dim); border: 1px dotted var(--line2); }
.fl-v.bad { color: #fff; background: var(--red); border-color: var(--red); }
.fl-mk { font: 11px/1 var(--mono); color: var(--muted); }
.fl-ck { font: 400 10px/1 var(--px); letter-spacing: 0.06em; color: var(--ok); }
.fl-st { font: 400 10px/1 var(--px); letter-spacing: 0.06em; color: var(--amber); }
.fl-st.no { color: var(--red); }
@keyframes fl-blink { 50% { opacity: 0.35; } }

.fl-node.st-useful { border-color: color-mix(in srgb, var(--ok) 60%, var(--c)); border-left-color: var(--c); box-shadow: 3px 3px 0 rgba(0,0,0,0.45), 0 0 12px rgba(94,242,160,0.18); }
.fl-node.st-useful .ttl { color: #fff; text-shadow: 0 0 8px rgba(94,242,160,0.35); }
.fl-node.st-wasted { opacity: 0.42; filter: grayscale(0.85); }
.fl-node.st-wasted:hover { opacity: 0.85; }
.fl-node.st-gap { border: 2px dashed var(--amber); border-left: 5px dashed var(--amber); background: rgba(40, 30, 8, 0.92); }
.fl-node.st-stale { border-color: var(--stale); border-left-color: var(--stale); }
.fl-node.st-pending { animation: fl-blink 1.2s steps(2) infinite; }
.fl-node.ghost { background: rgba(14,16,24,0.7); border: 2px dotted var(--line2); border-left: 5px dotted var(--dim); box-shadow: none; }
.fl-node.ghost .ttl { color: var(--muted); }
.fl-node.skipped, .fl-node.unverified-cite { border-color: var(--red); border-left-color: var(--red); }
.fl-node.bad { border-color: var(--red); border-left-color: var(--red); box-shadow: 3px 3px 0 rgba(0,0,0,0.45), 0 0 12px rgba(255,93,108,0.3); }
.fl-node.dropped { opacity: 0.5; filter: grayscale(0.7); }
.fl-node.dropped .ttl { text-decoration: line-through; text-decoration-thickness: 2px; }
.fl-node .drop-tag { font: 400 9px/1 var(--px); letter-spacing: 0.06em; color: var(--muted); border: 1px solid var(--line2); padding: 1px 4px; }
.fl-node.flash { outline: 2px solid #fff; }

.fl-answer { position: relative; z-index: 1; margin-top: 22px; padding: 9px 12px 10px; background: var(--bg2); border: 2px solid var(--ok); box-shadow: 4px 4px 0 rgba(0,0,0,0.45); }
.fl-answer.pending { border: 2px dashed var(--line2); color: var(--muted); }
.fl-answer.blocked, .fl-answer.bad { border-color: var(--red); }
.fl-answer .k { font: 400 10px/1 var(--px); letter-spacing: 0.1em; color: var(--ok); text-transform: uppercase; margin-bottom: 5px; display: flex; gap: 8px; }
.fl-answer.blocked .k, .fl-answer.bad .k { color: var(--red); }
.fl-answer.pending .k { color: var(--muted); }
.fl-answer .txt { font: 13px/1.45 var(--mono); color: var(--text); }
.fl-answer .inh { font: 400 11px/1.3 var(--px); color: var(--muted); margin-top: 4px; }
.fl-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 7px; align-items: center; }
.fl-chips .lbl { font: 400 10px/1 var(--px); letter-spacing: 0.08em; color: var(--muted); margin-right: 2px; }
.fl-chip { cursor: pointer; font: 400 11px/1 var(--px); padding: 3px 6px; border: 1px solid rgba(94,242,160,0.5); color: var(--ok); background: rgba(94,242,160,0.07); }
.fl-chip:hover { background: rgba(94,242,160,0.2); }
.fl-chip.gap { color: var(--amber); border: 1px dashed var(--amber); background: rgba(255,176,32,0.08); }
.fl-chip.stale { color: var(--stale); border-color: var(--stale); background: rgba(217,164,65,0.08); }
.fl-chip.bad { color: #fff; border-color: var(--red); background: rgba(255,93,108,0.35); }
.fl-chip.art { color: #7dcfff; border-color: #7dcfff; background: rgba(125,207,255,0.08); }

.fl-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; padding: 8px 14px 10px; border-top: 2px solid var(--line); font: 400 11px/1.2 var(--px); color: var(--muted); }
.fl-legend i { display: inline-block; width: 14px; height: 10px; margin-right: 5px; vertical-align: -1px; border: 2px solid; }

.fl-tip { position: fixed; z-index: 40; pointer-events: none; max-width: 360px; background: rgba(8,10,15,0.97); padding: 9px 11px; font: 12px/1.45 var(--mono); color: var(--text); }
.fl-tip[hidden] { display: none; }
.fl-tip .h { font: 400 13px/1.2 var(--px); color: #fff; }
.fl-tip .id { color: var(--dim); font-size: 11px; margin-bottom: 6px; }
.fl-tip .j { font: 400 12px/1.3 var(--px); margin: 4px 0 6px; }
.fl-tip .j.ok { color: var(--ok); } .fl-tip .j.warn { color: var(--amber); } .fl-tip .j.bad { color: var(--red); } .fl-tip .j.dim { color: var(--muted); }
.fl-tip .ev { border-left: 2px solid var(--line2); padding-left: 8px; margin: 4px 0; color: #cfd3dc; }
.fl-tip .lab { font: 400 10px/1 var(--px); letter-spacing: 0.08em; color: var(--muted); text-transform: uppercase; margin-top: 6px; }
.fl-tip .fl { color: var(--red); }
`;
