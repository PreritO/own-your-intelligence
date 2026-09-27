# NOTES seed-v2

Stopped early on integrator order. What's done and what's left:

- Done: sales (11), support (10), ops (6) pages. Export and validate pass (95 memories, 16 rooms, all replays OK).
- Not written yet: marketing/* (0 pages), ops/gripper-v2-production-plan, ops/logistics. The exporter warns (doesn't fail) on 4 unresolved links: marketing/website, marketing/competitor-notes, marketing/kestrel-case-study, ops/gripper-v2-production-plan. Fill them next.
- quests.json: `expectedGaps` includes both gaps and stale pages. The extra `stations` field lists the pages each answer needs.
- Page dates are <= 2026-09-26, so the export "now" didn't move and existing freshness values are unchanged. No existing page was edited.
- gbrain was not re-seeded.
- Don't run `bun run fixtures`. make-fixtures.ts only accepts teams finance|legal|eng and would overwrite palace and replays. Use `bun run export`.
