---
name: ui-v3-lessons
description: Lessons from ui-v3 (collapsed quest box, River leaderboard in the Gym, gym-scoreboard.json generation ladders). Load before changing web/src/ui/leaderboard.ts, the quest board, or the Gym's DOM board in Mind Palace.
---

# ui-v3 lessons

- **The spec moved twice in 30 minutes** (a flat table, then per-agent generation ladders, then "ship now with real rows"). Keep the data loaders (`loadScoreboard`, `champions`, `modelTag`) separate from the HTML, so a re-layout only touches `ladders()`.
- **Real numbers live in logs, not notes.** The RL held-out figures (0.594 → 0.672, 75% → 81%) were only in `server/train/out/*.log` of the training worktree. Grep the sibling worktrees' `out/` before asking anyone.
- **Framing without owning controls.ts:** `createMapView` keeps a reference to the exported `HUD_INSETS` object. Mutating `.top` and then firing `CAMERA_EVENTS.home` reframes the overview. Measure the collapsed bar, never the expanded one.
- **Party-bar clicks can be intercepted** by the flow view's legend when it is open (it restores from localStorage in the same browser context). In QA, dispatch the window event instead of clicking.
- **Vite HMR reloads mid-QA** when you edit files during a run ("Execution context was destroyed"). Rerun; don't debug it.
- Honest labels are data-driven: a scoreboard row with `status: "training"` renders as pending, `promoted: false` renders "not promoted", and a regression is only claimed when the next generation's grounding is lower and the row isn't promoted.
