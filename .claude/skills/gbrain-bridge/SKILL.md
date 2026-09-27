---
name: gbrain-bridge
description: Load when reading from or writing to GBrain - seeding the brain, exporting pages and links, running queries, building retrieval traces, or writing Loose End answers back to pages in Agent Palace.
---
# GBrain bridge

- GBrain (`gbrain` CLI, v0.42) stores pages as Markdown with typed links plus a PGLite index. Prefer CLI/MCP over parsing internals. Useful: `gbrain list`, `get <slug>`, `put <slug> < file.md`, `import <dir> --no-embed`, `search`, `query <q>`, `graph <slug> --depth N`, `graph-query`, `link <from> <to> --type T`, `backlinks`.
- **Isolation first:** never point at the user's personal brain. Run `gbrain init --help` and use a project-local brain (e.g. `.gbrain/` in the repo, gitignored) via whatever flag/env it supports; record the exact incantation in your NOTES file.
- Seed pages: frontmatter has `title`, `type`, `team` (finance | legal | eng; omit for shared People wing). Links are typed. Slug = path without `.md`.
- Export: all pages → `{id, title, type, team, links[], excerpt (first 200 chars of body), lastCommit}`.
- Freshness from `git log -1 --format=%cI -- <path>`: 1 = today, 0 = 180+ days, linear. Seed pages get varied commit dates via `GIT_COMMITTER_DATE`/`GIT_AUTHOR_DATE` (or a `updated:` frontmatter fallback if history can't be faked in a worktree; say which in notes).
- Traces: record every page retrieval touched, in order. If `gbrain query` only returns final results, synthesize hops from ranked results + one-hop link expansion and say so honestly in each hop's `reason` ("ranked result #2", "graph link: funded_by").
- Verify: `bun run export && bun run validate`; `curl -XPOST localhost:8787/ask -d '{"question":"..."}'` for each demo question.
