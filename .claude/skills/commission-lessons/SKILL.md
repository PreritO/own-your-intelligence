---
name: commission-lessons
description: Lessons from the commission workspace - live commissioned quests (POST :8788/commission), server/commission orchestrator, protocol spawn/phase/artifact endpoints, Gym sim, QM execute hook. Load before changing server/commission, the bridge's /commission or /events ingest, or quest fixtures.
---

# commission lessons

**What broke**
- **External `t` split runs.** Training's StepLogger POSTed `train_step` to `:8788/events` with its own clock (t=118 in a quest at t=37). The next protocol event looked "backwards", the bridge started a new run each time, and ~90 split `run-*.jsonl` files failed validate (no `spawn`). Fix: ingested events are stamped with the active run's `lastT`.
- **Record fixtures from the protocol log, not the bridge.** `server/protocol/runs/<run>.jsonl` is the clean, complete source; the bridge's saved runs can be split or superseded by other clients.
- **The Claude planner sometimes returns unusable JSON.** It went through the fallback once. Now it retries with 1600 max tokens and logs the reply head.
- **A QM portal turn** needs `threadRef: web:<principal>:...`, or it returns 403 "you can only start a new conversation on your own thread".
- **The bridge imports `server/commission/quest.ts` lazily, then caches it.** Restart the bridge after editing it.
- **Other agents share :8788/:8790.** Someone ran `/dispatch` against my service mid-session. Every quest call passes an explicit `run`, so it was unaffected.

**What I'd do differently**
- Pace from the start. Team replies run async (the owner answers while the quest walks on), and the writer drafts during the Gym. That took a quest from 138 s to about 85 s.
- The reflection prompt decides run 2's size. A "be strict" prompt dropped every team station, so run 2 had no handoffs. Ask for "useful when the deliverable should contain a fact from it" instead.

**Verify**
`uv run --project server/protocol python server/protocol/service.py` · `bun server/bridge.ts` · `curl -N localhost:8788/events` · `curl -XPOST localhost:8788/commission -d '{"task":"Create an onboarding page for new engineers"}'`. Expect spawn → phase plan (subtasks) → explore (refusals → handoff/reply) → gym (24 train_step) → execute (route learned) → artifact → answer (not blocked) → phase done. Then run `bun run validate`.
