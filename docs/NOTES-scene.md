# NOTES — scene workspace

Branch `ws/scene`. Owns `web/src/scene/`, `web/src/controls.ts`, `web/src/main.ts`, `web/index.html`.
No changes to `api.ts`, `events.ts`, `schema.ts`, `plugins.ts` or `package.json`. No new dependencies.

## What's built
- `scene/layout.ts` (pure, no three.js): room walls split around 2.4 m door gaps + lintels above 2.8 m;
  one corridor per room pair (straight, L or Z, axis-aligned legs) with 1.4 m side walls and closed corners;
  `resolveCollision()` circle-vs-AABB used by controls.
- `scene/index.ts`: builds the `PalaceRuntime`. Walls, trim, pedestals, orbs, orb halos and floor light
  pools are one `InstancedMesh` each; beams are one `LineSegments`; dust is one `Points`. ~26-36 draw calls
  on the fixture palace (bloom passes included).
- `controls.ts`: PointerLockControls + WASD/arrows + Shift run, sub-stepped collision, `release/restore/settle`.
- `scene/minimap.ts`: bottom-left canvas, wings in colour, corridors, memories, player arrow + view cone,
  lit rooms highlighted.

## Contract behaviour (for presence / walk / ui / rooms)
- `memoryPosition(id)` = `memory.pos` (orb centre; orbs bob +-3.5 cm visually, the returned point is stable).
- `setMemoryGlow(id, v)`: `v` is the glow multiplier (normal = `0.2 + 1.8*freshness`, so 0.2..2). Walk's
  `setMemoryGlow(id, 4)` reads as a flare. `null` restores freshness glow. Overridden orbs ignore palace dim.
- `setPalaceDim(level)`: eased over ~0.5 s. Dims lights, trim, beams, labels, non-overridden orbs.
- `setRoomLit(room, lit)`: eased; brightens the room's floor pool + trim, highlights it on the minimap.
- `controls.release()` unlocks the pointer and stops player movement (also cancels an in-flight flyTo).
  `controls.restore()` keeps the camera where the cinematic left it **if that spot is inside a room or
  corridor**, otherwise snaps back to where the player was at `release()`. Then levels the camera
  (removes roll), sets eye height 1.6 and pushes it out of walls. `restore()` cannot re-acquire pointer
  lock (browser needs a click); the "Click to walk" hint reappears.
- `UI_EVENTS.select` fires on click of an orb or its pedestal (walls occlude). Click while pointer-locked
  picks at the crosshair and unlocks the pointer so the side panel is usable.
- `UI_EVENTS.flyTo`: 1-2.6 s eased flight to a spot 2.7 m in front of the orb (towards room centre), arcing
  over the walls when changing rooms (no ceilings). Scene does NOT re-emit `select` on arrival; ui should
  update its panel itself when it fires flyTo.
- `onFrame` callbacks run after player movement and before scene animation/render, so plugins that move
  the camera in `onFrame` win for that frame.

## Query params (scene)
`?debug` fps/draw-call/pos overlay (top-left) · `?nobloom` · `?nodegrade` (disable auto-degrade) · `?nominimap`.
Auto-degrade: after 3 s, two consecutive seconds under 45 fps turn bloom off, then drop pixel ratio to 1.

## QA hook (not contract)
`window.palaceScene = { teleport(x, z, yawDeg), flyTo(id), layout, stats(), setBloom(on) }`. yaw 0 = facing -z.

## Calls I made without a human
- No ceilings: open night sky with stars, so labels float inside rooms at ~3.35 m and flyTo can arc over walls.
- A door whose partner room lists no reverse door still gets a corridor: the gap is cut on the partner's
  nearest wall at the projected point. Doors pointing at unknown room ids get no gap (stay closed).
- Link beams are 1 px `LineSegments` arcs (WebGL ignores linewidth); brightness 0.09 base -> ~0.85 within
  1.5-6 m of either end, plus a travelling shimmer and full brightness when an end is hovered.
- Orbs use a small instanced ShaderMaterial (glowing core) + billboard halo so they still read as light
  with bloom off.
- Minimap lives bottom-left, 184 px. If ui wants that corner, move `.mp-minimap` in `SCENE_CSS`.
- Screenshots are committed under `web/src/scene/screenshots/` (not imported by the app) for the PR.

## Proposals for the integrator
- None blocking. Nice-to-have for `api.ts` later: `rt.controls.flyTo(memoryId)` / `rt.setPlayerPose()` so
  presence's camera modes don't need to save/restore the camera themselves.

## Verification status
- `bun run validate && bun run typecheck && bun run build` green.
- Headless Chromium (gstack browse, software GL): walls block, doors pass, corridor side walls block,
  foyer -> every wing reachable, finance-0 -> finance-1 through the second corridor; select fires on click;
  flyTo lands in front of the orb; all runtime methods exercised; 26-36 draw calls.
- **Pending for integrator:** fps >= 55 on a real GPU laptop (headless software GL shows 12-20 fps, not
  representative) and the actual pointer-lock mouse-look feel (headless can't lock the pointer).
