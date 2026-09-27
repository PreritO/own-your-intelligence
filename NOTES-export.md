# NOTES — export workspace

Owns `server/export.ts`, `server/layout.ts`, `server/ask.ts`. Built as a Claude Code subagent in an
isolated worktree (no human available), so every judgment call is recorded here.

## How to run

```sh
bun run export                                  # fixtures/seed-brain -> fixtures/palace.json
bun server/export.ts out.json --brain dir       # any Markdown brain, any output path
#   flags: --routes fixtures/learned-routes.json  --replays fixtures/replays  --now 2026-09-27
bun run validate                                # or: bun server/validate.ts out.json
bun run ask                                     # :8787  POST /ask {question}, GET /palace, GET /health
#   env: PALACE, BRAIN_DIR, TRACES_DIR, ASK_PORT, ASK_MODEL (default claude-sonnet-5),
#        ANTHROPIC_API_KEY (.env, auto-loaded by Bun), MP_GBRAIN=0 | MP_GBRAIN_HOME=<dir>
curl -XPOST localhost:8787/ask -d '{"question":"Who owns the SOC 2 renewal?"}'
curl -XPOST 'localhost:8787/ask?canned' -d '{"question":"..."}'   # force the canned fixture trace
```

In this branch `fixtures/seed-brain/` doesn't exist yet, so `bun run export` exits 1 with
"brain directory not found" and writes nothing. That's on purpose: seed owns `fixtures/`, so I didn't
overwrite `fixtures/palace.json`. After seed merges, `bun run export && bun run validate` is the whole job.

## Decisions

- **The exporter reads Markdown directly, not the gbrain CLI.** It's the same directory `gbrain import`
  ingests, so the palace matches the brain exactly. gbrain 0.42's link extractor only knows the
  `people|companies|meetings|…|finance` dirs, so it would drop every `legal/` and `eng/` link. Reading the
  files also needs no install, runs in ~70 ms on the 68-page seed WIP, and can never touch a personal brain.
- **Frontmatter:** `title`, `type`, `team` (finance|legal|eng|engineering; anything else, or none, means the
  People wing), `updated` (or `date`), and optional `room` (see below). If `team` is missing, pages under
  `finance/`, `legal/` or `eng/` still go to that wing (a guard against seed-author slips). `README.md`,
  `index.md` and `_*.md` are skipped.
- **Typed links are parsed from:**
  - a `- kind: [[slug]]` list line. Every link on a list-only line gets `kind`.
  - a prose line starting `Label: [[a]] ... [[b]]`. Only the first link gets `label`.
  - `[[kind::slug]]` / `[[kind:slug]]` wikilinks.
  - frontmatter `links: [{to, type}]` or `["kind: slug"]`, and any other frontmatter key holding a wikilink.
  - relative `[text](../x.md)` Markdown links.

  Everything else is `mentions`. Each `(from, to)` pair keeps one link, and a typed kind beats `mentions`.
  Targets resolve by exact slug, then relative path, title, slugified title, and finally a unique basename.
  Unresolved or self links are dropped with a warning.
- **Freshness** comes from `updated:` frontmatter first, then the file's last git commit (one `git log`
  call), then 0.5. Seed pages carry `updated:`, and git dates would all be "today" after the hackathon
  commits. The scale is linear, 1 = now and 0 = 180 days old.
- **Determinism:** "now" is `--now` if given, otherwise the **newest page date in the brain**. It is not
  the wall clock, so the same brain always gives byte-identical output. `generatedAt` is that same instant.
  On the seed WIP this is 2026-09-26, which is effectively today.
- **Layout matches the Phase 0 fixture:**
  - The foyer sits at the origin. Wings run N=people, E=legal, S=finance, W=eng.
  - Rooms are 12×4×12. The first room sits 20 m out and each further room +14 m.
  - Every corridor has a door on both ends, at wall centers along the wing axis.
  - Each room holds at most 12 memories, and a wing's pages are balanced across its rooms.
