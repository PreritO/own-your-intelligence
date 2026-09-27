---
name: retrieval-walk
description: Load when working on the ask bar, single-trace replay, guide orb, camera path, or answer panel (web/src/walk.ts, web/src/ui). The original hero feature of Agent Palace.
---
# Retrieval walk

- Input: a `Trace` (server/schema.ts). Output: an 8-15 s cinematic from the player's position to the answer.
- Trigger: ask bar (opens on `/`) fires `UI_EVENTS.ask`; walk POSTs to `:8787/ask`, falls back to `/traces/demo-1.json` on any error or under `?demo`.
- Path: use `web/src/nav.ts` `pathBetween(palace, from, to)` (room center → door → partner door → … → target) then a `CatmullRomCurve3` through the waypoints. Never cut through walls.
- Timing: total 8-15 s, split evenly per hop; ease in/out at each memory.
- Per hop: `rt.setMemoryGlow(id, 4)`, sprite label `"<step>. <reason>"`, `rt.setRoomLit(room, true)`; leave a fading light trail.
- Start: `rt.controls.release()`, `rt.setPalaceDim(0.3)`. End: answer panel with text + cited memories; Esc → `rt.controls.restore()`, `rt.setPalaceDim(1)`.
- Verify: replay every trace in `fixtures/traces/`; none clip through geometry; each ends on its answer memory.
