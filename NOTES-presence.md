# NOTES: presence workspace

Branch `ws/presence`. Owns `web/src/agents/`, `web/src/walk.ts`, `web/src/ui/`, `web/src/nav.ts`.
No changes to `api.ts`, `events.ts`, `schema.ts`, `plugins.ts`, `package.json` or scene files. No new dependencies.

## What's built
- `nav.ts`: `pathBetween(palace, from, roomId | memoryId | {room, point}, {y, stopAtDoor})`. BFS over the
  door graph, then for each room hop: inset point → door → **the scene's own corridor legs** (imported from
  `scene/layout.ts` `buildLayout().corridors`, so straight/L/Z corridors all work) → partner door → inset.
  Falls back to a straight door-to-door line if a pair has no corridor. Checked against the scene's wall
  colliders: 0 hits over ~520k samples on the 9-room palace, and 0 on a synthetic Z-corridor room.
- `agents/`: presence layer, a pure function of `rt.events`.
  - `avatar.ts`: orb in team colour, halo, point light, constant-screen-size name tag, fading trail, dotted
    "waiting" ring. Walks a waypoint queue at a cruise speed set so the whole backlog lands in ~1.6 s (× replay
    speed), then eases in. Never lags the stream, so 1x and 3x end in the same place.
  - `stations.ts`: claimed = spinning arcs in the agent colour + "2/5 Title" tag; verified = green flare,
    column, then steady green ring (label hides after 3 s); stale = dim amber ring + note; gap = pulsing
    amber ring, column, glow and a large constant-size "gap: no owner recorded" note below the orb.
  - `beams.ts`: handoff beam between the two avatars with packets and the question as a label; on
    `reply` it flips to the owner's colour, shows the answer for 1.2 s, then fades.
  - `camera.ts`: one camera director shared by presence modes and the walk (priority: walk > presence).
    Calls `controls.release()` on the first holder and `restore()` when the last one leaves; re-applies the
    pose in `scene.onBeforeRender` (chained) so no controller can fight it.
  - `run.ts`: new-run detection (run id change, or `t` going backwards), plain-word names.
  - `index.ts`: event handling, camera modes, `T` dispatch.
- `ui/`: right column = agent roster (status, route progress, click to follow), answer cards (cited station
  chips in green, gaps in amber, stale in dim amber, `blocked` in red), plain-words feed (newest first).
  Left = memory side panel on `UI_EVENTS.select` (title, room/wing, freshness bar, agent verdicts on that
  station, excerpt or an amber "page is empty", linked memories that `flyTo` and re-open the panel).
  Top centre = camera mode, Dispatch button, key hints, toasts; ask bar opens below it on `/`.
- `walk.ts`: ask bar → `POST :8787/ask` (8 s timeout) → canned `/traces/demo-1.json` on any error or
  under `?demo`. Guide orb along a centripetal Catmull-Rom through `pathBetween` waypoints, 8-15 s split
  evenly per hop with ease in/out, `setMemoryGlow(id, 4)` flare + "N. reason" label + `setRoomLit` per hop,
  7 s fading gold trail, palace dimmed to 0.3, answer panel with cited chips, Esc restores everything.

## Keys
`T` dispatch · `1`/`2`/`3` follow Legal/Finance/Eng (same key again = free walk) · `0` or `O` overhead ·
`F` or `Esc` free walk · `/` ask. The roster rows and the Dispatch button do the same with the mouse.

## Calls I made without a human
- **Foreign rooms are approached, not entered.** On `move` into a room owned by another team (not `shared`),
  the avatar stops ~0.8 m outside that room's door (loci rule 3, demo beat 6). Legal waits at the Budgets
  door while the beam runs to Finance.
- **Reset on a new run** is detected from the stream itself (run id changes or `t` jumps back), so `T`
  in demo mode (`rt.events.restart()`) and a fresh live dispatch both clear rings, beams, feed and answers.
- **Live `T`**: `POST http://localhost:8788/dispatch` with `{"tasks":[{agent,text}×3]}` (4 s timeout). If the
  bridge is down it toasts "Bridge offline, replaying demo-1 instead" and runs `rt.events.restart("demo-1")`
  (which works in live mode too), so pressing T on stage always shows something.
- Route progress counts only stations on the agent's route; a station covered by a handoff reply counts for
  the asker (Legal ends 5/5).
- Labels on avatars, beams, station states and walk hops use constant on-screen size (`sizeAttenuation:
  false`) and `toneMapped: false`, so they stay readable in overhead view and under the scene's dim/bloom.
- Overhead view frames the palace in the part of the screen not covered by the right column.
- Presence never calls `setMemoryGlow` (the walk owns it) to avoid fighting over orb glow.
- `nav.ts` imports `buildLayout` from `scene/layout.ts` (read-only use of a pure scene module) so agents
  walk the exact corridors the scene draws. A throw inside `buildLayout` falls back to straight
  door-to-door lines, but renaming/removing the export breaks the build: keep `buildLayout(palace).corridors`
  stable or tell presence.

## For the integrator
- `main.ts` auto-starts the replay on load under `?demo`. For the stage, load `?demo`, let it play (or not),
  then press `T` to restart from zero. If you want a quiet start, a `?demo&hold` that skips the auto
  `restart()` in `main.ts` would be a scene/integrator change.
- Stage pacing: the demo-1 replay is 13.2 s at 1x. The skill wants 15-25 s: use `?demo&speed=0.7`
  (~19 s). All timing (walk speed, flares, beam fade) scales with `rt.events.speed`.
- `window.presence` and `window.walk.play(trace)` are QA hooks, not contract.
- Screenshots and a GIF live in `web/src/agents/qa/` (not imported by the app). Delete after the PR if you
  don't want binaries in the tree.
- Proposal (not blocking): an `rt.controls.lookAt(pos, target)` or `setPlayerPose` in `api.ts` would let the
  camera director drop the `scene.onBeforeRender` re-apply trick.

## Verification
- `bun run validate && bun run typecheck && bun run build`: green (after merging main with the 9-room palace).
- Headless Chrome (playwright-core + system Chrome, real scene from main, GPU):
  - `/?demo`: fan-out, claims, stale Security Policy, Finance's dotted wait ring at Org Chart while Eng holds
    the claim, Legal stops at the Budgets door, handoff beam Legal→Finance with the question, reply flips the
    beam, pulsing amber gap at `eng/soc2-owner` with "gap: no owner recorded", three answer cards.
  - End state at `?demo` (17 s) and `?demo&speed=3` (7 s) compared programmatically: station states, avatar
    positions, open beams, answer count, gap chips, roster and every feed line are identical.
  - `?demo=contract-run2` (run ids, learned route) plays cleanly.
  - Live mode with the bridge down: `T` falls back to the replay, same end state.
  - Ask bar `/` + Enter under `?demo`: 5-hop walk through doors, labels, lit rooms, answer panel, Esc restores.
  - Follow (1-3) and overhead (0) modes work with the real PointerLock controls released/restored.
- **Pending for integrator:** pointer-lock feel after Esc on a real laptop (headless can't lock the pointer);
  fps with three avatars + point lights on the demo machine (each avatar adds one PointLight).
