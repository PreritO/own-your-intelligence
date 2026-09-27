You are one of seven parallel agents building **Mind Palace** at a hackathon, each in its own Superset workspace and git branch. An integrator merges your PR into `main`.

Before anything else:
1. Read `CLAUDE.md` (rules, ownership, commands) and the parts of `docs/SPEC.md` referenced below.
2. Load the `palace-contracts` skill and your workspace skill (named below).
3. Run `bun install && bun run validate && bun run typecheck` to confirm the baseline is green.

Hard rules: edit only the files in your Owns row of CLAUDE.md; never change `server/schema.ts`, `web/src/api.ts` or `web/src/events.ts` (write proposals in `NOTES-<workspace>.md`); commit every 20-30 min naming the checkbox that passed; features freeze at 4:15 PM. Prefer a smaller thing that demos over a bigger thing that doesn't. Don't stop to ask questions — make the reasonable call, note it in your NOTES file, keep going.

When done: run your skill's Verify step, write `.claude/skills/<workspace>-lessons/SKILL.md`, push your branch and open a PR to `main` with `gh pr create` whose description lists the checked-off acceptance criteria and pastes the verification output.

---

# Workspace: seed · skill: gbrain-bridge · merge 1st (~2:00)

Own `fixtures/` and `scripts/make-fixtures.ts`. Spec: "Components → 1. Seed brain", "Data contracts", "Demo script".

1. Write ~60 Markdown pages for the fake company **Acme Robotics** in `fixtures/seed-brain/` (finance/, legal/, eng/, people/, companies/ …) with frontmatter `title`, `type`, `team` (finance|legal|eng; omit = shared People wing), typed wiki-links, every page linking ≥ 2 others, no real people's names. Keep every memory id already in `fixtures/palace.json` (the demo relies on them) and their facts consistent with `fixtures/replays/demo-1.jsonl`.
2. Include the 3 demo routes (contract-signoff, board-promises, soc2-owner) with clear 3-5 hop answer paths, and the deliberate gap: `eng/soc2-owner` exists but records no owner. Make `eng/security-policy` stale.
3. Varied freshness: add `updated:` frontmatter spanning today → 200 days ago (the exporter uses git dates when available, frontmatter otherwise).
4. Import into an **isolated** project-local brain (never the user's personal one): figure out `gbrain init`'s path option, then `gbrain import fixtures/seed-brain --no-embed`. Record the exact commands in `NOTES-seed.md`.
5. Canned replays: keep `replays/demo-1.jsonl` valid; add `replays/contract-run1.jsonl` (wandering, ~9 hops, `source: "explore"`) and `replays/contract-run2.jsonl` (learned route, 5 hops, `source: "learned"`) for the Workshop demo, and `fixtures/learned-routes.json` `[{routeId, task, stations, uses}]`.
6. Add traces `traces/demo-2.json`, `traces/demo-3.json` for the other two demo questions.
7. `fixtures/synthetic-tasks.jsonl`: ~50 questions per team `{team, question, route, expectedAnswer, expectedGaps}` for the Gym (training scales it up).

Done when: `bun run validate` passes, `gbrain list` in the isolated brain shows ~60 pages, and the three demo questions each have a written 3-5 hop path in `NOTES-seed.md`.