- **Replay pins (keeps the demo intact).** The exporter reads `fixtures/replays/*.jsonl`. When an agent
  `move`s to room R and then `claim`s or `visit`s memory M, M is pinned to R, and every `room-<wing>-<i>` a
  replay moves to is guaranteed to exist. So `finance/budget-2026-q4` always sits in `room-finance-1`
  (Legal's handoff walk), even with ≤ 12 finance pages. Every room id and memory id the canned replay uses
  also stays valid. When pins conflict, the first file in sorted order wins and the exporter prints a warning.
- **`room:` frontmatter (seed uses it)** clusters pages inside a wing and becomes the room label (majority
  vote). A group is placed in the lowest room index its pinned members need. On the seed WIP this
  reproduces the fixture's labels exactly: People, Partners, Contracts, Corporate, Board & Plans, Budgets,
  Security, Platform. Without `room:`, labels come from the dominant page types ("People & Companies").
- **Pedestals** sit on a ring of radius 3.8 m, spread evenly over the arcs at least 30° away from the wing
  axis, which is where the doors are. Wing rooms reserve both axis ends, so a later overflow door never moves
  pedestals. Measured on the seed WIP:
  - ≥ 2.22 m from every wall
  - ≥ 3.31 m from every door
  - ≥ 1.9 m off the door-to-door walkway
  - ≥ 1.44 m between pedestals
- **Routes:** the `routeId` entries in `fixtures/learned-routes.json` win over the three hand-authored
  fallbacks with the same id. When several entries share an id, the one with the highest `uses` wins. The
  label is the fallback's label, or the learned `task`. Extra learned routes are appended sorted by id.
  Stations missing from the brain are dropped with a warning.
- **Agents:** the fixed three (legal, finance, eng), each homed at `room-<team>-0`.

## Ask server

- **Retrieval** first tries `gbrain call query` against a *project-local* brain only: `MP_GBRAIN_HOME`, or
  `./.gbrain/config.json` with `GBRAIN_HOME=$PWD`. It never uses the default `~/.gbrain`. It has a hard
  2 s limit (SIGKILL + race), because `gbrain query` hung indefinitely here on an isolated PGLite brain
  (probably waiting on an embedding provider). Otherwise, and by default, a local idf keyword ranker runs
  over the same Markdown (title/type/slug weigh 3×, body 1×, light stemming).
- **Trace** = the top ≤ 3 ranked pages, each followed by its one-hop link/backlink neighbours in the order
  they were touched, max 6 hops. Reasons are honest: `keyword match: sign, gripwork, contract`,
  `gbrain query: ranked result #2`, `graph link: funded_by (from Gripworks MSA), on route contract-signoff`,
  `graph backlink: ...`. Neighbours are ordered by question relevance, with small boosts for typed outgoing
  edges and for sharing a palace route with the seed page.
- **Answer:** Claude `claude-sonnet-5` over raw `fetch`. `@anthropic-ai/sdk` isn't a dependency and I
  can't edit `package.json`. The call has thinking disabled, 600 max tokens, and a timeout inside the 8 s
  budget. The system prompt says: only the retrieved pages, state gaps, JSON `{answer, citations}`.
  Citations are filtered to hop ids. A missing key, error, timeout or refusal falls back to a template
  answer (first sentences of the top pages plus an explicit "Gap: …" for pages that say nothing is recorded).
- **Any other error**, or zero matches, returns the closest canned trace from `fixtures/traces/`
  (term overlap with each trace's question) with header `x-trace-source: canned`. Live responses carry
  `keyword+claude`, `keyword+template` or `gbrain+…`.
- Real calls (seed WIP brain, key from `.env`): 2.3–3.2 s each, all three demo questions valid.

## For the integrator

- **Dependency (optional):** `@anthropic-ai/sdk`. `ask.ts` uses raw `fetch` today, which works; switch if you
  want typed errors.
- **Seed content:** on the seed WIP, Claude answered the contract question "Not yet as-is". The
  `legal/approvals` page says "approved … pending budget confirmation", and nothing records the budget
  confirmation. The replay's answer is "Yes, if Mara Okafor or Dev Lindqvist signs". If the demo needs a
  "yes", the approvals log (or the budget page) should record Finance's confirmation. This is seed's call.
- After seed merges, run `bun run export` once and commit the regenerated `fixtures/palace.json`. On the
  seed WIP that means 9 rooms, 68 memories, 219 links and 5 routes, and validate passes.
- `bun run export` needs no flags. Scene/walk can hit `GET localhost:8787/palace` or keep using Vite's static
  `/palace.json`.
