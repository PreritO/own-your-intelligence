You are one of seven parallel agents building **Mind Palace** at a hackathon, each in its own Superset workspace and git branch. An integrator merges your PR into `main`.

Before anything else:
1. Read `CLAUDE.md` (rules, ownership, commands) and the parts of `docs/SPEC.md` referenced below.
2. Load the `palace-contracts` skill and your workspace skill (named below).
3. Run `bun install && bun run validate && bun run typecheck` to confirm the baseline is green.

Hard rules: edit only the files in your Owns row of CLAUDE.md; never change `server/schema.ts`, `web/src/api.ts` or `web/src/events.ts` (write proposals in `docs/NOTES-<workspace>.md`); commit every 20-30 min naming the checkbox that passed; features freeze at 4:15 PM. Prefer a smaller thing that demos over a bigger thing that doesn't. Don't stop to ask questions — make the reasonable call, note it in your NOTES file, keep going.

When done: run your skill's Verify step, write `.claude/skills/<workspace>-lessons/SKILL.md`, push your branch and open a PR to `main` with `gh pr create` whose description lists the checked-off acceptance criteria and pastes the verification output.

---

# Workspace: presence · skill: agent-presence + retrieval-walk · merge 6th (~3:45)

Own `web/src/agents/`, `web/src/walk.ts`, `web/src/ui/`, `web/src/nav.ts`. Spec: "Components → 5. Retrieval walk" and "5b. Presence layer", "Demo script" steps 4-8. **This is the demo's hero feature.**

The scene workspace is replacing the Phase 0 placeholder scene in parallel; you build against the `PalaceRuntime` interface in `web/src/api.ts` only, so it works with either. Plugins are already registered in `web/src/plugins.ts` (`mountUI`, `mountWalk`, `mountPresence`).

1. `nav.ts`: `pathBetween(palace, fromPos, toRoomOrMemory)` → waypoints through doors (BFS over the room/door graph), never through walls.
2. Presence (`agents/`): avatars, station states, handoff beams, wait markers, camera modes (1-3 follow, 0 overhead), `T` dispatch — driven only by `rt.events`.
3. UI (`ui/`): memory side panel on `UI_EVENTS.select` (title, excerpt, linked memories → `flyTo`), live event feed in plain words, answer cards with cited stations, gaps in amber.
4. Walk (`walk.ts`): ask bar on `/`, trace cinematic per the retrieval-walk skill.

Verify in a real browser: `/?demo` shows the full 90-second demo beats (fan-out, handoff beam Legal→Finance, Finance waiting on Eng's claim, amber gap at `eng/soc2-owner`, three answers) and the same end state at `&speed=3`. Record a short GIF/screenshot for the PR.
