---
name: agent-presence
description: Load when building the multiplayer presence layer in web/src/agents - agent avatars, station state markers, handoff beams, the event feed, camera modes and replay speed. The multiplayer hero feature of Mind Palace.
---
# Agent presence

- Pure function of `rt.events` (web/src/events.ts). Never read agent state from anywhere else; `?demo` and live must render identically.
- Avatar: glowing orb in agent color + floating name tag. Spawns in `agent.home`. On `move` tween along `nav.pathBetween()` through doors; on `claim`/`visit` glide to the station (`rt.memoryPosition`). Speed so the demo replay fits 15-25 s.
- Station states: claimed = ring in agent color; verified = green flare then steady green; stale = dim amber; gap = pulsing amber + floating note; `wait` = the waiting avatar hovers by the station with an hourglass/dotted ring.
- Handoff: beam between the two avatars from `handoff` until matching `reply` (by `id`); feed line "Legal asked Finance: is Gripworks within budget?".
- Answer: card in the feed with cited station chips (click → `emitUI(UI_EVENTS.flyTo, …)`); gaps/stale called out in amber; `blocked: true` shown in red.
- Camera modes: free walk (default), follow agent (keys 1-3), overhead (key 0 / O) showing all agents. Use `rt.controls.release()/restore()`.
- `T` dispatches the three demo tasks: in demo mode `rt.events.restart()`, live mode POST to the bridge.
- Speed: the same replay at `?speed=1` and `?speed=3` must end in the same final state.
- Verify: `/?demo` shows one handoff beam, one wait, one amber gap at `eng/soc2-owner`, three answers in the feed; repeat at `&speed=3`.
