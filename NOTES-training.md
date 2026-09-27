# NOTES: training workspace (server/train, web/src/rooms)

Branch `ws/training`. I ran as a Claude Code subagent in an isolated worktree, and no human was available, so I made the calls below myself.

## River
- The key showed up in `.env` (a symlink, gitignored) around 14:11. Before that, everything was built in dry-run mode. The key is never printed or committed; `common.load_dotenv()` only fills in `os.environ`.
- `python -m server.train.models`: healthy, 13 models enabled. **Picked `Qwen/Qwen3.5-9B`** as the smallest capable model; it is also the model the River RL guide uses.
- Real jobs:
  - **SFT Legal** `50692a37-0f22-4aa7-b1f6-903fbd180ffe:model:1`: 30 steps, LoRA rank 16, batch 16, lr 2e-4, completion-masked. Loss 134 → 9.5 (about 70 s/step). Saved as `river://6932ec36-6bda-43e0-b9a9-4f576919f06a/sampler_weights/sft-legal` (inference) and `.../weights/sft-legal-train` (training). Held-out check (6 tasks, thinking off): reward 0.458, 67% correct. **Serve with `chat_template_kwargs={"enable_thinking": False}`**: with thinking on, replies weren't parseable and scored -0.075.
  - **RL via `rl.AsyncTrainer`** (the documented recipe, multi-turn PalaceEnv): 3 runs (`55e66b34…`, `7c0916a3…`, `558dd019…`) all died on the first `optim_step` with `RiverError: internal_error: Backend error: River team is investigating`. The same error came back from a primitives loop with `loss_fn="cispo"` + `gradient_scale`. Plain `optim_step` after cross-entropy (SFT) worked all along.
  - **RL Legal, `rl.py --simple`** `9a6b6518-633f-4ed9-8128-030a23407690:model:1`: GRPO on River primitives from the SFT checkpoint. The single-turn plan policy is executed through PalaceWorld and scored with the Gym reward; loss `importance_sampling`, advantages pre-scaled by 1/tokens, plain `optim_step`. **This one trains**: see `out/rl-legal-simple.log` / `.jsonl` for `reward/mean` per step.
- `rl.py` (AsyncTrainer path) now resumes from its checkpoint dir on `RiverError` (up to 4 attempts) and never passes `init_checkpoint` together with a resume (River rejects that).
- The RL env uses the local `PalaceWorld` by default. `--protocol` routes tool calls through :8790, but 64 concurrent rollouts would flood the palace's `/events`, so it is opt-in.
- Frontier planner column in `eval.py`: not wired, because this workspace has no frontier key. `eval.py` scores base + every checkpoint in `out/checkpoints.json` + scripted baselines.

