# NOTES ui-v2

Decisions made without a human (15:15-15:45):
- Quest board: 6 cards from `/quests.json` (array or `{quests: [...]}`), with a built-in fallback list in `web/src/ui/questBoard.ts` until seed-v2 lands the file. Card ids match `fixtures/replays/quest-<id>.jsonl`.
- Commission sends `{questId, task}` to `POST :8788/commission` (a typed task sends `{task}` only). Under `?demo` or with the bridge down, it plays `quest-<id>`, falling back to `quest-onboarding`.
- Hero copy moved into the top of the quest log (left). The quest board is the top-centre panel.
- `MAX_ROOMS` in scene/world.ts went from 16 to 32: with 16 rooms, the last room shared the "outdoors" dim slot.
- `HUD_INSETS.top` is now 380 so the overview frames the palace below the taller quest board.
- Gym racks and scoreboard, and the Loose Ends columns, read departments from palace.json (`departments()` in rooms/layout.ts). The scoreboard shows at most 4 rows (trained teams first). Loose Ends shows 3-5 columns.
- Flow view already took department colours from the palace wings, so nothing changed there.

Not done (cut at the stop call): collapsing the quest board while a quest runs; a single row of 6 cards on narrow screens.

Verify (1600x900, headless Chrome): overview 60 fps / 109 calls / 44.9k tris; quest mid-run 58 fps / 94 calls; late 60 fps / 142 calls. No page errors.
