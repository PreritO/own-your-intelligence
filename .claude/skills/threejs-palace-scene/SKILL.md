---
name: threejs-palace-scene
description: Load when building or changing the three.js palace in web/src/scene, controls.ts or main.ts - rooms, pedestals, link beams, lighting, controls, picking, minimap. Style and performance rules for Agent Palace.
---
# Palace scene

- You implement `buildScene()` returning a `PalaceRuntime` (web/src/api.ts). Every method in that interface must work; plugins depend on it. Replace the Phase 0 placeholder in `web/src/scene/index.ts` freely.
- Look: dark marble floor, low-poly walls, wing-colored trim, warm emissive memories. Calm, museum-at-night. Floating room label (sprite or CSS2D) above each room.
- Walls: build from room boxes; cut a 2.4 m wide gap at every door `pos`. Corridors: floor + low walls between each door pair.
- One InstancedMesh per repeated object (pedestals, memory orbs). Target < 200 draw calls. If you use InstancedMesh for orbs, `setMemoryGlow` must still work per instance (per-instance color, or a small overlay mesh).
- Freshness: `emissiveIntensity = 0.2 + 1.8 * freshness`; freshness < 0.3 gets a small `Points` dust cloud.
- Link beams: thin additive-blended lines between orbs; opacity rises within 6 m of either end.
- Controls (`controls.ts`): PointerLockControls + WASD + simple AABB collision against walls (doors are gaps). `controls.release()/restore()` must hand the camera to cinematics and back.
- Picking: Raycaster on memory orbs only; on click fire `emitUI(UI_EVENTS.select, { memoryId })`. Listen for `UI_EVENTS.flyTo` and tween the camera to that memory.
- Minimap: small canvas in a corner with wings (colors) and the player dot.
- Verify: `bun run dev`, load `/?demo`, walk foyer → every wing, fps ≥ 55 (show `renderer.info.render.calls` and fps in a debug overlay behind `?debug`).
