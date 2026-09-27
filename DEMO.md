# Agent Palace stage runbook

For the person at the laptop. The demo runs on the seeded fake company (Acme Robotics) only.

## 0. Before you go on stage (T-10 min)

```sh
bun install
rm -rf server/protocol/.overlay        # reset: forget Loose End answers written in rehearsal
bun run validate                       # fixtures OK
```

- Plug in power and close other GPU-heavy tabs. Use Chrome, full screen (Cmd+Ctrl+F), zoom 100%.
- Open the canned URL below once to warm the cache, then reload it right before you start.
- Look for "Quest log", the "New quest" box, and the party bar. If they're missing, reload.

## 1. Start everything

### Canned (safe default, no network, no keys)

```sh
bun run dev
open "http://localhost:5173/?demo&hold"
```

- `?demo` replays recorded runs from `fixtures/replays/`.
- `&hold` starts idle: nothing moves until you press a button or key.
- Pacing is automatic: each replay is stretched to about 20 s (about 30 s for the quest). Add `&speed=1` for recorded timing.
- Optional flags:
  - `&links` shows the links between memories.
  - `&walk` switches to the old first-person camera.
  - `&debug` adds an fps and draw-call overlay (scene).

### Live (real agents)

Use four terminals, in this order:

```sh
uv run --project server/protocol python server/protocol/service.py   # loci protocol service :8790
SAVE_RUNS=0 bun server/bridge.ts                                     # /events + /dispatch + /commission :8788
bun server/ask.ts                                                     # ask bar backend :8787
bun run dev                                                           # web :5173
open "http://localhost:5173/"
```

- `SAVE_RUNS=0` stops the bridge from writing `fixtures/replays/run-*.jsonl` during the show.
- Every live button falls back to its recording if the bridge doesn't answer within 4 s:
  - Commission falls back to `quest-onboarding`.
  - The department demo (T) falls back to `demo-1`.

  A toast says so, and the room keeps going.

## 2. Controls

| Input | Does |
| --- | --- |
| Type in **New quest**, then **▶ Commission** | Spawns a new agent for that task (main flow) |
| **N** | Jumps to the New quest box |
| **▶ Demo: 3 department tasks** or **T** | Legal, Finance and Eng each get a task |
| **↻ Replay** | Plays the last run again from the start |
| **R** | Runs the contract task again: run 1 explores, run 2 walks the learned route |
| **1-4**, or click a party slot, quest card or avatar | Follow that agent: camera tracks it, its route is drawn on the floor, and the checklist opens on the right |
| **Esc**, **0** or **⌂ Map** | Back to the overview; in the overview, Esc reframes the whole palace |
| Drag / right-drag / scroll | Pan / turn / zoom (the camera is clamped to the palace) |
| **WASD** or arrows, **Q/E**, **+/-** | Pan, turn, zoom from the keyboard |
| Click a glowing memory | Opens its page on the right |
| **Activity ▸** (bottom left) | Opens the plain-words event log |
| **/** | Opens the ask bar (single retrieval walk) |

Party slots: a commissioned agent takes slot 1, and the staff are Legal, Finance and Eng after it. With no quest running, Legal is 1.

## 3. The 90-second script (canned timings at the default stage pace)

| Clock | Say | Do |
| --- | --- | --- |
| 0:00 | Hook: "Memory champions memorize decks of cards by walking an imagined building. We gave a company's agents the same building." | Page open, idle overview of the whole palace |
| 0:10 | "This is Acme Robotics' company brain. Each wing is a department: Legal, Finance, Eng, People." | Scroll-zoom toward Legal, then click one glowing memory. The page opens on the right. Press Esc to close it and reframe the whole palace. |
| 0:25 | "Give the company a job." | Click the New quest box, type (or keep) *Create an onboarding page for new engineers*, then press **▶ Commission**. |
| 0:28 | "A new agent spawns in the foyer." | Camera auto-follows it. Point at the route on the floor and the checklist on the right. |
| 0:35-0:55 | "It tours the departments. Where a room belongs to another team, it asks the owner: that beam is a handoff." | Press **Esc** once for the overview so the handoff beams and staff read, then press **1** to follow again. The quest card shows the phase and "Asking Legal: …". |
| 0:55 | "It found a hole: nobody owns SOC 2. It says so instead of guessing." | The amber gap note shows in the overview, and the quest card turns amber. |
| 1:00 | "Then it trains in the Gym." | Quest card phase = Gym, and the reward sparkline climbs. |
| 1:10 | "And comes back to do the job on a learned, shorter route." | Card: "Explore N hops → learned route M hops". |
| 1:20 | "It wrote a new page, and cited every station it used." | A **Quest complete** banner appears. Press **📜 View page** to fly to the new page. |

Backup beats (if the quest replay isn't in `fixtures/replays/` yet, or for a longer slot):

- **Department demo (T), about 19 s.**
  - Three agents fan out from the foyer.
  - Finance waits on Eng at the Org Chart (dotted ring).
  - Legal stops at the Budgets door and hands off to Finance (beam).
  - Eng finds the SOC 2 gap (amber).
  - Three answers land in the quest log.
- **Run it again (R, then R).** Run 1 explores 9 stations. Run 2 walks the learned 5-station route at the same pace, so it finishes visibly sooner. The Workshop and Loose Ends buttons (bottom right, training's HUD) fly to those rooms.

## 4. Fallback plan

| Problem | Fix |
| --- | --- |
| Live bridge or agents hang | Reload with `?demo&hold` and keep talking. The recorded runs are identical. |
| "No recorded quest yet" toast | `fixtures/replays/quest-onboarding.jsonl` isn't merged yet. Run the department demo with **T**. |
| Nothing moves after Commission | Press **↻ Replay**. If still nothing, reload and press **T**. |
| Camera lost or zoomed oddly | Press **Esc** (reframes the whole palace). |
| Low fps | Add `&nobloom` to the URL. The scene also drops bloom by itself below 45 fps. |
| Fonts look like plain monospace | No internet for Google Fonts. It's cosmetic; carry on. |
| Stale Loose End answers from rehearsal | Stop the protocol service, `rm -rf server/protocol/.overlay`, restart it. |
