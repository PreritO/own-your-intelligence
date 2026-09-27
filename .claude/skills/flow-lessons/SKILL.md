---
name: flow-lessons
description: Lessons from the flow workspace (web/src/flow - the 2D task-flow view that judges an agent's path: plan lanes, executed steps, citation rail, scorecard, explore-vs-learned run comparison). Load before changing web/src/flow or anything that decides what counts as a useful or wasted hop.
---
# Flow lessons

- **Keep the model pure and headless.** `model.ts` turns events into flows with no DOM, and `bun web/src/flow/check.ts` asserts it on every replay (and on synthetic good and bad samples). This caught the handoff attribution and "judged against the final answer" bugs before any screenshot.
- **Attribute helper work to the asker.** The owning agent's claim, visit and reply on a handoff station belong to the asker's handoff node. If you count them in the helper's own flow, they show up as fake wasted hops.
- **One row per step, columns per subtask.** Because the grid has one node per row, horizontal citation lines into the right rail never cross another node. Measure the node boxes after layout (`getBoundingClientRect`) and draw orthogonal SVG paths with `crispEdges`. Don't compute a layout yourself.
- **Explore attempts inside a quest have no answer.** Judge them against the final answer, but don't flag stale or gap pages as "not stated": the final answer only states what the final run walked.
- **Pixel fonts:** Pixelify Sans at 600/700 closes counters (2 reads as 8, C as O). Use weight 400, and use monospace for numbers, ids and evidence.
- **Another plugin can starve you.** `events.ts` fans out with `forEach`, and a throw in an earlier plugin drops the event for every later one. When your view looks stuck on a replay, check `pageerror` first.
- **Headless QA:** playwright-core + `channel: "chrome"`, run from a temp dir. Put the steps in a script file, because long inline JS trips the worktree guard. Open the panel with `?flow=half|full&flowrun=both`. Serve unmerged replays from your own dir via `?demo=../src/flow/samples/<name>`.
- **What I'd do differently:** rebase onto main before the first screenshot. The HUD had changed (bevelled game-HUD, bottom-left dock), and my first launcher position and palette were wrong.
