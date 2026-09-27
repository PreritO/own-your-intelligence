---
name: ufo-ext-lessons
description: Lessons from the ufo-ext workspace - the loci protocol service (server/protocol, :8790), demo_run.py, and the UFO extension ufo_ext_mindpalace. Load before changing protocol rules, the scripted driver, or anything that runs agents in UFO.
---
# ufo-ext lessons

- **Protocol rules live in `server/protocol/loci.py`.** `service.py` is only HTTP, and adapters (QM, UFO) are only translation. Test rules against `Protocol` with `SimClock`, and test HTTP with `serve_in_thread`.
- **Verdict heuristics must be checked against the real seed brain.** A length-capped "silent page" check missed the seed's long `eng/soc2-owner` page ("Owner: not recorded"), which came out stale instead of gap. The fix: a key-field pattern plus a lead-paragraph check. Re-run `judge` over every `fixtures/seed-brain` page whenever the brain changes; only `eng/soc2-owner` should be a gap.
- **Routes change under you.** Seed changed `board-promises`, and the demo lost its claim wait. `demo_run.py` now adds one honest explore hop. Assert the event mix (handoff, wait, gap, 3 answers) in tests, not exact lines.
- **Run ids need to be unique.** Two `/dispatch` calls in the same second collided and reset a run.
- **UFO:**
  - Install the extension with `uv pip install --python .venv/bin/python -e ...`. Plain `uv pip install` outside an activated venv went into conda base.
  - A pack name can't equal an extension name.
  - A trimmed pack fails at boot, so copy the full `assistant` list and add `mindpalace`.
  - `ufoctl init` refuses without `UFO_ANTHROPIC_API_KEY`, and UFO's own `.env` refuses the bare `ANTHROPIC_API_KEY`; `scripts/mp_serve.py` maps it.
  - No cargo means no Rust client. Instead, `POST /surface/ufo/<channel>` with bearer `~/.ufoctl/token` and `x-ufo-model` (`scripts/mp_ask.py`).
- **A scripted `ModelClient` is gold.** The `mindpalace-walker` model makes a real UFO turn run the protocol deterministically, at zero cost and with no key. It is also the seam for River checkpoints.
- **Claude in UFO behaves differently from the script.** `claude-sonnet-5` fires claims in parallel and cites fewer stations. The service still keeps it honest, and route-completion checks count handoff-inherited verdicts.
- **Clear write-backs before a demo.** They persist in `server/protocol/.overlay/`; run `rm -rf` on it before a live demo, or the SOC 2 gap is already closed.
- **Next time:** build the UFO pieces against the real seed pages from the start, and ship a `POST /reset` for the overlay and loose ends.