## Decisions
- **One reward for everything.** `palace_env.score_episode` implements the SPEC Gym reward. SFT targets, the RL env, `eval.py` and the dry-run all score through it. Sanity check: the oracle policy and the SFT target plans hit the ceiling exactly on held-out tasks.
- **Ground-truth verdicts** come from observed replay visits first, then seed `expectedGaps`, then freshness (`< 0.12` gap, `< 0.3` stale, per the integrator's note). Stations in rooms the team doesn't own become expected handoffs (People/Foyer are shared).
- **Datasets**: replays + seed `synthetic-tasks.jsonl` (50/team) + generated (routes, learned routes, sub-routes, single/linked lookups, cross-team handoffs) → 300/team with **30 held-out/team**. Held-out rows are drawn only from generated rows, stratified by source; real runs always train. `data/` and `out/` are gitignored; regenerate them with `python -m server.train.trajectories`.
- **Dry-run RL is real RL on a tiny policy**: a 4-behaviour Bernoulli policy (visit / handoff / report gap / invent) trained with group-centred policy gradients (8×8 rollouts/step) through the same tools and reward. `reward/mean` genuinely climbs (0.61 → about 1.0, held-out 0.23 → 1.11 on the seed palace). The Gym labels it "dry-run (local sim)".
- **Room placement**: contents go into palace.json's commons rooms `room-loose-ends` / `room-workshop` / `room-gym` (server/layout.ts COMMONS), read at runtime; the scene draws their floors, walls, doors and labels. On an older palace without them, the same fixed slots (±24, ±24) get their own floor/walls. Boards are 8 m wide lecterns tilted 0.95 rad so they read from the overview camera, and they stay inside the 14 m room. No PointLights.
- **HUD**: one collapsible "Rooms" panel (Loose Ends count, fly-to, ▶ replay run 1/2). It is **opt-in with `?rooms`** now that the rooms are walkable (it is on automatically for old palaces). `?room=gym|workshop|loose-ends` flies there on load; `window.rooms.go(id)` too.
- **Gym for any agent**: rows are keyed by team for specialists and by agent for commissioned agents (`quest-N`, `team` optional). Colour and label come from the agent's `spawn` event. Ghosts wear the trainee's colour (the best 3 glow green), a rack gets a plate per distinct checkpoint, and the scoreboard shows the active quest row above the three teams. The subtitle reads "local RL sim" when checkpoints are `sim-*` / dry-run.
- **Quest CLI**: `python -m server.train.quest --task "<text>" --agent quest-1 --steps 12 [--seconds 10] [--river]`. It matches the task to the palace tasks with the most keyword overlap (majority team), then trains the 4-behaviour policy with group-centred PG (8 groups × 8 attempts/step) through PalaceWorld + the Gym reward. It prints one `train_step` per line on stdout (no `team` by default; `--team` adds it), paced over ~10 s, with checkpoints `sim-step-N`. Diagnostics go to stderr. `--river` launches `rl.py --simple` in the background for the matched team and reports `{river: job, model_id, log}` on stderr. Note that `bun run validate` rejects replays whose agent has no `spawn`/palace entry, so a saved quest replay needs its spawn line.
- **Loose Ends**: cards are keyed by memoryId and grouped by the memory's *owning* team. A later `verified` visit to the same station marks the card CLOSED (the Tier 2 write-back loop), and it drops off after 6 s.
- **Workshop**: floor ribbons between station orbs (`rt.memoryPosition`), width ∝ `uses`, colour = team of the first owned station. The dot runs along each path, and a `route` event with `source: "learned"` pulses its path. The counter compares the **previous vs latest run of the same task** (hops = visits, tool calls = claim/visit/handoff/reply/answer/wait). The "▶ run 1 / ▶ run 2" HUD buttons appear only if `contract-run1/2.jsonl` exist.
- **Gym**: pure function of `train_step`. Plates = distinct `checkpoint` values per team, and the scoreboard shows step / reward / PR (best) / sparkline. The 8 treadmill ghosts spread deterministically around the step's mean reward (display only, not per-rollout data), and the top 3 glow green. In `?demo` it also plays `/replays/gym-legal.jsonl` if present (`?gym=<name>` for another file).

## Integrator to-dos / proposals
1. **Bridge ingest (qm-fork / integrator)**: the bridge has no way to accept `train_step` from a separate process. `StepLogger` already POSTs each event to `POST :8788/events` (JSON PalaceEvent). A ~6-line addition to `server/bridge.ts` would make the Gym live:
   ```ts
   case "/events":
     if (req.method === "POST") {
       const e = PalaceEvent.safeParse(await req.json().catch(() => null));
       if (!e.success) return json({ error: "bad event" }, 400);
       broadcast(e.data); // whatever the SSE fan-out function is called
       return json({ ok: true });
     }
     return eventsResponse(url);
   ```
   Until then: `cp server/train/out/rl-legal-simple.jsonl fixtures/replays/gym-legal.jsonl`. After that, `/?demo` plays it in the Gym, and `curl -XPOST 'localhost:8788/dispatch?replay=gym-legal'` streams it live.
2. **Demo fixture**: copy the real RL log `out/rl-legal-simple.jsonl` (or `out/rl-legal-dryrun.jsonl`) to `fixtures/replays/gym-legal.jsonl` (seed/integrator own `fixtures/`).
3. **`controls.release()` contract**: the Phase 0 OrbitControls kept re-aiming the camera after `release()`. `flyTo` (rooms/layout.ts) now re-applies its pose in a chained `scene.onBeforeRender`, so it works with any scene. Suggest documenting in `api.ts` that `release()` means "the scene stops writing the camera".
4. **Commission backend**: pipe `python -m server.train.quest ...` stdout lines straight into the bridge as PalaceEvents (they are schema-valid `train_step`s). Emit the quest agent's `spawn` first so the Gym picks up its colour.
5. **Checkpoint switch**: `out/checkpoints.json` holds `sft-legal.inference_path`. The orchestrator can serve it via `client.chat_complete_from_checkpoint(messages, checkpoint_path=...)` (not built here; out of scope for `server/train`).
6. Dependency: nothing for `package.json`. Python deps live in `server/train/pyproject.toml` (`uv sync --project server/train --extra river`).

## Commands
```
uv run --project server/train python -m server.train.trajectories
uv run --project server/train python -m server.train.eval --dry-run
uv run --project server/train python -m server.train.rl --dry-run [--pace 1.5]
uv run --project server/train python -m server.train.quest --task "Who owns the SOC 2 renewal?" --agent quest-1 --steps 12
uv sync --project server/train --extra river
uv run --project server/train --extra river python -m server.train.models
uv run --project server/train --extra river python -m server.train.check_env
uv run --project server/train --extra river python -m server.train.sft --team legal
uv run --project server/train --extra river python -m server.train.rl --team legal --simple   # primitives GRPO (works)
uv run --project server/train --extra river python -m server.train.rl --team legal            # AsyncTrainer (River backend error today)
uv run --project server/train --extra river python -m server.train.eval --limit 10
```
