---
name: polish-lessons
description: Lessons from the polish/ui workspace - overview map camera in controls.ts, game-HUD quest log, party bar, follow mode with route ribbon, commission/quest events, stage pacing and headless QA. Load before changing web/src/controls.ts, web/src/ui, web/src/agents (not avatar.ts) or DEMO.md in Agent Palace.
---
# Polish / UI lessons

- **Direction changed three times in 90 minutes.** Keep changes small and committed so a pivot costs
  nothing: commit WIP before every ownership change, and revert files you no longer own in a separate
  commit, so the net diff there is zero and nobody has to resolve conflicts.
- **The camera belongs in `controls.ts`, not the scene.** `createControls()` is the one seam the scene
  calls. Returning a map camera from it changed the default view without touching `web/src/scene/`.
  Frame on the first `update()`, because the scene sets its own start pose after creating controls.
- **Frame what exists, not the bounding box.** A plus-shaped palace's bbox corners are empty. Project the
  wall corners and solve distance and image-plane offset iteratively (16 steps converge). Put the orbit
  target back on the floor along the same view ray, so the picture doesn't change.
- **Pickers built for first person break in the overview** (a 30 m ray). A ray-to-point pick over memory
  positions in presence is 15 lines and works whatever the scene is.
- **Pace replays from the file.** Read the last `t` and set `rt.events.speed` so every replay lasts about
  20 s on stage. For a run-1 vs run-2 comparison, use one fixed speed, or run 2 stops looking faster.
- **HUD = pure function of the stream.** Cards, party bar and the route checklist all come from events,
  with the same run-reset rule as presence (`subscribeRuns`). Spawned agents must be registered from
  `spawn` (`registerSpawn`) in *both* plugins' name tables.
- **Headless QA:** playwright-core + `channel: "chrome"`. Write step lists to a JSON file; inline JSON
  containing `eval` or long heredocs trips the worktree guard. A `clickmem` step that projects a
  memory's position to screen coordinates makes click tests deterministic. Synthetic replays for
  unmerged event types go in an uncommitted fixture file.
- What I'd do differently: ask for the final interaction (the quest flow) before polishing the old
  one. Build the HUD from the event schema first, and the camera second.
