# NOTES: flow

The task-flow view (`web/src/flow/`) is a DOM/SVG overlay and a pure function of `rt.events`. Open it with `G` or the "Task flow" button (bottom-left, above Activity). `?flow=half|full` opens it on load, and `&flowrun=both` opens it in compare mode.

## Calls I made (no human available)
- **Key `G`**, not Tab. Tab moves browser focus, and F/H/O/0/1-9/T/R/N and `/` are already taken.
- **Layout.** Each subtask is a column: `phase.subtasks`, or one column per department when a run has no plan (these are labelled "inferred"). Each executed step gets its own row in execution order, so the path zig-zags between departments. Cited steps run horizontally into a green rail that feeds the Answer node.
- **Handoff attribution.** The owning agent's claim, visit and reply on a handoff's station count toward the asker's flow, as the branch on the handoff node. They are not counted as hops in the helper's own flow. In demo-1, Finance's budget read for Legal therefore does not appear as a wasted hop for Finance.
- **Useful hops** = cited steps + gap or stale steps that the answer states. "Wasted" = verified but never cited.
- **Quests.** A quest has an explore attempt and then an execute attempt (a learned route) in one run. The explore attempt has no answer of its own, so it is judged against the final answer. It gets no "not stated" flags, because the final answer only has to state what the final run walked.
- **Run comparison across replays.** On `?demo=contract-run2`, the view fetches `contract-run1.jsonl` (for any `runN`, it fetches `run(N-1)`) as an archived comparison source. In-page restarts also work: when `t` jumps back, the previous segment is archived and stays available for comparison. Tabs show the current segment only.
- **Ownership check** needs a team: palace agents, or a spawned agent whose `home` room is team-owned. Commissioned agents living in commons get "–" and a handoff count.
- **Font.** Pixelify Sans at weight 400 only. At 600/700 it closes counters (2 reads as 8, C as O). Numbers and evidence use monospace.
- `web/src/flow/samples/` holds synthetic replays (`quest-sample`, `flow-bad` with every red flag) and a copy of `quest-onboarding.jsonl` from `ws/commission`. View them with `?demo=../src/flow/samples/<name>` in dev (the fetch normalises `/replays/../`). `bun web/src/flow/check.ts` asserts the model on every replay.

## For the integrator
- **events.ts: isolate subscribers.** `emit` is `subs.forEach(cb)`, so one plugin throwing aborts delivery to every later plugin. On the pre-polish UI, an `answer` from a spawned agent threw in `ui/index.ts` (`rows.get(agent)!.st`), and flow (the last plugin) never received the answer. Main no longer throws there, but `try { cb(e) } catch (err) { console.error(err) }` per subscriber would make every plugin robust to the others.
- No schema or `api.ts` changes needed.
