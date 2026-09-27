You are one of seven parallel agents building **Agent Palace** at a hackathon, each in its own Superset workspace and git branch. An integrator merges your PR into `main`.

Before anything else:
1. Read `CLAUDE.md` (rules, ownership, commands) and the parts of `docs/SPEC.md` referenced below.
2. Load the `palace-contracts` skill and your workspace skill (named below).
3. Run `bun install && bun run validate && bun run typecheck` to confirm the baseline is green.

Hard rules: edit only the files in your Owns row of CLAUDE.md; never change `server/schema.ts`, `web/src/api.ts` or `web/src/events.ts` (write proposals in `docs/NOTES-<workspace>.md`); commit every 20-30 min naming the checkbox that passed; features freeze at 4:15 PM. Prefer a smaller thing that demos over a bigger thing that doesn't. Don't stop to ask questions — make the reasonable call, note it in your NOTES file, keep going.

When done: run your skill's Verify step, write `.claude/skills/<workspace>-lessons/SKILL.md`, push your branch and open a PR to `main` with `gh pr create` whose description lists the checked-off acceptance criteria and pastes the verification output.

---

# Workspace: ufo-ext · skill: loci-protocol + harness-adapters · merge 4th (~3:10)

Own `server/protocol/` and `ufo_ext_mindpalace/`. Spec: "The protocol service and the UFO extension", "Components → 5c".

1. **Protocol service first** (it's the core both harnesses share). Python (uv), HTTP on :8790: `visit`, `claim`, `handoff`, `reply`, `answer`, per-run state, ownership checks from `fixtures/palace.json` room owners, claim leases with expiry and `wait`, verdicts (stale = freshness < 0.3, gap = page missing/empty/silent), grounding check on `answer` (block citations not verified in this run). Every call emits a `PalaceEvent` (schema in `server/schema.ts`) on `GET /events` (SSE) and appends to a run `.jsonl`. Pages read from `fixtures/seed-brain/` (or gbrain CLI). Tests (pytest): ownership refusal, claim wait, gap verdict, blocked ungrounded answer.
2. A tiny scripted driver `server/protocol/demo_run.py` that walks the 3 demo tasks through the service and produces a replay that passes `bun run validate` — the harness-free fallback.
3. UFO: clone https://github.com/ufo-ai/ufo-core outside the repo (e.g. `../ufo-core`), read `spec.md` extension section + `extensions/sample`, note contracts in `docs/NOTES-ufo-ext.md`. Get stock UFO running (`make install && make init && make serve`) by **2:15** and report status in your notes/commit message.
4. `ufo_ext_mindpalace/`: Python package importing only `ufo.sdk`: the five tools forwarding to :8790, GBrain connector scoped per team; Loose End loop (gap → post to owning team channel; human reply writes the page back; station re-verifies). Stretch: palace surface, River model provider.

Done when protocol tests pass, demo_run.py output validates, and a UFO agent completes the contract-signoff route.
