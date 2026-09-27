You are one of seven parallel agents building **Mind Palace** at a hackathon, each in its own Superset workspace and git branch. An integrator merges your PR into `main`.

Before anything else:
1. Read `CLAUDE.md` (rules, ownership, commands) and the parts of `docs/SPEC.md` referenced below.
2. Load the `palace-contracts` skill and your workspace skill (named below).
3. Run `bun install && bun run validate && bun run typecheck` to confirm the baseline is green.

Hard rules: edit only the files in your Owns row of CLAUDE.md; never change `server/schema.ts`, `web/src/api.ts` or `web/src/events.ts` (write proposals in `docs/NOTES-<workspace>.md`); commit every 20-30 min naming the checkbox that passed; features freeze at 4:15 PM. Prefer a smaller thing that demos over a bigger thing that doesn't. Don't stop to ask questions — make the reasonable call, note it in your NOTES file, keep going.

When done: run your skill's Verify step, write `.claude/skills/<workspace>-lessons/SKILL.md`, push your branch and open a PR to `main` with `gh pr create` whose description lists the checked-off acceptance criteria and pastes the verification output.

---

# Workspace: qm-fork · skill: harness-adapters + loci-protocol · merge 5th (~3:20)

Own `qm/`, `server/bridge.ts`, `server/routes.ts`. Spec: "The QM fork: pushing the harness", "Components → 5a", "7. Learned routes".

1. **Read before coding**: QM (https://qm.ycombinator.com/) docs on plugins, tools, scopes → `docs/NOTES-qm-fork.md`. Fork/clone it into `qm/` (or a git submodule if it's large — note which).
2. **Gate 2:15**: stock QM running locally (or on Fly) with three agents scoped to Legal, Finance, Eng rooms. Write the status at the top of `docs/NOTES-qm-fork.md` and in a commit message the moment you know. If it's not going to make it, stop sinking time into QM infra and focus on bridge.ts + routes.ts (UFO becomes the harness).
3. `server/bridge.ts` (build this early, it's needed either way): Bun on :8788, `GET /events` SSE (CORS *), `POST /dispatch` starts the 3 demo tasks, proxies the protocol service's (:8790) event stream, saves each run as `fixtures/replays/run-<ts>.jsonl`. Until the protocol service lands, `POST /dispatch?replay=demo-1` streams the canned replay with real timing.
4. `server/routes.ts`: Memorable lookup → explore → fallback route; record successful paths to Memorable or `fixtures/learned-routes.json`.
5. In the fork: tools `visit/claim/handoff/reply/answer` as thin adapters to :8790; handoffs threaded in Slack; grounding check before any answer posts (blocked live); palace replay link on answers.

Done when `curl -N localhost:8788/events` shows a full run and the saved replay passes `bun run validate`.
