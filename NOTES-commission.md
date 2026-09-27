# NOTES: commission (commissioned quests)

## Status
- `POST :8788/commission {task}` runs a live quest and returns `{agent, run, label, task, harness, mode}`. `?replay=<name>` (default `quest-onboarding`) streams a canned fixture instead. With the protocol service down, it falls back to that replay.
- `POST :8788/events` ingests one PalaceEvent (for training's StepLogger). It is stamped with the active run's current `t`, because a far-ahead external `t` split the live quest run into ~90 files the first time.
- Fixtures (both pass `bun run validate`):
  - `fixtures/replays/quest-onboarding.jsonl`: protocol harness, 86 s, 84 events. Run 1 has 10 stations and 4 handoffs; run 2 has 3 stations. The answer cites 2 stations and states 4 stale ones.
  - `fixtures/replays/quest-onboarding-qm.jsonl`: run 2 was driven by a real QM agent. 123 s; run 1 has 12 stations, run 2 has 10.

## What is real and what is simulated
- **Real (Claude `claude-sonnet-5`):**
  - the planner (subtasks per department, plus 2-3 "maybe" stations);
  - the team agents' `reply` text (each reads only the one page it just verified through the protocol);
  - the post-run-1 reflection that judges which stations are useful and quotes the evidence;
  - the artifact writer.
- **Real (protocol service):** ownership refusals, handoffs, claims, verdicts, `answer` grounding, and `/grounding`. The final answer passed live every time.
- **Simulated: the Gym.** It is `server/commission/gym.ts`, a tiny REINFORCE on per-station Bernoulli keep-probabilities with 12 rollouts per step, and `checkpoint: "sim"`.
  - Station values come from run 1's verdicts and the Claude reflection.
  - The reward does climb, and the learned route is the stations with p >= 0.5.
  - `server/train/quest.py` wasn't on origin/main. `gymCli()` calls it automatically if it lands; it expects JSON lines with `step`/`reward` and optionally `probs` or `route`.
- **Team agents are not QM scopes here.** The orchestrator answers their handoffs with Claude on their behalf, because nothing wakes a team QM scope on a handoff (see NOTES-qm-fork "Handoff reply loop").

## QM (`?harness=qm`): run 2 works through QM
- `bun qm/qm-admin.ts quest-setup` creates QM project `quest` (`group:web-project-54d3f84c-…`) and MCP connector `quest-loci`, which points at a second adapter: `LOCI_MCP_PORT=8792 bun qm/loci-mcp.ts`. That adapter now also serves `/quest-<n>/mcp`.
- Per quest, `server/commission/qm.ts` re-points `quest-loci` at `/quest-<n>` and sends one portal turn with the learned route. QM's pi harness (claude-sonnet-5) called `quest-loci_claim`, `_visit` and `_handoff` for all 10 stations (quest-5). The orchestrator answered the handoffs for legal/eng.
- **Not done:**
  - Plan and explore stay on the protocol harness. The completion `answer` is posted by the orchestrator, not through QM.
  - QM visits carry no `subtask`/`evidence`; the service's best-snippet default fills in `evidence`.
- **Honest limit:** the connector id is `quest-loci`, not `loci-quest`, so the fork's scope-binding check doesn't apply to it. Binding it needs `LOCI_SCOPES` plus a QM restart, and I didn't restart QM processes I hadn't started.
- The spawn event says `harness: "qm"` only when QM is reachable. If the QM turn fails, run 2 falls back to the protocol walk; the spawn event still says qm, and the bridge log shows the failure.

## Protocol service additions (`server/protocol/`)
- New endpoints:
  - `/spawn`: a quest agent with no team, so it may enter only shared rooms and must hand off everywhere else. It survives palace reloads.
  - `/move`, `/phase` (with `subtasks`), `/artifact`, `/train_step`.
- `/visit` takes `subtask?` and `evidence?`. When evidence is absent, the service picks the page sentence that best answers `question` (wikilinks stripped); gaps carry no evidence.
- Tests: `tests/test_quest.py`. 21 pass.

## Calls I made
- The orchestrator is TypeScript (`server/commission/quest.ts`), imported lazily by the bridge. Every event goes through :8790, so there is one clock and one source, and the bridge just follows it.
- Each quest starts a fresh protocol run (`POST /run`). This moves the service's "current run", so a concurrent team `/dispatch` starts its own run afterwards.
- In run 2, team stations are re-asked through a handoff: the owner re-verifies the page this run and repeats its run-1 reply (no second Claude call).
- The answer's citations are the stations the artifact actually cited (`[[id]]`) ∩ the verified stations of the learned route, so the task-flow view can separate useful hops from wasted ones.
- The artifact is saved to `server/commission/quests/quest-<n>-<slug>.md` (gitignored). Its memory id is `quests/<slug>`, on a ring of radius 3.5 around the foyer at y 1.1.
- `fixtures/learned-routes.json` gets a `quest-<slug>` entry per live quest. That's the local change; it is not committed (the file is seed's).

## Integrator to-dos
- `package.json`: add `"quest": "bun server/commission/quest.ts"` and `"quest:mcp": "LOCI_MCP_PORT=8792 bun qm/loci-mcp.ts"`.
- `.gitignore`: consider adding `fixtures/learned-routes.json` (live quests rewrite it).
