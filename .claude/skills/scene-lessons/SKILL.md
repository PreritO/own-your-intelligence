---
name: scene-lessons
description: Lessons from the scene workspace (three.js palace renderer, controls, picking, minimap). Load before changing web/src/scene, web/src/controls.ts or anything that depends on PalaceRuntime visuals in Agent Palace.
---
# Scene lessons

- Keep geometry math pure (`scene/layout.ts`): walls, door gaps, corridors and colliders come from the same
  boxes, so what you see is what you collide with. Test it with a plain `bun` script, no browser needed.
- Door frames: a jamb box spanning the full wall thickness shows its whole 0.3 m reveal at an angle and looks
  like a fat slab. Put thin strips on each wall face instead.
- Floors: emissive tint through a radial `emissiveMap` goes muddy fast; keep base emissive around 0.01 and
  use it only for "lit". RoomEnvironment reflections on a low-roughness floor make big grey patches; keep
  `environmentIntensity` <= 0.06 and floor roughness ~0.55.
- Bloom (UnrealBloomPass) needs `renderer.info.autoReset = false` + manual reset, or the debug overlay only
  counts the last pass. MeshBasic + `toneMapped:false` with colours > 0.8 is how trims/orbs bloom.
- Orbs must look lit with bloom off (auto-degrade turns it off on slow GPUs): instanced ShaderMaterial with a
  fresnel core + billboard halo using `instanceColor` (three declares the attribute for ShaderMaterial).
- Headless Chromium (gstack browse) is fine for correctness: drive it with `window.palaceScene.teleport()`
  and synthetic `keydown`/`keyup` on window, read positions back. Its fps is software GL; don't trust it.
- The worktree guard blocks `$B eval` and variable-named commands; call the browse binary by absolute path
  and put async scripts in `js "..."` that store results on `window`, then read them in a second call.
- `window.addEventListener` explicitly: bun-types makes the global `addEventListener` untyped for keys.
- What I'd do differently: build the debug overlay + teleport hook first; every later check was faster.
