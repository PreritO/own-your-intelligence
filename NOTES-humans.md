# NOTES: humans workspace

The glowing-orb avatars are now blocky voxel humans (Minecraft-inspired, all art original and procedural).
Files: `web/src/agents/avatar.ts` (public API unchanged) plus `web/src/agents/human/`:
`rig.ts` (skinned box figure), `skin.ts` (pixel-art atlas), `pose.ts` (procedural animation),
`pixel.ts` (nameplate, bubble, ground ring, spawn burst). QA screenshots are in `web/src/agents/human/wip/`.

## Avatar API: unchanged
`new Avatar(scene, id, name, color, home)`, `group`, `pos`, `waiting`, `teleport`, `walk`, `end`, `moving`,
`setTag`, `setWaiting`, `ping`, `update(dt, speed)`, `dispose`, `AVATAR_Y` (still 1.75, head height;
`group.position` is still the head point, so beams and follow-cam are unchanged).

## New OPTIONAL methods (integrator / UI agent: wire these if you want)
| Method | What | Suggested call site in index.ts |
| --- | --- | --- |
| `setActivity(kind \| null, lookAt?)` | Forces a pose: `"reading" \| "waiting" \| "asking" \| "idle"`. `null` returns to inference. Walking always wins while moving. The explicit pose persists until `setActivity(null)` or `teleport()`. | `handoff`: `a.setActivity("asking")`, then `null` on `reply`. |
| `setBubble(text \| null)` | Explicit status-bubble text. A leading `⌛ ✓ ⚠ ✕ 📖 ? ✨` becomes a pixel icon. `null` returns to the inferred bubble. | `handoff`: `a.setBubble("? asking " + N.agent(e.toAgent))`; `reply`: `a.setBubble(null)`. |
| `face(point \| null)` | Face a world point whenever standing still. | `claim`/`visit`: `a.face(rt.memoryPosition(memId))` (optional; inference already does this). |
| `playSpawn()` | Pop-in plus a burst of team-colour blocks. | On the new `spawn` event, after constructing the Avatar. |
| `activity` (getter) | `"walk" \| "idle" \| "reading" \| "waiting" \| "asking"`, for QA/UI. | n/a |

## What gets inferred without any wiring
- moving: walk cycle (driven by distance travelled, so feet don't slide at any replay speed; cadence is capped for catch-up sprints) and turning toward the direction of travel.
- `setWaiting(true)`: arms folded, foot tap, glancing around. Bubble reads "⌛ waiting on X" when `setTag("<name>  ⌛ X")` follows (as index.ts already does).
- Stopped within 2.4 m of a memory orb: reading pose. The figure faces the orb, tilts its head down and holds a book-block. It finds orbs by reading the scene's `InstancedMesh` named `"orbs"`. **If the scene rewrite renames or removes that mesh, reading falls back to idle.** In that case call `face()` and `setActivity("reading")`.
- `setTag("<name>  ✓|⚠|✕")`: the nameplate stays as the name, and the bubble shows "answered", "answered, gaps" or "blocked". Any other suffix is shown verbatim in the bubble. A `setTag` text that doesn't start with the name replaces the nameplate text.
- An Avatar constructed more than 2.5 s after the first one auto-plays `playSpawn()`, so runtime spawns (`quest-1`, …) pop in without wiring. Calling it again just restarts the effect.

## Calls I made (no human available)
- **Any id, label or colour works.** Appearance comes from an FNV hash of the id: skin (6 tones), hair (7), long/short hair, and one accessory (cap, beanie, headphones, glasses or sprout). The shirt is the given colour and the trousers are a dark shade of it. The chest emblem is picked by the id: legal gets a courthouse, fin* a coin, eng a cog, anything else a star.
- **Overview readability.** The figure grows up to 2.3x when the camera is far away (15 m → 50 m), like an RTS unit. The follow camera and close-ups stay at true size (1.75 m). The nameplate is lifted 0.6 plate-heights above the head so it doesn't cover the figure from overhead.
- **No bloom on the UI.** Nameplate text is `#d9dce4` and the bubble is a darker cream, both kept under the bloom threshold (0.78). Pure white text bloomed into an unreadable blob.
- **Pixel font without font files.** Text is drawn at 10px Menlo, thresholded to 1-bit and magnified with `NearestFilter`. The nameplate is 2 CSS px per texel and the bubble 1.5.
- **The PointLight is gone.** Draw calls per human: 1 skinned mesh (the whole body, one atlas), 1 ring, 1 nameplate, 1 bubble (when shown), 1 trail, plus 1 book while reading and 1 burst while spawning.
- **Kept the floor trail**, now at floor height, for route readability. **Dropped the orb halo and dotted wait ring.** Waiting is now the pose, a pulsing ground ring and the bubble.
- **The demo wait never shows the folded-arms pose.** In `demo-1`, Finance's `wait` is cleared before its walk arrives, so it shows as walking with the "⌛ waiting on Eng" bubble. The pose is covered by the staged screenshot `staged-close-eng.jpg`.

## Verify
`bun run validate && bun run typecheck && bun run build` all pass. Headless Chrome (playwright-core, system
Chrome) screenshots are in `web/src/agents/human/wip/`: overview while walking and reading, a staged overview
(asking, waiting, reading), close-ups of each pose, a mid-stride walk of the runtime-spawned `quest-1`, and the
spawn burst.
