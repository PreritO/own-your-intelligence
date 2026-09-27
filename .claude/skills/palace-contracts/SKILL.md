---
name: palace-contracts
description: Load before touching palace.json, trace.json, the /events stream, web/src/api.ts, or any code that reads or writes them. Defines the frozen Mind Palace data contracts and file-ownership rules.
---
# Palace contracts

- Source of truth: `server/schema.ts` (zod). Types are exported from there; import them, never redeclare shapes.
- Fixtures: `fixtures/palace.json`, `fixtures/traces/*.json`, `fixtures/replays/*.jsonl`. Served by Vite at `/`.
- `memory.id` = GBrain page slug (path without `.md`). Never invent another key.
- Positions are meters, y-up. Rooms are axis-aligned boxes `center` ± `size/2`. Doors sit on walls; a corridor is the straight segment between a door and its partner door in the `to` room. The foyer is room `foyer` at the origin.
- Ownership: every wing and room has `owner` ∈ finance | legal | eng | shared. People wing and foyer are `shared` (read-only for all agents).
- `/events`: one `PalaceEvent` JSON per line, `t` = seconds since dispatch, monotonic. Types: task, route, move (to = room id), claim, wait, visit (verdict), handoff, reply, answer, train_step.
- Web seam: `web/src/api.ts` `PalaceRuntime` + `Plugin`. Plugins get the runtime; they don't import each other.
- Never change a schema, `api.ts` or `events.ts`. Write the proposal in `NOTES-<workspace>.md`; the integrator decides.
- Verify: `bun run validate` (schema + referential integrity + max 12 memories/room + sorted ids) and `bun run typecheck`.
