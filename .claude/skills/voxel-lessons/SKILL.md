---
name: voxel-lessons
description: Lessons from the voxel workspace (Minecraft-style reskin of web/src/scene - block grid, pixel textures, lecterns, focusRooms/addMemory/setLayerVisible). Load before changing the voxel palace look or its runtime hooks.
---
# Voxel lessons

- The grid choice decides everything. Centre blocks on integer x/z and span integer y. The fixture's wall lines are integers, so
  with `WALL_T=1` and `DOOR_WIDTH=3` the `layout.ts` boxes voxelize exactly (`boxCells`: ceil(min)..floor(max)), and the colliders are the blocks.
- A grass ground plane 1 cm under the floors z-fights in headless GL (16-bit depth). Put it 8 cm down.
- three r186 dropped `PCFSoftShadowMap`; it falls back with a warning. Use PCF.
- WebGLShadowMap tests `object.layers` against the MAIN camera, so a "shadow-only layer" proxy doesn't work. For a static
  world, use `shadowMap.autoUpdate=false` and set `needsUpdate` on change. The per-frame shadow pass cost drops to zero.
- Pixel text: draw at 7-11 px on a canvas, threshold alpha (>110 becomes 255) and use NearestFilter. It stays readable and crisp without a web font.
- `ShaderMaterial` output needs `#include <colorspace_fragment>`, or sRGB textures look washed out.
- Browse CLI: a long `js` string with brackets trips the worktree guard when chained with `;` or `&&`. Run each browse call on its own.
- HMR reloads restart the replay. Wait ~4 s after an edit before taking a screenshot.
- The biggest perf win was one merged "world" mesh (atlas + hidden-face culling + a per-vertex room index read from a
  uniform array in `onBeforeCompile`). It took the scene from ~60 draw calls and 68k tris to 22 draw calls and 38k tris with the same look.
- What I'd do differently:
  - Take the first headless screenshot within 20 min. It caught the floor z-fight immediately.
  - Budget draw calls against the whole app, not just the scene. Plugins added ~75.
