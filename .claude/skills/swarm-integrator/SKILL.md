---
name: swarm-integrator
description: Load when acting as the integrator for the Mind Palace Superset swarm - spawning workspaces, reviewing per-workspace PRs, merging in order, enforcing gates and the cut list.
---
# Swarm integrator

- Kickoff prompts live in `agents/prompts/<workspace>.md`; `agents/launch.sh` creates each Superset workspace (branch `ws/<workspace>` from `main`) with its agent and prompt.
- Review each PR for: files outside its Owns row (reject), schema/api.ts changes (reject → notes), passing `bun run validate && bun run typecheck`, the Verify output pasted.
- Merge order: seed → export → scene → ufo-ext → qm-fork → presence → training → polish. After each merge: `bun install && bun run validate && bun run typecheck && bun run build`, then load `/?demo` in a browser.
- Gates: 2:15 QM running else UFO; 3:00 a canned trace replays on the fixture palace else pair everyone on presence/walk; 4:15 feature freeze; 4:30 demo-ready.
- Read every `docs/NOTES-<workspace>.md` after each merge; apply accepted contract proposals yourself in integrator-owned files.
