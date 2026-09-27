---
name: verify-lessons
description: Lessons from the verify workspace - LLM relevance judge on visits and claim-level grounding on answers (server/protocol/judge.py, loci.py assess/answer/grounding), recorded offline judge tests. Load before changing verdicts, grounding, judge prompts or tests/recorded.
---

# verify lessons

- **The model proposes and the code checks.** Every quote is validated as a verbatim span (after normalising `[[slug|Title]]`, `**`, smart quotes and whitespace). A bad quote downgrades the result, whichever model produced it.
- **The LLM can only tighten a verdict.** A rules gap is final. `silent` beats `stale`, and freshness still owns `stale`. This keeps the SOC 2 gap loud even if the model disagrees.
- **Call Claude outside `Protocol.lock`.** The station lease keeps other agents off that station while the judge runs.
- **Haiku is too literal by default.** It returned `partial` for "Net-45" on "payment terms" and `silent` for trackers. Stating that silent is loud and to pick partial when in doubt fixed most of it. Re-run `/tmp`-style calibration on seed pages whenever the prompt changes, and bump `PROMPT_VERSION`.
- **Tests:** keep pages inside the test file, so seed edits never invalidate `tests/recorded`. Re-record with `MP_JUDGE_TEST_MODE=record`. Check stability with `MP_JUDGE_TEST_CACHE=/tmp/x` over several runs before committing.
- **The repo `.env` is a symlink in worktrees.** `MP_JUDGE=rules` is forced by an autouse fixture, so tests never hit the network.
- **Next time:** ask commission to put the artifact's facts into the `/answer` text. Otherwise claim grounding only sees process narration.
