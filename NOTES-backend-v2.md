# NOTES-backend-v2

Owner rows used: `server/commission/`, `server/protocol/`, `server/train/`, `server/bridge.ts`, plus
`fixtures/replays/quest-<id>.jsonl` (recorded quest fixtures, as asked by the integrator).

## Phase 1: no hard-coded team lists (8 departments)
- `server/commission/quest.ts`: department enum in the planner prompt = `palace.wings`; team labels from
  `palace.agents`; fallback planner groups pages by room wing (not slug prefix). New `QuestDef`,
  `loadQuests()` / `findQuest()` over `fixtures/quests.json` (array, or `{quests: [...]}`); `startQuest(task, hooks, quest)`
  passes the quest's `departments` to the planner ("cover each of them"). It does **not** pass `expectedGaps`:
  the planner is only told generically to include relevant stations even when they look incomplete.
- `server/commission/qm.ts`: team agents that answer handoffs = every `palace.agents` id.
- `server/protocol/loci.py`: `Protocol.teams()` (room owners + palace team agents); `train_step.team` accepts any
  of them. Ownership/handoff was already data-driven. `service.py`: `PROTOCOL_PORT` env (default 8790).
- `server/train/common.py`: `TEAMS` derived from palace.json (legal, finance, eng, sales, support, ops, marketing).
  `rl.py --team` choices = TEAMS; `eval`/`sft` default to teams that have a dataset (run
  `python -m server.train.trajectories` to build datasets for the new teams).
- Tests: `test_new_department_owns_its_room_and_answers_handoffs` (sales). 22 protocol tests pass.

## Bridge
- `POST /commission {questId}` (or `?quest=<id>`): the quest's prompt becomes the task; live when the protocol
  service is up. `{questId}` + `?replay` / `?replay=1` streams `fixtures/replays/quest-<id>.jsonl`;
  `?replay=quest-<id>` works directly. Protocol down + known quest -> its own recorded fixture, not quest-onboarding.
- `GET /quests`: quests.json + which have a recorded replay.
- `BRIDGE_PORT` / `PROTOCOL_URL` were already supported.

## Gym (honest labels)
- `server/commission/quest.ts` already called `python -m server.train.quest --stations ...`, but that CLI had no
  `--stations` flag, so it exited with an argparse error and every quest silently used the local sim.
  Fixed: `server/train/quest.py --stations` trains a per-station keep policy (same reward shape as
  `gym.ts`) next to its behaviour policy, and ends with a `{"probs": ...}` line. The train_step reward
  plotted is the behaviour policy's Gym reward on matched palace tasks (`score_world`); checkpoints are
  labelled `sim-step-N`. The gym phase note says "server.train.quest sim policy, not a River job".
  Nothing in a recorded quest is a River job.

## Recording (Phase 2)
- `bun server/commission/record.ts <questId...> | --all` runs each quest live (in-process, against
  `PROTOCOL_URL`) and cuts the fixture from `server/protocol/runs/<run>.jsonl`, rebased to t=0, `run = quest-<id>`.
  It refuses to write a fixture that lacks spawn / plan subtasks / explore / handoff / reply / gym / train_step /
  execute / learned route / artifact / unblocked answer / done.
- Ran my own services on alternate ports: protocol `PROTOCOL_PORT=8890`, bridge `BRIDGE_PORT=8888
  PROTOCOL_URL=http://localhost:8890`. Did not touch :8790/:8788.

## Calls I made (no human available)
- `fixtures/learned-routes.json` changes from recording are not committed (seed-owned, and the integrator's
  checkout has local edits to it); the replays are self-contained.

## Status at stop
- Integrator stopped the swarm before seed-v2 landed: Phase 2 (quest fixture recordings) was skipped. No `fixtures/replays/quest-<id>.jsonl` recorded.
- A smoke quest ("Prepare a vendor risk brief on Gripworks") ran live on :8890/:8888: plan (Claude), explore with 7 handoffs to legal/finance/eng answered by Claude team agents. It was stopped mid-run, so nothing was committed from it.
- To record later: start protocol + bridge on alternate ports, then `PROTOCOL_URL=http://localhost:8890 bun --env-file=<repo>/.env server/commission/record.ts security-questionnaire arm-controller-triage gripper-v2-launch`.
