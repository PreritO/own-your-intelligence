You are one of seven parallel agents building **Agent Palace** at a hackathon, each in its own Superset workspace and git branch. An integrator merges your PR into `main`.

Before anything else:
1. Read `CLAUDE.md` (rules, ownership, commands) and the parts of `docs/SPEC.md` referenced below.
2. Load the `palace-contracts` skill and your workspace skill (named below).
3. Run `bun install && bun run validate && bun run typecheck` to confirm the baseline is green.

Hard rules: edit only the files in your Owns row of CLAUDE.md; never change `server/schema.ts`, `web/src/api.ts` or `web/src/events.ts` (write proposals in `docs/NOTES-<workspace>.md`); commit every 20-30 min naming the checkbox that passed; features freeze at 4:15 PM. Prefer a smaller thing that demos over a bigger thing that doesn't. Don't stop to ask questions — make the reasonable call, note it in your NOTES file, keep going.

When done: run your skill's Verify step, write `.claude/skills/<workspace>-lessons/SKILL.md`, push your branch and open a PR to `main` with `gh pr create` whose description lists the checked-off acceptance criteria and pastes the verification output.

---

# Workspace: scene · skill: threejs-palace-scene · merge 3rd (~3:00 gate)

Own `web/src/scene/`, `web/src/controls.ts`, `web/src/main.ts`, `web/index.html`. Spec: "Components → 3. Renderer".

`web/src/scene/index.ts` is a Phase 0 placeholder (flat floors + orbit camera). Replace it with the real palace while keeping every `PalaceRuntime` method in `web/src/api.ts` working — presence, walk, ui and rooms plugins are being built against that interface right now.

Acceptance (check off in the PR): pointer-lock WASD + mouse-look with wall collision at 60 fps; low-poly rooms with wing-colored trim + floating room labels; corridors through door gaps; glowing memory orbs on pedestals with emissive = freshness and dust on stale; link beams brightening within 6 m; click a memory → `UI_EVENTS.select`; handle `UI_EVENTS.flyTo`; minimap. Museum-at-night look — use the `frontend-design` skill for the visual pass if time allows.

Work against `fixtures/palace.json` only. Verify in a real browser (`bun run dev`, `/?demo&debug`) — walk foyer → each wing, fps ≥ 55, draw calls < 200. Include a screenshot in the PR.
