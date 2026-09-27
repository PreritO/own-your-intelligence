You are one of seven parallel agents building **Mind Palace** at a hackathon, each in its own Superset workspace and git branch. An integrator merges your PR into `main`.

Before anything else:
1. Read `CLAUDE.md` (rules, ownership, commands) and the parts of `docs/SPEC.md` referenced below.
2. Load the `palace-contracts` skill and your workspace skill (named below).
3. Run `bun install && bun run validate && bun run typecheck` to confirm the baseline is green.

Hard rules: edit only the files in your Owns row of CLAUDE.md; never change `server/schema.ts`, `web/src/api.ts` or `web/src/events.ts` (write proposals in `NOTES-<workspace>.md`); commit every 20-30 min naming the checkbox that passed; features freeze at 4:15 PM. Prefer a smaller thing that demos over a bigger thing that doesn't. Don't stop to ask questions — make the reasonable call, note it in your NOTES file, keep going.

When done: run your skill's Verify step, write `.claude/skills/<workspace>-lessons/SKILL.md`, push your branch and open a PR to `main` with `gh pr create` whose description lists the checked-off acceptance criteria and pastes the verification output.

---

# Workspace: export · skill: gbrain-bridge · merge 2nd (~2:45)

Own `server/export.ts`, `server/layout.ts`, `server/ask.ts`. Spec: "Components → 2. Exporter + layout" and "4. Ask server", "Data contracts".

Work against `fixtures/seed-brain/` (if the seed branch hasn't merged yet, generate a throwaway brain of a few pages in a temp dir to develop against; don't commit it).

1. `server/layout.ts`: pure, deterministic. Foyer `foyer` at origin; 4 wings radiating N (people), E (legal), S (finance), W (eng) exactly like the Phase 0 fixture (rooms 12×4×12 m, first room 20 m out, overflow rooms +14 m, doors on both sides of each corridor). ≤ 12 memories/room; overflow creates the next room joined by a door. Pedestals on a ring/grid never overlapping walls or doors. Sorted ids, no randomness.
2. `server/export.ts`: read pages (gbrain CLI or the Markdown directly as fallback), owners from `team` frontmatter, freshness from git date or `updated:` frontmatter, links, the 3 agents, routes from `fixtures/learned-routes.json`/fallbacks → write `fixtures/palace.json`. Runs < 5 s. Same input → byte-identical output (test by running twice and `cmp`).
3. `server/ask.ts`: Bun HTTP on 8787 with CORS. `POST /ask {question}` → `Trace` within 8 s using `gbrain query` + one-hop link expansion (label hops honestly); answer generated only from retrieved pages (Claude API via `ANTHROPIC_API_KEY` in `.env` — use the latest Sonnet model id — with a template fallback). `GET /palace` serves palace.json. Any error → matching canned trace from `fixtures/traces/`.

Exported palace.json must keep every memory id the demo replay references. Done when `bun run export && bun run validate` passes and each demo question curls back a valid trace.
