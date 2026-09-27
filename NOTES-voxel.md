# NOTES — voxel workspace (web/src/scene only)

## What shipped
- Daylight block world on a 1 m voxel grid, built from the unchanged `palace.json` layout. Blocks are centred on integer x/z
  and span integer y, so every wall line (all integers in the fixture) is exactly one block thick.
- `scene/layout.ts`: `DOOR_WIDTH=3` (3-block gaps), `DOOR_HEIGHT=3`, `WALL_T=1`, `CORRIDOR_WALL_H=2`. Corridor walls now
  carry `roomId` (the non-foyer room). New `boxCells(box)` voxelizes a Box. Corridor centre lines are unchanged, so nav.ts is unaffected.
- Palettes (all procedural 16x16 original pixel art in `scene/textures.ts`, NearestFilter, no mipmaps on blocks):
  - Legal: purple stone bricks with chiselled purpur caps.
  - Finance: sandstone with gold.
  - Eng: mossy cobble.
  - People: oak planks with logs.
  - Foyer: polished stone, chiselled caps, a checker floor and a gold "quest ring".
  - Gym: iron blocks with a red rubber-mat floor.
  - Workshop: planks with anvil-grey caps.
  - Loose Ends: cobble with a cork notice-board wall opposite its door.
  - Corridors: gravel paths.
- Door thresholds: a team-coloured wool stripe in the floor, plus 4 banners per door (both jambs, both faces). Foyer doors use the destination wing's colour.
- Memories: a lectern with a floating book that slowly spins and bobs. Freshness drives the book's brightness and a pixelated halo.
  - Stale memories (freshness < 0.3) get a cobweb and grey dust motes.
  - A `visit` event with verdict `gap` removes the book, leaving a visibly empty lectern.
- Torches are emissive blocks, with no PointLights.
- Outdoors: a sky dome, a pixel sun, drifting block clouds, grass, 34 blocky trees, flowers and tall grass.
- Signs: pixel-font wooden boards (Sprites) above each room entrance. The foyer's reads "Hall of Quests".

## Runtime hooks (for the UI agent)
- `setLayerVisible(layer, on)`:
  - `links`: pixel-dotted arcs. Default OFF.
  - `roomLabels`: signs. Default ON.
  - `memoryLabels`: instanced pixel-text billboards from one atlas. Default OFF.
  - `ceiling`: slab roofs. Default OFF.
  - `bloom`: subtle. Default OFF; `?bloom` turns it on.
- `focusRooms(ids | null)`: rooms not listed ease to 12 % brightness (walls, floors, lecterns, books, banners, torches, signs),
  and outdoors eases to 40 %. `null` restores.
- `addMemory(memory)`:
  - Pushes into `rt.palace.memories` if absent.
  - Adds a lectern and book with a pop-in: the lectern scales up with overshoot, the book drops in, 44 block particles burst and a light column shows for 1.5 s.
  - The new memory is pickable, works with `flyTo` and gets a memory label.
  - Calling it again with the same id moves the memory and pops it in again. Capacity is 32 new memories.
  - **The scene does NOT subscribe to `artifact` events itself.** Whoever handles `artifact` should call `rt.addMemory(e.memory)`,
    so the commission flow controls the timing.
- Hall of Quests ring: gold inlay cells 2.6–3.7 m from the foyer centre. Suggested slots for new pages:
  `[3.2*cos(k*45°), 1.1, 3.2*sin(k*45°)]`, k = 0..7 (y = 1.1 like every other memory).
- The default camera is unchanged (foyer, eye level). The high overview is the UI/presence camera's job. The world is roofless.
- QA hooks: `window.palaceScene.view([x,y,z],[lx,ly,lz])` (releases controls), `.teleport`, `.stats()`, `.setBloom`.
  URL params: `?debug`, `?noshadows`, `?bloom`, `?nodegrade`.
- HUD CSS (`.mp-tip`, `.mp-hint`, `.mp-minimap`, `.mp-cross`) is restyled blocky. The minimap shows grass with solid room colours.

## Calls I made
- Grass and floors use mipmaps (NearestMipmapLinear) to kill moire at distance. Wall and prop textures follow the no-mipmap rule.
- Shadows: one directional sun with PCF (three r186 removed PCFSoft), and `shadowMap.autoUpdate=false`. The world is static, so the
  shadow map re-renders only on start, on a ceiling toggle and on addMemory. Plugins' moving objects won't cast shadows (none do today).
- Signs are billboards (Sprites) rather than fixed boards, so they read from any overview angle.
- Commons colours (not in wings): Gym #e06c75, Workshop #d19a66, Loose Ends #56b6c2.

## Perf (headless Chrome, software GL, 1440x900, default overview camera; the fps there is meaningless)
- Scene only: **22 draw calls, 38k tris**, measured with every plugin hidden. The whole app with the ui/presence plugins: ~80-100 calls and ~55k tris.
  Before the merge it was ~135 calls and 142k tris.
- `scene/world.ts` merges every wall, cap, frame, floor tile, corridor path, door stripe, quest-ring tile and tree block into ONE mesh.
  - It uses one 16x16-tile atlas and culls hidden faces between solid neighbours.
  - Per-room focus and lit come from a per-vertex room index plus uniform arrays (`uF`, `uLit`, `uTint`), so focusRooms/setRoomLit never touch geometry.
- Room signs are one instanced billboard over a sign atlas, not 12 sprites.
- Shadows are static (`autoUpdate=false`), so the shadow pass costs nothing per frame.
- Click picking reaches 220 m. A synthetic click on a lectern 60 m from the default overview camera fires `palace:select`.
- The minimap and the "Click to walk" hint are only created in `?walk` mode. The debug overlay moved to the bottom right, out of the HUD's left panel.

## Proposals for the integrator
- None blocking. If draw calls matter, presence's per-station meshes are now the biggest share (~75 calls).
