---
name: presence-lessons
description: Lessons from the presence workspace (agent avatars, station states, handoff beams, feed, camera modes, ask-bar walk, nav). Load before changing web/src/agents, web/src/ui, web/src/walk.ts or web/src/nav.ts in Agent Palace.
---
# Presence lessons

- **Catch-up speed must be linear, not proportional.** `speed = remaining / T` recomputed every frame is an
  exponential decay: avatars never quite arrive and lagged 3-4 s behind the stream (Legal was still in the
  foyer when its handoff beam fired). Fix: set a cruise speed once per `walk()` so the whole queue lands in
  ~1.6 s, then ease in over the last meters.
- **Final state = events only.** Markers are set on events; avatars always drain their queue; timed effects
  (flares, beam fade, verified label hide) use `dt × replay speed`. Then 1x and 3x end states compare equal
  field by field (check this programmatically, not by eyeballing screenshots).
- **Detect runs from the stream** (run id change or `t` jumping back). `rt.events.restart()` emits no reset
  event, and live dispatches restart `t` at 0.
- **Walk the scene's corridors, not your guess of them.** Corridors can be L or Z shaped. `nav.ts` reads
  `buildLayout(palace).corridors` from `scene/layout.ts`; verify with the scene's colliders (0 hits).
- **Camera ownership:** one director with priorities (walk > presence). Re-apply the pose in a chained
  `scene.onBeforeRender` + `camera.updateMatrixWorld()`, because OrbitControls.update() calls `lookAt`
  even when disabled. `controls.restore()` can't re-lock the pointer; the scene shows "Click to walk".
- **Labels:** `sizeAttenuation: false` for anything that must read in overhead view, `toneMapped: false` so
  bloom/dim don't wash text out, and `sprite.center` to anchor above/below the point at any zoom. Gap note
  goes below the orb so the reporting agent's tag doesn't cover it.
- **HUD placement:** scene owns bottom-centre (Click to walk hint) and bottom-left (minimap). Presence uses
  top-centre (bar, ask, toasts), right (roster, answers, feed) and top-left (memory panel, height-capped).
  Set `pointer-events: none` inline on full-screen roots; `#hud > *` sets `auto` and would eat canvas clicks.
- **Headless QA that worked:** playwright-core + `channel: "chrome"` (system Chrome, GPU), a script that
  presses keys at given times, screenshots, and dumps `window.presence` state. Keep it outside the repo or
  in an untracked dir. The Chrome extension may be unavailable; don't wait on it.
- What I'd do differently: build the 1x/3x state-diff script first; it caught nothing wrong in markers but
  made the avatar-lag bug obvious once I looked at positions at a fixed replay time.
