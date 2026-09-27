# NOTES: polish, now the `ui` workspace

Branch `ws/polish`. This ran as a Claude Code subagent with no human available, so the calls below are mine. Direction changed three times mid-run (stage polish, then a simplified UI, then game HUD + quest flow), and this file describes where it ended up.

## Owns (per the integrator's updates)

`web/src/main.ts`, `web/src/controls.ts`, `web/src/ui/`, `web/src/walk.ts`, `web/src/agents/` (not `avatar.ts`), `web/src/nav.ts`, `web/index.html`, `DEMO.md`.

`web/src/scene/` belongs to `voxel`. An early WIP commit touched it (map view draft, wing names, beam/label toggles). That was reverted in the next commit, so the PR's net diff on `web/src/scene/` is zero.

## What's built

### Overview camera (`controls.ts`)
- `createControls()` returns a game-style map camera by default. `?walk` keeps the old pointer-lock first person.
- Framing: a roofless view pitched about 52°, auto-framed so the palace's walls fill the screen area the HUD leaves free (`HUD_INSETS`).
- Mouse: drag pans, right-drag turns, scroll zooms (MapControls, damped).
- Keys: WASD/arrows pan, Q/E turn, +/- zoom. The target is clamped to the palace.
- It frames on its first `update()`, so any start pose the scene sets is overridden.
- `release()`/`restore()` keep the runtime contract. Restore glides back to the pre-cinematic view.
- Window events `mp:camera-home` and `mp:camera-focus {pos, distance}` let the HUD drive it.

### HUD (`ui/`)
- Look: pixel font (Pixelify Sans, monospace fallback), bevelled translucent panels.
- **New quest** box (top centre): input plus **▶ Commission**. Secondary buttons: **▶ Demo: 3 department tasks** and **↻ Replay**.
- **Quest log** (left): one card per task. Each card shows:
  - agent face and colour, the question, and step x/y
  - a segmented station bar (green verified, amber gap, dull amber stale, blinking current)
  - status in plain words ("Step 2 of 5: reading Gripworks MSA", "Waiting on Eng", "Asking Finance: …")
  - when finished, the answer with cited chips, and gap/stale in amber
- Commissioned quests also get a phase stepper (Plan → Explore → Gym → Execute → Done), hops ("Explore 8 → learned route 4"), a Gym reward sparkline from `train_step`, and "📜 New page".
- **Quest complete** banner on `answer` + `phase: done`, with a **View page** button that flies to the artifact.
- **Party bar** (bottom): Map slot, then commissioned agents first, then Legal/Finance/Eng. Each slot shows a key number, face and one-line status.
- **Right column**: the memory page (click an orb) and, in follow mode, the route checklist.
- **Activity** drawer (bottom left, closed by default) and a **Links** toggle (`rt.setLayerVisible?.("links")`; off by default).

### Presence (`agents/`)
- Every agent starts in the foyer, so dispatch reads as three agents fanning out.
- Follow mode (1-4, a party slot, a quest card, or click an avatar):
  - high third-person camera
  - route ribbon on the floor through the doors (`agents/route.ts`) with numbered markers: ✓ done, ▶ current with its title, dim upcoming, ⚠ gap, stale
  - `rt.focusRooms?.(routeRooms)`, `setPalaceDim(0.55)`, and room labels hidden
- Station labels only show in follow mode, as route markers. Gap notes always show, so the SOC 2 gap still reads in the overview. Handoff beams and wait rings are unchanged.
- New events:
  - `spawn`: a dynamic Avatar with its colour, a ring flourish, auto-follow, and it takes party slot 1.
  - `phase`: shown in the HUD.
  - `artifact`: `rt.addMemory?.(memory)` plus a toast.
  - Names and colours for spawned agents are registered from the event (`registerSpawn`).
- Commission:
  - Live: `POST :8788/commission {task}` (4 s timeout).
  - `?demo`, or the bridge is down: replay `quest-onboarding`. If that file is missing, a toast suggests the department demo.
- Stage pacing (`playReplay`): each replay is stretched to about 20 s (the quest to about 30 s) unless `?speed` is set.
  - `R` alternates `contract-run1` / `contract-run2` at the same pace (0.7), so run 2 visibly finishes sooner.
- Memory picking from the overview: presence picks the orb nearest the click ray itself, because the scene's picker ray is 30 m (main) or 60 m (voxel) and the map camera sits 50-100 m away.

### Boot (`main.ts`)
- `?demo&hold` starts idle, and nothing plays until Commission, Demo or T.
- Default stage speed is 0.7 when `?speed` is absent.

## Calls I made without a human
- The minimap and the scene's "Click to walk" hint are hidden from the UI stylesheet (`.mp-minimap, .mp-hint { display: none }`), because the overview makes them redundant and the scene is no longer mine. **voxel:** delete them at the source if you agree.
- Keys: `T` department demo, `R` run-again, `N` focuses New quest, `1-4` follow in party order, `Esc`/`0`/`H` overview (Esc in the overview reframes), `/` ask.
- The old overhead mode is gone: the overview is overhead. `presence:camera {mode:"free"|"overhead"}` maps to overview for compatibility.
- The quest card is the hero. Department tasks from the 3-task demo are ordinary cards below it.
- Screens 5-6 in `web/src/ui/wip/` use a synthetic QA quest replay (not committed), because `quest-onboarding.jsonl` hadn't landed yet.

## For other workspaces
- **voxel (scene):**
  1. Please raise the picker `ray.far` to about 200 m, or picking in the overview relies only on presence's fallback.
  2. The scene still sets a first-person start pose. It's harmless, since the map camera reframes on its first update.
  3. The hint text says "Click to walk".
- **commission:**
  1. The HUD expects `POST :8788/commission {task}`.
  2. The spawn event's `task` is shown as the quest title.
  3. A `route` event with `source: "explore"` then `"learned"` drives the hops line. Visits during `phase: execute` count as learned hops.
- **humans (avatar.ts):** presence only uses the public Avatar API: the constructor, `walk`, `end`, `teleport`, `setTag`, `setWaiting`, `ping`, `update(dt, speed)`, `dispose`, `group`, `id`, `name` and `color`.
- **flow:** I built no path-correctness panel. Follow mode stays simple (ribbon, markers, checklist).

## Verification
- `bun run validate && bun run typecheck && bun run build`: green.
- Headless Chrome (playwright-core + system Chrome) screenshots: overview idle, 3-task demo mid-run, follow Legal with route + checklist, end state, quest follow, quest complete, memory panel from the overview, R run 1 / run 2.
- **Needs a human on a real laptop GPU:**
  - fps with the voxel scene plus route ribbon and labels
  - trackpad two-finger rotate/zoom feel on MapControls
  - Pixelify Sans loading on the venue network (it falls back to monospace)
