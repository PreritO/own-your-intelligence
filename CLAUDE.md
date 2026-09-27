# Mind Palace — read this first

Full spec: `docs/SPEC.md`. This file is the condensed version every agent must follow.

Mind Palace renders Acme Robotics' company brain (GBrain) as a walkable three.js memory palace and shows
three team agents (Legal, Finance, Eng) walking it at once using the **loci protocol**: routes as
checklists, loud gaps, ownership by room, claims before work, answers only from verified stations.

**Time box:** features freeze 4:15 PM, demo-ready by 4:30. If it isn't in the 90-second demo script
(`docs/SPEC.md` → Demo script), don't build it.

## Stack and commands
TypeScript + Vite + three.js + Bun for web and server; Python (uv) for `server/protocol/`, `server/train/`, `ufo_ext_mindpalace/`.

| Command | What |
| --- | --- |
| `bun install` | deps |
| `bun run dev` | Vite on :5173, serves `fixtures/` as static (`/palace.json`, `/replays/demo-1.jsonl`) |
| `open http://localhost:5173/?demo` | replays `fixtures/replays/demo-1.jsonl` (`?demo=name&speed=3`) |
| `bun run validate` | zod + referential checks on all fixtures (`server/schema.ts`) |
| `bun run typecheck` | tsc |
| `bun run fixtures` | regenerate the Phase 0 fixture palace (seed agent may replace) |

Ports: web 5173 · ask 8787 · bridge `/events` 8788 · protocol service 8790 (`PORTS` in `server/schema.ts`).

## Contracts (frozen)
- `server/schema.ts` is the single source of truth for `palace.json`, `trace.json` and the `/events` line format.
- `memory.id` = GBrain page slug. Nothing else is a key.
- Positions in meters, y-up; rooms are axis-aligned boxes; doors are gaps in walls, corridors join door pairs.
- Event types: `task route move claim wait visit handoff reply answer train_step spawn phase artifact`.
- **Commissioned quests (main demo flow, 14:45):** the user types a task → a new agent `spawn`s → `phase` plan/explore (tours departments, handoffs to team agents) → gym (`train_step`) → execute (learned route) → `artifact` (new page) → done (`answer`). Commons rooms `room-gym`, `room-workshop`, `room-loose-ends` are real rooms in palace.json.
- `web/src/api.ts` (`PalaceRuntime`, `Plugin`, `UI_EVENTS`) is the seam between web workspaces.
  Scene builds the runtime; ui/walk/presence/rooms are plugins registered in `web/src/plugins.ts`.
- Never change a schema or `api.ts`. Propose changes in `NOTES-<workspace>.md` and ping the integrator.

## Workspace ownership (Superset swarm)
| Workspace | Owns (only edits these) |
| --- | --- |
| `seed` | `fixtures/` (+ `scripts/make-fixtures.ts`) |
| `export` (done) | `server/ask.ts` |
| `ufo-ext` (done) | `ufo_ext_mindpalace/` |
| `commission` (was qm-fork, ufo-ext) | `qm/`, `server/bridge.ts`, `server/routes.ts`, `server/protocol/`, `server/commission/` |
| `ui` (was presence/polish) | `web/src/main.ts`, `web/src/controls.ts`, `web/src/agents/` (not avatar.ts), `web/src/walk.ts`, `web/src/ui/`, `web/src/nav.ts`, `web/index.html` |
| `humans` | `web/src/agents/avatar.ts`, `web/src/agents/human/` |
| `voxel` | `web/src/scene/` |
| `training` | `server/train/`, `web/src/rooms/` |
| integrator | `server/layout.ts`, `server/export.ts`, `CLAUDE.md`, `docs/`, `server/schema.ts`, `server/validate.ts`, `web/src/api.ts`, `web/src/events.ts`, `web/src/plugins.ts`, `package.json`, `.claude/` |

Everyone may create `NOTES-<workspace>.md` and `.claude/skills/<workspace>-lessons/SKILL.md`.
Need a dependency? Add it in your notes file; the integrator adds it to `package.json`.

## Rules
1. Never edit files outside your Owns row. Need a change elsewhere? Write it in `NOTES-<workspace>.md` and move on.
2. Work against fixtures, not live services, until your merge slot.
3. Commit every 20–30 min; the message names the checkbox that passed (e.g. `scene: [x] pointer-lock WASD + collision`).
4. Load your workspace's skill plus `palace-contracts` before writing code.
5. Before opening your PR: `bun run validate && bun run typecheck`, run your skill's Verify step, paste output in the PR description with the checked-off acceptance criteria from the spec.
6. Last step: write `.claude/skills/<workspace>-lessons/SKILL.md` — what broke, what you'd do differently.
7. Demo runs on the seeded fake company only. No real people's names, never a personal brain.

## Merge order (integrator)
seed ~2:00 → export ~2:45 → scene ~3:00 → ufo-ext ~3:10 → qm-fork ~3:20 → presence ~3:45 → training ~4:00 → polish.
Gates: QM running by 2:15 else UFO is the harness. 3:00: a canned trace must replay on the fixture palace, else everyone pairs on walk/presence.
Cut order when behind: Slack links → archive/onboarding/memorize → RL + live checkpoint switch → minimap/overhead/dust/beam fade → live agents (use `?demo`) → third agent.
Never cut: team wings, clickable memories, agents walking routes, one handoff, one gap.
