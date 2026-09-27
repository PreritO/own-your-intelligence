# NOTES: training workspace (server/train, web/src/rooms)

Branch `ws/training`. I ran as a Claude Code subagent in an isolated worktree, and no human was available, so I made the calls below myself.

## River
- The key showed up in `.env` (a symlink, gitignored) around 14:11. Before that, everything was built in dry-run mode. The key is never printed or committed; `common.load_dotenv()` only fills in `os.environ`.
- `python -m server.train.models`: healthy, 13 models enabled. **Picked `Qwen/Qwen3.5-9B`** as the smallest capable model; it is also the model the River RL guide uses.
- Real jobs (IDs and results are in the PR description and the final report):
  - `sft.py --team legal --steps 30`: LoRA rank 16, batch 16, lr 2e-4, loss masked to the completion. It saves `mode="inference"` and `mode="training"` checkpoints to `server/train/out/checkpoints.json`.
  - `rl.py --team legal --from-base`: started in parallel as a safety net because SFT runs about 70 s/step. It also exercised the real RL path early.
  - `rl.py --team legal`: run after SFT; it starts from the `sft-legal` training checkpoint (`init_checkpoint`).
- The RL env uses the local `PalaceWorld` by default. `--protocol` routes tool calls through :8790, but 64 concurrent rollouts would flood the palace's `/events`, so it is opt-in.
- Frontier planner column in `eval.py`: not wired, because this workspace has no frontier key. `eval.py` scores base + every checkpoint in `out/checkpoints.json` + scripted baselines.

## Decisions
- **One reward for everything.** `palace_env.score_episode` implements the SPEC Gym reward. SFT targets, the RL env, `eval.py` and the dry-run all score through it. Sanity check: the oracle policy and the SFT target plans hit the ceiling exactly on held-out tasks.
- **Ground-truth verdicts** come from observed replay visits first, then seed `expectedGaps`, then freshness (`< 0.12` gap, `< 0.3` stale, per the integrator's note). Stations in rooms the team doesn't own become expected handoffs (People/Foyer are shared).
- **Datasets**: replays + seed `synthetic-tasks.jsonl` (50/team) + generated (routes, learned routes, sub-routes, single/linked lookups, cross-team handoffs) → 300/team with **30 held-out/team**. Held-out rows are drawn only from generated rows, stratified by source; real runs always train. `data/` and `out/` are gitignored; regenerate them with `python -m server.train.trajectories`.
- **Dry-run RL is real RL on a tiny policy**: a 4-behaviour Bernoulli policy (visit / handoff / report gap / invent) trained with group-centred policy gradients (8×8 rollouts/step) through the same tools and reward. `reward/mean` genuinely climbs (0.61 → about 1.0, held-out 0.23 → 1.11 on the seed palace). The Gym labels it "dry-run (local sim)".
- **Special room coordinates** (not in palace.json): Loose Ends (-24,0,-24), Workshop (24,0,-24), Gym (24,0,24), each 14×14 m. If an exported wing would overlap, a room is nudged outward along its diagonal. There are no corridors: the rooms are reached via the HUD switcher (camera fly-to, Esc returns) or `?room=loose-ends|workshop|gym`.
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
   Until then: `cp server/train/out/rl-legal.jsonl fixtures/replays/gym-legal.jsonl`. After that, `/?demo` plays it in the Gym, and `curl -XPOST 'localhost:8788/dispatch?replay=gym-legal'` streams it live.
2. **Demo fixture**: copy the real RL log (or `out/rl-legal-dryrun.jsonl`) to `fixtures/replays/gym-legal.jsonl` (seed/integrator own `fixtures/`).
3. **`controls.release()` contract**: the Phase 0 OrbitControls kept re-aiming the camera after `release()`. `flyTo` (rooms/layout.ts) now re-applies its pose in a chained `scene.onBeforeRender`, so it works with any scene. Suggest documenting in `api.ts` that `release()` means "the scene stops writing the camera".
4. **Checkpoint switch**: `out/checkpoints.json` holds `sft-legal.inference_path`. The orchestrator can serve it via `client.chat_complete_from_checkpoint(messages, checkpoint_path=...)` (not built here; out of scope for `server/train`).
5. Dependency: nothing for `package.json`. Python deps live in `server/train/pyproject.toml` (`uv sync --project server/train --extra river`).

## Commands
```
uv run --project server/train python -m server.train.trajectories
uv run --project server/train python -m server.train.eval --dry-run
uv run --project server/train python -m server.train.rl --dry-run [--pace 1.5]
uv sync --project server/train --extra river
uv run --project server/train --extra river python -m server.train.models
uv run --project server/train --extra river python -m server.train.check_env
uv run --project server/train --extra river python -m server.train.sft --team legal
uv run --project server/train --extra river python -m server.train.rl --team legal
uv run --project server/train --extra river python -m server.train.eval --limit 10
```
