# NOTES: river-serve (server/train/serve.py, server/commission/models.ts)

Branch `ws/river-serve`. I ran as a Claude Code subagent in an isolated worktree with no human available, so I made the calls below myself. Keys come from `.env` (a symlink, gitignored). They are never printed or committed.

## What's here
- **`server/train/serve.py`** serves a team's River checkpoint as that department agent's handoff-reply model.
  - `python -m server.train.serve` starts HTTP on **:8794** (`RIVER_SERVE_PORT`). `GET /health`. `POST /reply {team, question, pageId, title?, content?, verdict?, task?}` returns `{answer, grounded, claims, label, model, checkpoint, latency_ms}`. If `content` is missing, it reads the seed-brain page.
  - It calls `chat_complete_from_checkpoint(..., chat_template_kwargs={"enable_thinking": False})` with temperature 0 and max 220 tokens.
  - Strict prompt: answer only from the page. Every sentence carries a word-for-word quote in double quotes, with no outside facts. If the page is silent, the reply is "The page doesn't say." A stale page adds a refresh note. The format example is about a made-up page. An earlier example used Gripworks facts, and a model copied it into a reply, so I changed it.
  - `ground(reply, page)` does claim-level grounding in the shape of `answer.claims` in `server/schema.ts`. Each sentence is a claim. A claim is `supported` if every double-quoted span in it (2+ words, or containing a digit) appears verbatim in the page after normalisation (wiki links become titles, markdown is stripped, whitespace collapsed). A stale or silent protocol note counts as `gap`. Anything else is `unsupported`. A reply is `grounded` when it has at least one supported claim and no unsupported ones.
  - Checkpoint resolution order: `RIVER_CHECKPOINT_<TEAM>` (a river:// path), then `RIVER_CHECKPOINT_KEY_<TEAM>` (a key in `server/train/out/checkpoints.json`), then `out/checkpoints.json` `sft-<team>`, then the pinned default: the Legal SFT from NOTES-training.md, `river://6932ec36-6bda-43e0-b9a9-4f576919f06a/sampler_weights/sft-legal`. The default is pinned because `out/` is gitignored.
  - `ask` (one reply), `bench` (the eval) and `sft` (the optional reply-format SFT round) are subcommands of the same file, which keeps everything inside my ownership row.
- **`server/commission/models.ts`**
  - `teamModel(team)` returns `{kind: "river"|"claude", model, label, url?}`. River applies only to teams listed in `.env` `RIVER_TEAMS` (comma list, **default off**).
  - `teamAnswer(team, system, user, page)` returns `{text, source, label, latencyMs, grounded?, fallback?}`. It asks serve.py with an **8 s** timeout (`RIVER_TIMEOUT_MS`). It falls back to Claude (`claude(system, user, 220, 30000)`, the orchestrator's original prompts) on error, timeout, serve.py being down, or, when `RIVER_REQUIRE_GROUNDED=1` (the default), a specialist reply that fails the quote check.
  - `teamComplete(...)` is the drop-in for `claude(...)` in `teamReply`. It keeps the same null-on-failure contract and prefixes the text with its honest source: `[Legal specialist (River SFT, Qwen3.5-9B)] …`, `[Claude claude-sonnet-5] …`, or `[Claude claude-sonnet-5 · River fallback: timeout 8s] …`.
  - I checked every path live with `bun server/commission/models.ts legal`: River on, River off, serve.py down, a 50 ms timeout, and grounded-required.

## Integrator: the one-line orchestrator patch (server/commission/quest.ts, `teamReply`)
```diff
-  const text = await claude(system, user, 220, 30000);
+  const text = await (await import("./models")).teamComplete(team, system, user, { task, question, pageId, title, verdict, content });
```
Every argument is already in scope in `teamReply` as a string, so it type-checks. Then run it with `RIVER_TEAMS=legal` in `.env` (Bun loads it) and `uv run --project server/train --extra river python -m server.train.serve` next to the bridge. Restart the bridge afterwards, because it caches quest.ts. Gap pages never reach a model: `teamReply` returns its fixed gap sentence first.

## Schema proposal (integrator)
The `reply` event has no field for its source, so for now the label rides at the start of `answer`. Proposal: add `source: z.string().optional()` (e.g. `"river:sft-legal"` / `"claude:claude-sonnet-5"`) and `label: z.string().optional()` to the `reply` event, and forward them from `/reply` in `server/protocol/service.py`. The feed could then badge replies without parsing the prefix.

## Eval: 20 held-out Legal handoff questions
Same strict prompt for all, temperature 0, thinking off for Qwen. `grounded` = every claim carries a verbatim quote from the page. `correct` = the expected facts are present. p50 latency per reply.

| gen | model | n | grounded | correct | p50 ms | promoted | job |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | Base Qwen3.5-9B (River, no fine-tune) | 20 | **90%** | 100% | 1628 | yes (starting incumbent) | - |
| 1 | Legal route-plan SFT (River, Qwen3.5-9B) | 20 | **20%** | 95% | 2230 | **no: a regression** (grounded -0.70, correct -0.05) | `50692a37-0f22-4aa7-b1f6-903fbd180ffe:model:1` |
| 2 | Legal reply-format SFT (River, Qwen3.5-9B) | - | training | - | - | not benched yet | `e2d0d761-454e-4992-a46a-94fedefc2078:model:1` |
| ref | Claude claude-sonnet-5 | 20 | **100%** | 100% | 1332 | reference line | - |

**The specialist loses, and so far it's a regression.** Gen 1 was fine-tuned on route-plan JSON, not on quoted replies. Asked to answer a handoff, it pastes the page's lead paragraph verbatim with no quote marks: 90-95% "extractive", but 20% grounded. It is also slower (2.2 s vs 1.6 s). Base Qwen with the same prompt quotes properly (90%). Claude is best and fastest from here.

Gen 2 is the fix. It is a reply-format SFT on 106 Claude replies that passed claim-level grounding: 11 from `fixtures/replays` (security-questionnaire, onboarding and contract runs), the rest from other departments' pages. None of the 20 held-out questions is in it, and no generic row uses a Legal page. The replayed handoffs do touch Legal pages, with different questions. It started on River at the wrap-up deadline, so it has no numbers yet. To bench it when it finishes:
```
uv run --project server/train --extra river python -m server.train.serve bench --models river:sft-legal-reply,base,claude
```
The **promotion gate** (`flywheel.py board`) promotes a generation only if it beats the incumbent's held-out grounded while losing at most 2 points of correct. So gen 1 is rejected, and `RIVER_REQUIRE_GROUNDED=1` in models.ts sends the specialist's ungrounded replies back to Claude.

## Ladder (flywheel.py): built, not yet run end to end
`server/train/flywheel.py` holds the per-agent ladder: `questions` (Claude-written handoff questions per page, with facts checked against the page; Eng/Sales hold out whole pages), `distill` (grounded replies only), `sft --gen N`, `rl --gen 3 --init 2` (GRPO on the `rl.py --simple` recipe, reward = the grounding judge: +0.5 x supported share, -1 x unsupported share, +0.5 for correct facts, -1 for content where the page is silent, +0.5 for a stated gap, -0.5 for a false gap), `bench`, and `board` (writes `fixtures/gym-scoreboard.json` with `{team, key, generation, model, jobId, checkpoint, trainedOn, n, grounded, correct, latency_ms, promoted, note, status}`). Not yet run: the Eng/Sales question generation, their gen 1 jobs, and Legal gen 3 RL. The wrap-up deadline came first.

## Calls I made
- **Grounding scorer.** `server/protocol/judge.py` (the verify workspace's claim-level judge) doesn't exist in any worktree yet, and the protocol's `answer`/`grounding` checks citations rather than quotes. So serve.py has its own rules-based claim check, following the `answer.claims` contract. It is strict: a claim needs literal quote marks. Verbatim copying without quote marks is reported separately as "extractive" and doesn't count as grounded.
- **Eval set.** 20 questions I wrote over all 16 Legal seed pages, each with expected facts (every group must match, any alternative). None of them appears in any SFT dataset. Before the final runs I rephrased one ambiguous question ("What is noted…" became "When did Legal approve the Harbor Cloud DPA, and what is attached?") because its expected date wasn't really asked for. Stale pages (freshness < 0.3, the same rule as `loci.judge`) get the stale instruction. That instruction isn't scored.
- **Same prompt for every model**, temperature 0, thinking off for both Qwen variants. `claude-sonnet-5` is the orchestrator's `COMMISSION_MODEL`. p50 latency is measured from this laptop and includes network time.
- **Fallback when ungrounded is on by default**, because the served specialist quotes badly (see the table). Set `RIVER_REQUIRE_GROUNDED=0` to show raw specialist replies anyway.
- Port **8794**, because 8792 is `quest:mcp`.
