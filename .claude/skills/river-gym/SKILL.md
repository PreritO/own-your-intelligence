---
name: river-gym
description: Load when working on River AI training (server/train - trajectories, SFT, RL env, eval) or the special rooms in web/src/rooms (Gym, Workshop, Loose Ends) in Mind Palace.
---
# River Gym + special rooms

- **First:** check which base models the River key can use (Models and access page) and pick the smallest capable one (RL guide uses `Qwen/Qwen3.5-9B`). Start a real job by 2:30; if it isn't finished by 4:15, show dataset + live metrics + eval harness.
- Python via `uv` in `server/train/` (`pip install river-client`). Key from `.env`, never committed.
- `trajectories.py`: replays + ~300 synthetic tasks/team from the seed brain → per-team JSONL with `domain`; 30 held-out tasks/team.
- `sft.py`: one LoRA per team; `save_weights(..., mode="inference")`. `rl.py`: Legal first, from its SFT checkpoint; log `reward/mean`.
- `palace_env.py`: `rl.Env`; tools call the protocol service (:8790). Reward: +1 correct answer citing only verified stations; +0.5 correctly reported expected gap; -1 invented content at a gap; -0.25 per skipped station; -0.5 reading an unowned room without handoff.
- Progress → POST `train_step` events to the bridge so the Gym renders live.
- Rooms (`web/src/rooms/`, a `Plugin`): place special rooms outside the four wings (they're not in palace.json; pick fixed coordinates away from wing geometry and note them). Loose Ends: board of cards from every `gap`/`stale` visit, grouped by owning team, live. Workshop: learned routes (`fixtures/learned-routes.json`) as floor paths, width ∝ uses; hop + tool-call counter run 1 vs run 2. Gym: weight rack (checkpoints/team), treadmill lanes with ghost avatars from `train_step`, scoreboard.
- Verify: Loose Ends shows the SOC 2 gap after `/?demo`; `python -m server.train.eval --dry-run` prints the per-team table.
