---
name: seed-lessons
description: Lessons from the seed workspace - authoring the Acme seed brain, generating fixtures from it, and seeding an isolated gbrain. Load before editing fixtures/seed-brain, scripts/make-fixtures.ts or fixtures/seed-gbrain.sh.
---
# Seed lessons

- **Generate fixtures from the pages, never hand-edit palace.json.** `bun run fixtures` rebuilds palace, traces, replays, learned routes and synthetic tasks from `fixtures/seed-brain`, and it fails on dangling links, pages with fewer than 2 links, body wikilinks missing from `## Links`, and rooms with more than 12 pages. That check caught 4 missing links on the first run.
- **The replay is the contract.** Before re-dating or moving a page, grep `fixtures/replays/*.jsonl`. A page on a replay route must stay in the same room, and its freshness must match its verdict (under 0.3 means `stale`). The first date pass made 24 pages stale, including ones the Workshop replays mark `verified`.
- **Isolated gbrain = `GBRAIN_HOME=<repo>`.** `init --path` alone still writes `~/.gbrain/config.json`. Unset `DATABASE_URL`/`GBRAIN_DATABASE_URL`. Check the personal config hash before and after.
- **gbrain 0.42 typed links:** `gbrain link --type` is silently ignored. Use `gbrain call add_link '{"from","to","link_type"}'`. Set `config set auto_link false --force` before import, or prose heuristics add untyped or wrongly typed edges (and skip `legal/`, `eng/`).
- **Freshness via git needs backdated commits and a merge commit.** Squash or rebase merges reset the dates. Prefer `updated:` frontmatter in the exporter.
- **Worktree sandbox:** `export VAR=$PWD`, `time`, heredoc appends and `cd && bash …` chains get refused. Use absolute paths and one plain command per call.
- Next time: write the synthetic tasks as data next to the pages (per-page `## Facts`) so answers can't drift from the page text.
