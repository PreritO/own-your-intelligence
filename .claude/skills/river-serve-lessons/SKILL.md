---
name: river-serve-lessons
description: Lessons from the river-serve workspace - serving a River checkpoint as a department agent's handoff-reply model (server/train/serve.py on :8794), teamModel/teamComplete with Claude fallback (server/commission/models.ts), the 20-question Legal grounding bench and fixtures/gym-scoreboard.json. Load before changing which model backs a team agent, the reply prompt, or the specialist eval.
---

# river-serve lessons

**What broke / surprised**
- **The route-plan SFT checkpoint is a worse replier than base Qwen.** `sft-legal` was trained to emit plan JSON. Asked to answer a handoff, it pastes the page's lead paragraph verbatim with no quote marks, so it scores ~20-25% grounded against base Qwen3.5-9B's 90%. A specialist is only as good as the task it was fine-tuned on. Train on the serving format (reply-format SFT: `serve.py sft`).
- **The prompt's format example leaked into answers.** An example built from Gripworks facts showed up word for word in Gripworks replies. Keep the example about a page that doesn't exist.
- **Meta sentences quoting outside words.** Claude wrote `This page is stale and "needs a refresh"`, and the strict scorer counted that as unsupported. A stale/silent note is a protocol note (`gap`), not a page claim.
- **A worktree-isolated agent can't run shell commands containing the word `eval`** (or `$var` in sed, loops over files, or `cd && git`). The subcommand is `bench`, and git runs as plain single commands.
- River latency from a laptop: checkpoint ~2.2 s p50, base ~1.6 s, `claude-sonnet-5` ~1.3 s. The 8 s fallback timeout is rarely hit, but the first call after idle can take 4-5 s.

**What I'd do differently**
- Write the bench before wiring anything. The first run said the specialist loses, which changed the default (`RIVER_REQUIRE_GROUNDED=1`, so an ungrounded specialist reply falls back to Claude).
- Start the reply-format SFT data build (Claude-distilled, `ground()`-filtered) right away. It takes ~5 min of Claude calls before the ~35 min River job.

**Verify**
```
uv run --project server/train --extra river python -m server.train.serve bench --models river,claude,base --show -1
uv run --project server/train --extra river python -m server.train.serve          # :8794
RIVER_TEAMS=legal bun server/commission/models.ts legal                            # source: river
RIVER_TEAMS=legal RIVER_SERVE_URL=http://localhost:1 bun server/commission/models.ts legal   # falls back, labelled
bun run validate && bun run typecheck
```
