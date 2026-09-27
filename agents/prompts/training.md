You are one of seven parallel agents building **Mind Palace** at a hackathon, each in its own Superset workspace and git branch. An integrator merges your PR into `main`.

Before anything else:
1. Read `CLAUDE.md` (rules, ownership, commands) and the parts of `docs/SPEC.md` referenced below.
2. Load the `palace-contracts` skill and your workspace skill (named below).
3. Run `bun install && bun run validate && bun run typecheck` to confirm the baseline is green.

Hard rules: edit only the files in your Owns row of CLAUDE.md; never change `server/schema.ts`, `web/src/api.ts` or `web/src/events.ts` (write proposals in `NOTES-<workspace>.md`); commit every 20-30 min naming the checkbox that passed; features freeze at 4:15 PM. Prefer a smaller thing that demos over a bigger thing that doesn't. Don't stop to ask questions — make the reasonable call, note it in your NOTES file, keep going.

When done: run your skill's Verify step, write `.claude/skills/<workspace>-lessons/SKILL.md`, push your branch and open a PR to `main` with `gh pr create` whose description lists the checked-off acceptance criteria and pastes the verification output.

---

# Workspace: training · skill: river-gym · merge 7th (~4:00)

Own `server/train/` and `web/src/rooms/`. Spec: "The Gym (River AI)", "Components → 7 and 8", "Special rooms".

1. **First:** River key from `.env` (`RIVER_API_KEY`; if missing, write that in `NOTES-training.md` and build everything in dry-run mode). Check available base models; pick the smallest capable one.
2. `trajectories.py` from `fixtures/replays/*.jsonl` + `fixtures/synthetic-tasks.jsonl` (seed provides ~50/team; expand to ~300/team programmatically from `fixtures/palace.json` routes). 30 held-out/team.
3. `sft.py` per team; start a real job by **2:30**. Then `palace_env.py` + `rl.py` for Legal. `eval.py` scoreboard. POST progress as `train_step` events to the bridge (:8788) when it's up.
4. `web/src/rooms/` (a `Plugin` via `mountRooms`): **Loose Ends first** (Tier 1: cards from gap/stale visits, grouped by team, live from `rt.events`), then **Workshop** (Tier 1: learned-route floor paths + run 1 vs run 2 hop counter), then the **Gym** (weight rack, treadmill ghosts from `train_step`, scoreboard). Place rooms at fixed coordinates clear of the wings (e.g. diagonals at ±24, ±24) and note them.

Done when `/?demo` shows the SOC 2 gap card on the Loose Ends board and a River job (or dry-run) is logging reward.
