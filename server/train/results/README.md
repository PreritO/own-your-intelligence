# River training results (real runs)

Copied from the training and river-serve workspaces' gitignored `server/train/out/` so they survive worktree cleanup. Keys are never in these files.

- `training/`: SFT (`sft-legal.log`: loss 134 → 9.5), the RL attempts (`rl-legal*.log`: the AsyncTrainer runs that died on River's backend error, plus the `--simple` GRPO runs with per-step `reward/mean`), the local dry-run policy, `checkpoints.json` (river:// checkpoint paths) and `scoreboard.json`.
- `river-serve/`: the 20-question held-out Legal handoff bench (`serve-eval-*.json`, `ladder/bench-legal-*.json`: base / gen1 / Claude), the gen2 reply-format SFT data and log (`reply-sft-legal.*`, job `e2d0d761-454e-4992-a46a-94fedefc2078:model:1`), and `checkpoints.json`.

The leaderboard in the Gym reads the summarized versions in `fixtures/gym-scoreboard.json` and `fixtures/river-runs.json`.
