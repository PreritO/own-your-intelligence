# NOTES-verify

Workspace `verify` owns `server/protocol/loci.py`, `server/protocol/judge.py` and `server/protocol/tests/`.
`service.py` needed no change: `/visit`, `/answer` and `/grounding` return the new fields as they are.

## What changed
- **Relevance judge** (`judge.py`, `claude-haiku-4-5-20251001`). A visit with a `question` asks whether the page answers it: `support: answers | partial | silent | contradicts`, plus `evidence` that must be a verbatim span of the page. `silent` becomes `gap` (note `page doesn't say: ...`), `contradicts` stays verified with a note, and freshness still decides `stale`. If the quote is not on the page, support is downgraded to `partial` and the rules verdict stands. Deadline 2.5 s, then the rules judge (`judge: "rules"`).
- **Claim-level grounding** (`claude-sonnet-5`, thinking disabled, 10 s deadline). `answer()` splits the text into claims and maps each one to a verbatim quote from a station this agent verified in the run, including pages inherited through a handoff reply. The answer event gets `claims`. Any `unsupported` claim sets `blocked: true` with `reasons: ['unsupported claim: "..." (why)']`. `/grounding` reuses that result, and re-checks the text when QM posts a message that differs from the answered one.
- **Tests**: `tests/test_verify.py` has 17 tests that replay recorded responses from `tests/recorded/`, fully offline. The 22 existing tests pass unchanged; they now pin the rules judge.

## Calls I made (no human available)
1. **The LLM can only make a verdict stricter.** A rules gap (empty page, blank owner field) is final and the LLM is not called. Stale still comes from freshness, and `silent` beats `stale`.
2. **No question means no LLM.** Relevance needs a question, so a bare `visit(memoryId)` stays on rules.
3. **Stdlib HTTP, not the `anthropic` SDK.** The protocol service is dependency-free by design, and `pyproject.toml` is not mine. Integrator: if you want the SDK, add `anthropic` to `server/protocol/pyproject.toml` and swap `http_transport`.
4. **The API key** comes from the env, else from the repo `.env` (`uv run` doesn't load it). It is never logged.
5. **Handoff claims quote the page the replier verified, not the reply's paraphrase.** The page is the truth; a reply could itself bluff.
6. **Gap claims must name a station the agent walked to** in this run (any verdict), or they count as `unsupported`.
7. **Process statements are not claims** ("wrote X", "run 1 took 13 stations", bare lists of ids).
8. **Caller `evidence` is kept only if it is verbatim on the page.** Otherwise it is replaced by the LLM quote or `best_snippet`.
9. **A missed deadline keeps the call running** in the background, and its result fills `.cache/`. `MP_JUDGE=auto|cache|record|rules`. `.cache/` writes its own `.gitignore`.
10. **Offline, grounding fails open.** With no key or a timeout, the answer falls back to citation-level grounding: `grounding: "citations"` in the HTTP result, and no `claims` on the event.
11. **Prompt calibration.** Haiku was too literal: it returned "partial" for Net-45 payment terms and "silent" for trackers. The prompt now says `silent` is loud and opens a human gap, so pick `partial` when in doubt. Across 4 live re-recordings, the 17 tests passed every time. Spot check on 15 seed pages: 2 remaining disagreements, where Sonnet agrees with Haiku that the pages are silent.

## End to end (protocol :8893, bridge :8897, QUEST_GYM=sim)
`POST :8897/commission {"questId":"security-questionnaire"}` → run `quest-1-2026-09-27T22-44-04-076`:
- Explore toured 13 stations. Every team visit was judged by the LLM, except the rules gaps (`sales/northwind-dpa-request` and `eng/soc2-owner`, "no owner recorded").
- `legal/nda-template` is now a **gap** ("page doesn't say: data processing agreement and privacy policy references"). Before, it was a fresh, off-topic page counted as usable.
- Most stations are `partial`, which is fine because they stay verified. `support/sla-policy` came back `answers`.
- Run 2 walked the learned route: 8 stations, down from 13. Final answer **not blocked**, `/grounding` ok, phase done at t=149.
- **Finding: the claim check missed its 10 s deadline on the quest answer.** The prompt carried 13 source pages, so the event fell back to citation-level grounding with no `claims`. The background call then finished and cached: **13 supported, 6 gap, 0 unsupported**.
- **Finding: Sonnet "extracted" facts from the source pages that aren't in the answer text** (SLA figures, deal value). The answer text is process narration plus gap lists. This is harmless for blocking, since they were all supported, but it is wrong.
- **TODO (verify, next):**
  - Send only cited and gap/stale pages, not every verdict.
  - Raise the answer deadline, or warm the check while the artifact is drafted.
  - Drop claims whose text shares no content words with the answer.

## Needed in server/commission (not mine) — for the owner
- **quest.ts final answer:** the `/answer` text is almost all process ("Done: wrote X from N verified stations: ..."). Claim-level grounding skips process statements, so the deliverable's facts are never checked. Put 3–6 key factual sentences from the artifact into the answer text (e.g. "Summary: <facts>"), so the claims on the page are grounded.
- **quest.ts teamReply prompt:** have the team agent answer only from the page and quote it ("Quote the sentence you rely on"). Then the requester's claims map to the same page text.
- **quest.ts visit questions:** "what does <Title> say that matters for <task>" makes the judge return `partial` everywhere. Pass the subtask title as the question ("Which SOC 2 report can we share?") for sharper `answers` / `silent`.
- **The re-cite path** (`answer blocked -> re-cite`) drops only citations. When `reasons` start with `unsupported claim:`, it should rewrite the text without those claims instead of re-citing.
