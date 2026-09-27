---
name: training-lessons
description: Lessons from the training workspace (server/train River Gym + web/src/rooms Loose Ends, Workshop, Gym). Load before changing the Gym reward, datasets, River jobs or the special rooms in Mind Palace.
---
# Training workspace lessons

- **One reward, one world.** `server/train/palace_env.py` (`PalaceWorld` + `score_episode`) is shared by the SFT targets, the River `rl.Env`, eval and the dry-run. Change the reward only there. Check it with the ceiling test: `eval --dry-run` should show `oracle-route` reward == `/max` and 100% correct/compliant, and `sft --dry-run` target plans should hit the same ceiling.
- **River facts that mattered** (river-client 0.12): `client.get_capabilities()` is the source of truth for models. `@rl.tool` works on closures, so bind per-trajectory state by creating tools in `Env.__init__` and passing `env=lambda: PalaceEnv()`. `rl.Env` has no `__init__` to call. `Checkpointing(run_dir)` must be a local path. Use `chat_complete_from_checkpoint` for eval (no tokenizer needed).
- **Qwen3.5-9B SFT is about 70 s/step** at batch 16 × ~400 tokens, so budget 35 min for 30 steps. Start RL from base in parallel as a safety net rather than waiting on SFT.
- **River RL gotchas (2026-09-27):** `rl.AsyncTrainer` and primitives with `loss_fn="cispo"` + `gradient_scale` died on the first `optim_step` with `internal_error: Backend error`. What trained: `forward_backward(loss_fn="importance_sampling")` with advantages pre-divided by the token count, then a plain `optim_step(lr, grad_clip_norm)` (`rl.py --simple`). Test one real optimizer step within minutes of getting a key, not after SFT. `init_checkpoint` + automatic resume is rejected, so only init a fresh run dir.
- **Qwen3.5 thinking**: render SFT prompts with `enable_thinking=False` and serve with `chat_template_kwargs={"enable_thinking": False}` and `get_renderer(base, thinking=False)`, or replies burn the token budget and don't parse.
- **Keep RL off the live protocol service.** 64 concurrent rollouts through :8790 would spam `/events`; `--protocol` is opt-in.
- **Python hash() is salted per process**, so never use it for deterministic data splits (it bit trajectories.py once).
- **Vite serves index.html (200) for missing fixtures.** Fetch optional fixtures with `fetchJsonOptional` / `fetchTextOptional` (they reject HTML bodies).
- **Camera cinematics:** a scene's controls may keep re-aiming the camera after `release()`. `flyTo` re-applies its pose in a chained `scene.onBeforeRender` so it wins with any scene implementation.
- **Workshop counter**: compare the *previous vs latest* run of the same task text, not the first vs last (demo-1's Legal run shares the contract task).
- **Worktree-isolated agents**: complex shell (heredocs, pipes with URLs) gets refused, so write files with the Write tool and keep browse/git commands to one simple call each.
- Verify: `/?demo&room=loose-ends` shows the SOC 2 gap card under Eng; `uv run --project server/train python -m server.train.eval --dry-run` prints the per-team table.
