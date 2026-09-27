---
name: humans-lessons
description: Lessons from the humans workspace (blocky voxel agent figures in web/src/agents/human and avatar.ts) - skinned box rig, pixel-art atlas, procedural poses, pixel nameplate/bubble, headless close-up QA. Load before changing how agents look or animate in Mind Palace.
---
# Humans lessons

- **Build the whole body as ONE skinned mesh.** Rigidly bind each box to one bone (skinIndex = bone, weight 1),
  merge them, then `mesh.updateMatrixWorld(true)` before `mesh.bind(new Skeleton(bones))`. That gives one draw
  call per human, and joints are just `bone.rotation`. Set `frustumCulled = false`, because bounds don't follow bones.
- **Forearm or crossed-arm folds need an Euler order.** Three's default `XYZ` applies Z first. For "bend,
  then swing across", use `YXZ`. With rigid single-box arms, "arms crossed" is just x≈-1 plus inward z.
- **Rigid legs need a hip drop.** Lower the root by `legLen·(1-cos(angle))`, or the feet lift off the floor
  mid-stride. That drop is also the head bob. Drive the walk phase by distance travelled, not time, and cap
  cadence at ~3 Hz for the 5-20 m/s catch-up sprints.
- **Pixel art on boxes:** paint each face into a shelf-packed canvas atlas and remap BoxGeometry UVs per face.
  Face order is +x,-x,+y,-y,+z,-z, and with `flipY` the formula is `v' = 1-(y0+(1-v)·h)/H`. Use
  `magFilter: Nearest`. Floor every texel index: a fractional `w/2` silently wrote nowhere.
- **Anything `toneMapped:false` and near-white blooms** (UnrealBloom threshold is 0.78). Keep label text and
  bubble fills under ~0.8 sRGB, or they turn into glowing blobs in the overview.
- **Pixel font with no font file:** draw 10px text on a scratch canvas, keep alpha > 120 as 1-bit pixels, and
  show it on a `sizeAttenuation:false` sprite with NearestFilter at an integer CSS-px-per-texel.
- **Overhead readability:** a 1.75 m figure is ~6 px wide from 60 m. Scale the figure up with camera distance
  (grab the camera in `mesh.onBeforeRender`) and lift the nameplate off the head in screen space
  (`sprite.center.y < 0`), or the tag covers the body.
- **Infer, don't wait for wiring.** Pose comes from state the Avatar already has: queue drained next to the
  scene's `"orbs"` InstancedMesh means reading, `setWaiting` means waiting, the `setTag` suffix drives the bubble.
  Optional methods (`setActivity`, `setBubble`, `face`, `playSpawn`) are only there for extra polish.
- **Headless close-ups:** the presence camera director fights `palaceScene.teleport`. Wrap
  `scene.onBeforeRender` (call the previous hook first) and set the camera there. The camera object is
  captured from any mesh's `onBeforeRender`. Pick the side of the avatar nearer the room centre, or you
  shoot through walls. From a page you can `await import("/src/agents/avatar.ts")` (Vite) to spawn test
  agents, but not bare `"three"`, so borrow `Vector3` from an existing avatar's `pos.constructor`.
- What I'd do differently: write the close-up camera hook first. The first screenshots were all walls, and
  the demo's own `wait` never lasts long enough to see the waiting pose, so stage poses on the end state.
