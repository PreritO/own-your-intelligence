// OWNED BY: flow. Task-flow panel styles (scoped under .fl-root). Matches the game HUD in web/src/ui:
// bevelled translucent panels, warm palette, Pixelify Sans (weight 400 only: bold pixel type closes the
// counters and 2 reads as 8), monospace for numbers and evidence.
export const FONT_HREF = "https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@400;500;600;700&display=swap";

export const CSS = /* css */ `
.fl-root { position: fixed; inset: 0; pointer-events: none; z-index: 30;
  --bg: rgba(16, 14, 22, 0.94); --bg2: rgba(30, 27, 40, 0.96); --line: #3a3548; --line2: #5a5570;
  --hi: rgba(255, 255, 255, 0.22); --lo: rgba(0, 0, 0, 0.65);
  --text: #f2ecdc; --muted: #aaa292; --dim: #6f6a60;
  --ok: #6ee07a; --amber: #ffb020; --stale: #c9a24a; --red: #ff5d6c; --gold: #ffd35a;
  --px: "Pixelify Sans", ui-monospace, "SF Mono", Menlo, monospace;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font: 400 14px/1.35 var(--px); color: var(--text); font-synthesis: none; -webkit-font-smoothing: antialiased; }
.fl-root * { box-sizing: border-box; }
.fl-px { border: 3px solid; border-color: var(--hi) var(--lo) var(--lo) var(--hi); border-radius: 3px;
  box-shadow: 0 0 0 2px rgba(0,0,0,0.55), 0 10px 24px rgba(0,0,0,0.4); }

/* launcher: bottom-left, between the quest log and the Activity/Links row */
.fl-launch { position: absolute; left: 14px; bottom: 64px; pointer-events: auto; cursor: pointer; background: #4a4658;
  color: var(--text); font: 400 15px/1 var(--px); padding: 7px 12px; display: flex; gap: 8px; align-items: center; }
.fl-launch:hover { background: #5a5570; }
.fl-launch kbd, .fl-key { font: 600 11px/1 var(--mono); border: 1px solid var(--line2); background: rgba(0,0,0,0.3); padding: 2px 5px; color: var(--muted); }
.fl-launch .n { color: var(--muted); }
.fl-launch .bad { color: var(--red); }
.fl-launch.on { display: none; }

/* panel */
.fl-panel { position: absolute; top: 0; left: 0; bottom: 0; width: max(50vw, min(640px, 100vw)); pointer-events: auto; background: var(--bg);
  border-right: 3px solid var(--lo); box-shadow: 2px 0 0 var(--hi), 10px 0 24px rgba(0,0,0,0.4); display: flex; flex-direction: column;
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); animation: fl-in .18s steps(4); }
.fl-panel.full { width: 100vw; border-right: 0; box-shadow: none; }
.fl-panel[hidden] { display: none; }
@keyframes fl-in { from { transform: translateX(-24px); opacity: 0; } to { transform: none; opacity: 1; } }

.fl-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; padding: 12px 14px 10px; border-bottom: 2px solid var(--line); }
.fl-head .fl-sp { flex: 1; }
.fl-title { font: 400 21px/1 var(--px); color: var(--gold); white-space: nowrap; }
.fl-title small { display: block; font: 400 13px/1.2 var(--px); color: var(--muted); margin-top: 3px; }
.fl-tabs { display: flex; flex-wrap: wrap; gap: 6px; order: 3; flex-basis: 100%; }
.fl-tabs:empty { display: none; }
.fl-tab { cursor: pointer; background: rgba(0,0,0,0.2); color: var(--muted); border: 2px solid var(--line); border-radius: 3px; padding: 5px 9px;
  font: 400 14px/1.1 var(--px); display: flex; align-items: center; gap: 7px; white-space: nowrap; max-width: 340px; }
.fl-tab i { width: 9px; height: 9px; flex: none; background: var(--c); box-shadow: 0 0 0 1px #000; }
.fl-tab span { overflow: hidden; text-overflow: ellipsis; }
.fl-tab em { font-style: normal; font-size: 13px; }
.fl-tab em.ok { color: var(--ok); } .fl-tab em.bad { color: var(--red); } .fl-tab em.run { color: var(--muted); }
.fl-tab:hover { color: var(--text); border-color: var(--line2); }
.fl-tab.on { color: #fff; border-color: var(--c); background: rgba(255,255,255,0.07); }
.fl-btn { cursor: pointer; color: var(--text); background: #4a4658; border: 3px solid; border-color: #8a85a0 #232030 #232030 #8a85a0; border-radius: 3px;
  font: 400 14px/1 var(--px); padding: 5px 10px; white-space: nowrap; }
.fl-btn:hover { background: #5a5570; }
.fl-btn:active { border-color: #232030 #8a85a0 #8a85a0 #232030; }
.fl-btn.on { background: #6b5a24; border-color: #e9c96b #3a2f0c #3a2f0c #e9c96b; color: #fff; }

.fl-body { flex: 1; overflow: auto; padding: 12px 14px 20px; scrollbar-width: thin; scrollbar-color: var(--line2) transparent; }
.fl-empty { color: var(--muted); padding: 40px 10px; text-align: center; line-height: 1.8; font-size: 15px; }

/* summary strip */
.fl-sum { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; margin-bottom: 10px; }
.fl-phases { display: flex; align-items: center; }
.fl-ph { font: 400 13px/1 var(--px); padding: 5px 8px; border: 2px solid var(--line); color: var(--dim); }
.fl-ph + .fl-ph { border-left: 0; }
.fl-ph.done { color: var(--muted); }
.fl-ph.cur { color: #0b0d12; background: var(--c, #7dcfff); border-color: var(--c, #7dcfff); }
.fl-ph small { font-size: 12px; opacity: 0.85; margin-left: 4px; }

.fl-score { display: flex; flex-wrap: wrap; gap: 6px; }
.fl-sc { border: 2px solid var(--line); border-radius: 3px; background: var(--bg2); padding: 4px 9px; min-width: 64px; }
.fl-sc b { display: block; font: 600 15px/1.15 var(--mono); color: #fff; }
.fl-sc span { font: 400 12px/1.2 var(--px); color: var(--muted); }
.fl-sc.ok { border-color: rgba(110,224,122,0.6); } .fl-sc.ok b { color: var(--ok); }
.fl-sc.bad { border-color: var(--red); } .fl-sc.bad b { color: var(--red); }
.fl-sc.na b { color: var(--dim); }

.fl-cmp { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; margin: 0 0 12px; padding: 8px 10px; border: 2px dashed var(--line2); border-radius: 3px; }
.fl-cmp .lbl { font: 400 14px/1 var(--px); color: var(--gold); }
.fl-cmp b, .fl-cmp .delta { font: 600 12.5px/1 var(--mono); color: #fff; }
.fl-cmp .delta { color: var(--ok); }
.fl-cmp .delta.up { color: var(--red); }
.fl-cmp .drop { flex-basis: 100%; color: var(--muted); font-size: 13px; }
.fl-cmp .drop s { color: var(--dim); }

.fl-pair { display: flex; gap: 16px; align-items: flex-start; }
.fl-pair > .fl-col { flex: 1; min-width: 0; }
.fl-colh { font: 400 16px/1 var(--px); margin: 0 0 8px; color: var(--muted); }
.fl-colh b { font-weight: 400; color: var(--gold); }

/* graph */
.fl-graph { position: relative; padding-bottom: 4px; }
.fl-edges { position: absolute; left: 0; top: 0; pointer-events: none; overflow: visible; z-index: 0; }
.fl-rootn { position: relative; z-index: 1; margin: 0 auto 22px; max-width: 560px; padding: 8px 12px; background: var(--bg2); border: 3px solid var(--c); border-radius: 3px; text-align: center; }
.fl-rootn .k { font: 400 12.5px/1.2 var(--px); color: var(--muted); margin-bottom: 5px; }
.fl-rootn .k b { font-weight: 400; color: var(--c); }
.fl-rootn .txt { font: 400 17px/1.3 var(--px); color: #fff; }
.fl-grid { position: relative; z-index: 1; display: grid; column-gap: 10px; row-gap: 14px; }
.fl-laneb { background: linear-gradient(180deg, color-mix(in srgb, var(--c) 11%, transparent), transparent 85%); border-top: 3px solid color-mix(in srgb, var(--c) 55%, transparent); }
.fl-lh { padding: 6px 6px 2px; min-width: 0; }
.fl-lh .t { font: 400 15px/1.15 var(--px); color: var(--c); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fl-lh .s { font: 400 12px/1.25 var(--px); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fl-railh { font: 400 11px/1 var(--px); color: var(--ok); writing-mode: vertical-rl; align-self: end; justify-self: center; opacity: 0.75; }

.fl-node { position: relative; min-width: 0; cursor: pointer; background: var(--bg2); border: 2px solid color-mix(in srgb, var(--c) 45%, var(--line));
  border-left-width: 5px; border-left-color: var(--c); border-radius: 2px; padding: 5px 7px 6px 6px; box-shadow: 3px 3px 0 rgba(0,0,0,0.45); }
.fl-node:hover { border-color: #fff; border-left-color: var(--c); z-index: 2; }
.fl-node .l1 { display: flex; gap: 6px; align-items: baseline; }
.fl-node .ord { font: 600 11px/1 var(--mono); color: var(--muted); flex: none; min-width: 12px; }
.fl-node .ttl { font: 400 15px/1.2 var(--px); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
.fl-node .l2 { display: flex; flex-wrap: wrap; gap: 4px 7px; align-items: center; margin-top: 5px; }
.fl-node .l3 { font: 11.5px/1.35 var(--mono); color: var(--muted); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fl-node .l3 i { font: 400 12.5px/1 var(--px); font-style: normal; color: var(--h); margin-right: 4px; }
.fl-node .l3.fl { color: var(--red); font: 400 13px/1.25 var(--px); white-space: normal; }
.fl-v { font: 400 12.5px/1 var(--px); padding: 2px 5px 3px; border: 1px solid; border-radius: 2px; }
.fl-v.verified { color: var(--ok); border-color: rgba(110,224,122,0.5); background: rgba(110,224,122,0.08); }
.fl-v.stale { color: #1b1306; background: var(--stale); border-color: var(--stale); }
.fl-v.gap { color: var(--amber); border: 1px dashed var(--amber); background: rgba(255,176,32,0.1); }
.fl-v.pending { color: var(--muted); border-color: var(--line2); animation: fl-blink 1s steps(2) infinite; }
.fl-v.ghost { color: var(--dim); border: 1px dotted var(--line2); }
.fl-v.bad { color: #fff; background: var(--red); border-color: var(--red); }
.fl-mk { font: 12px/1 var(--mono); color: var(--muted); }
.fl-ck { font: 400 13.5px/1 var(--px); color: var(--ok); }
.fl-st { font: 400 13.5px/1 var(--px); color: var(--amber); }
.fl-st.no { color: var(--red); }
@keyframes fl-blink { 50% { opacity: 0.35; } }

.fl-node.st-useful { border-color: color-mix(in srgb, var(--ok) 70%, var(--c)); border-left-color: var(--c); box-shadow: 3px 3px 0 rgba(0,0,0,0.45), 0 0 14px rgba(110,224,122,0.22); }
.fl-node.st-useful .ttl { color: #fff; text-shadow: 0 0 8px rgba(110,224,122,0.35); }
.fl-node.st-wasted { opacity: 0.42; filter: grayscale(0.85); }
.fl-node.st-wasted:hover { opacity: 0.85; }
.fl-node.st-gap { border: 2px dashed var(--amber); border-left: 5px dashed var(--amber); background: rgba(40, 30, 8, 0.92); }
.fl-node.st-stale { border-color: var(--stale); border-left-color: var(--stale); }
.fl-node.st-pending { animation: fl-blink 1.2s steps(2) infinite; }
.fl-node.ghost { background: rgba(20,18,28,0.7); border: 2px dotted var(--line2); border-left: 5px dotted var(--dim); box-shadow: none; }
.fl-node.ghost .ttl { color: var(--muted); }
.fl-node.skipped, .fl-node.unverified-cite { border-color: var(--red); border-left-color: var(--red); }
.fl-node.bad { border-color: var(--red); border-left-color: var(--red); box-shadow: 3px 3px 0 rgba(0,0,0,0.45), 0 0 12px rgba(255,93,108,0.3); }
.fl-node.dropped { opacity: 0.5; filter: grayscale(0.7); }
.fl-node.dropped .ttl { text-decoration: line-through; text-decoration-thickness: 2px; }
.fl-node .drop-tag { font: 400 12px/1 var(--px); color: var(--muted); border: 1px solid var(--line2); padding: 1px 4px 2px; }

.fl-answer { position: relative; z-index: 1; margin-top: 22px; padding: 9px 12px 10px; background: var(--bg2); border: 3px solid var(--ok); border-radius: 3px; box-shadow: 4px 4px 0 rgba(0,0,0,0.45); }
.fl-answer.pending { border: 3px dashed var(--line2); color: var(--muted); }
.fl-answer.blocked, .fl-answer.bad { border-color: var(--red); }
.fl-answer .k { font: 400 14px/1 var(--px); color: var(--ok); margin-bottom: 6px; display: flex; gap: 12px; }
.fl-answer.blocked .k, .fl-answer.bad .k { color: var(--red); }
.fl-answer.pending .k { color: var(--muted); }
.fl-answer .txt { font: 13px/1.5 var(--mono); color: var(--text); }
.fl-answer .inh { font: 400 13px/1.3 var(--px); color: var(--muted); margin-top: 5px; }
.fl-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; align-items: center; }
.fl-chips .lbl { font: 400 13px/1 var(--px); color: var(--muted); margin-right: 2px; }
.fl-chip { cursor: pointer; font: 400 13px/1 var(--px); padding: 3px 7px 4px; border-radius: 2px; border: 1px solid rgba(110,224,122,0.5); color: var(--ok); background: rgba(110,224,122,0.07); }
.fl-chip:hover { background: rgba(110,224,122,0.2); }
.fl-chip.gap { color: var(--amber); border: 1px dashed var(--amber); background: rgba(255,176,32,0.08); }
.fl-chip.stale { color: var(--stale); border-color: var(--stale); background: rgba(201,162,74,0.08); }
.fl-chip.bad { color: #fff; border-color: var(--red); background: rgba(255,93,108,0.35); }
.fl-chip.art { color: #7dcfff; border-color: #7dcfff; background: rgba(125,207,255,0.08); }

.fl-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; padding: 8px 14px 10px; border-top: 2px solid var(--line); font: 400 13px/1.2 var(--px); color: var(--muted); }
.fl-legend i { display: inline-block; width: 14px; height: 10px; margin-right: 5px; vertical-align: -1px; border: 2px solid; }

.fl-tip { position: fixed; z-index: 40; pointer-events: none; max-width: 380px; background: rgba(16,14,22,0.97); padding: 9px 11px; font: 12px/1.45 var(--mono); color: var(--text); }
.fl-tip[hidden] { display: none; }
.fl-tip .h { font: 400 17px/1.2 var(--px); color: #fff; }
.fl-tip .id { color: var(--dim); font-size: 11px; margin-bottom: 6px; }
.fl-tip .j { font: 400 14.5px/1.3 var(--px); margin: 4px 0 6px; }
.fl-tip .j.ok { color: var(--ok); } .fl-tip .j.warn { color: var(--amber); } .fl-tip .j.bad { color: var(--red); } .fl-tip .j.dim { color: var(--muted); }
.fl-tip .ev { border-left: 2px solid var(--line2); padding-left: 8px; margin: 4px 0; color: #e0dac8; }
.fl-tip .lab { font: 400 12.5px/1 var(--px); color: var(--muted); margin-top: 8px; }
`;
