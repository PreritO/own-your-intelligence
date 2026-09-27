---
name: export-lessons
description: Lessons from the export workspace (server/export.ts, layout.ts, ask.ts) - Markdown-first export, replay-pinned layout, honest retrieval traces. Load before changing the exporter, layout or ask server again.
---
# Export lessons

- **Read the Markdown, not the gbrain CLI.** gbrain 0.42 only extracts links under
  people|companies|meetings|…|finance, so it silently drops legal/ and eng/ edges. `gbrain call query`
  also hung forever on a fresh isolated PGLite brain. If you add gbrain back, always pass
  `GBRAIN_HOME=<project-local>` and SIGKILL it on a timeout. Never let it fall through to `~/.gbrain`.
- **The demo replay is a layout constraint.** `move` targets must be real rooms, and memories visited
  right after a move must be in that room. So `replayPins()` derives pins from `fixtures/replays/*.jsonl`
  and layout honors them. Without that, `finance/budget-2026-q4` fell out of `room-finance-1` as soon as
  finance had ≤ 12 pages.
- **Typed links in prose lie.** "Counterparty: [[a]]. Scope: [[b]] … [[c]]" typed every link on the line as
  `counterparty` and hid the real `## Links` kinds. A line label now only types the first link unless the
  line is a pure link list.
- **Determinism:** never use the wall clock. "now" = newest page date (or `--now`). Round positions, sort
  ids, and don't let `-0` leak into the JSON.
- **Retrieval quality:** cap-and-normalize scoring (`min(1, s*1.6)`) produced ties and bad seeds. Normalize
  by the best score instead. Dedupe neighbours reached by both a link and a backlink, or they use up the
  expansion slots. Gap detection should only read the page's opening lines, because long pages mention
  "TBD" somewhere.
- **Verify:** export twice + `cmp`, `bun server/validate.ts <out>`, a geometry check (wall/door/walkway
  clearance), then POST each demo question and `Trace.safeParse` the response.
- Keep dev brains and outputs in a gitignored place (`node_modules/.mp-dev/`) when you can't write to
  `fixtures/` or a scratch dir.
