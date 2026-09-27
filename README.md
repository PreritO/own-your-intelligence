# Mind Palace

**Your company's agents, walking your company's memory, where you can see what they checked.**

Mind Palace turns a company's shared brain into a walkable, block-built building: one wing per department (Legal, Finance, Eng, People, Sales, Marketing, Ops, Support), one glowing block per page. Then it sends a team of AI agents into it. You watch them walk their routes room by room, ask each other for help, get stopped when they try to cite something they never read, and flag what nobody wrote down.

Built in one afternoon at the YC "Own Your Intelligence" hackathon (September 27, 2026).

**▶ Demo video:** _Loom link coming_ · **Judges:** [`docs/SUBMISSION.md`](docs/SUBMISSION.md) has the per-sponsor evidence, and [`docs/DEMO-SCRIPT.md`](docs/DEMO-SCRIPT.md) the walkthrough.

## Why it's useful

Before a company commits to something (signing a contract, filling out a security questionnaire, renewing SOC 2), someone has to answer three questions:

1. **What has actually been checked?**
2. **Which team still owes an answer?**
3. **What does nobody own?**

Today that lives in someone's head or a Slack thread. Mind Palace makes agents answer those questions under rules they can't talk their way around, and shows the whole run so a human can audit it in seconds:

- **Routes are checklists.** A task has an ordered list of stations (pages). The agent visits every one; it can't answer from half the context.
- **Ownership is enforced.** Each room belongs to a team. An agent that reaches a room it doesn't own must stop at the door and send a handoff to that team's agent.
- **An agent can't cite a room it never walked into.** Before an answer posts, the protocol service checks every citation against the stations that agent actually visited. Ungrounded answers are blocked, and the agent has to go back and do the work.
- **Every claim needs a quote.** At each station a Claude judge decides whether the page actually answers the question and records an exact quote. The final answer is split into claims, and any claim without a supporting quote from a verified page is blocked (e.g. "liability cap 2x" when the page says 1x).
- **Gaps are loud.** An empty or missing station is reported as a gap ("no SOC 2 owner recorded"), never filled in with a guess. Gaps land on a Loose Ends board for a human to answer.

What it does *not* claim: a page's position in the building doesn't change how it's retrieved; the building is how you see and audit the run. Without an Anthropic key, verification falls back to rules (blank fields, freshness) and says so (`judge: "rules"`).

## Quick start (recorded demo, no keys, no network)

Requires [Bun](https://bun.sh).

```sh
bun install
bun run validate          # checks fixtures against the schemas
bun run dev               # Vite on http://localhost:5173
open "http://localhost:5173/?demo&hold"
```

`?demo` replays recorded runs from `fixtures/replays/`; `&hold` waits for you to start one. Pick a specific recording with `?demo=<name>`:

| Replay | What it shows |
| --- | --- |
| `qm-contract` | Real QM run: three Claude agents on "Can we sign the Gripworks contract this week?" Legal's first answer is **blocked** for citing a room it never visited; it goes back and answers correctly. |
| `quest-security-questionnaire` | A commissioned agent works across 4 departments: 20 handoffs, 2 gaps, 4 stale pages, and a learned route that cuts 13 stations to 7. |
| `demo-1` | Scripted department demo: a claim wait, a handoff and the SOC 2 gap in about 20 seconds. |
| `ufo-contract` | The same protocol driven from the UFO harness instead of QM. |
| `gym-legal` | Steps from a real River RL job on the Legal specialist. |

### Controls

| Input | Does |
| --- | --- |
| **T** | Legal, Finance and Eng each get a task |
| **N**, then **▶ Commission** | Spawn a new agent for a task you type |
| **↻ Replay** / **R** | Replay the last run / run the contract task again (explore, then learned route) |
| **1–4** or click an agent | Follow it; its route and checklist appear |
| **Esc** / **0** | Back to the overview |
| Click a glowing block | Open that page and its links |
| **/** | Ask bar: a single retrieval walk |
| Drag, right-drag, scroll, WASD | Pan, turn, zoom |

URL flags: `&speed=1` (recorded timing), `&links` (show page links), `&walk` (first-person camera), `&debug` (fps and draw-call overlay).

## Running live agents

Four processes, in this order (the protocol service needs [uv](https://docs.astral.sh/uv/)):

```sh
bun run protocol                  # loci protocol service             :8790
SAVE_RUNS=0 bun run bridge        # /events, /dispatch, /commission   :8788
bun run ask                       # ask bar backend                   :8787
bun run dev                       # web                               :5173
open "http://localhost:5173/"
```

Every live button falls back to its recording if the bridge doesn't answer within 4 seconds. Drop `SAVE_RUNS=0` to save each run as a new replay.

Setup for each integration lives next to it:

- **QM agents:** `qm/README.md` and `qm/FORK.md` (stock QM plus our patch, three team-scoped agents).
- **UFO extension:** `ufo_ext_mindpalace/` and `docs/NOTES-ufo-ext.md`.
- **GBrain:** `bash fixtures/seed-gbrain.sh --fresh` builds an isolated brain inside the repo (never your personal `~/.gbrain`); start the ask server with `MP_GBRAIN_HOME` pointing at it. See `docs/NOTES-seed.md`.
- **River training:** `server/train/` and `docs/NOTES-training.md`.

## How it works

```
fixtures/seed-brain/*.md ──export──▶ fixtures/palace.json ──▶ web (three.js block world)
                                                                   ▲
QM agents ──┐                                                      │ GET /events
UFO agents ─┼──tools──▶ protocol service :8790 ──events──▶ bridge :8788
scripted ───┘           (ownership, claims, verdicts,
                         grounding check on answers)
```

- **Data contracts:** `server/schema.ts` defines `palace.json` (wings, rooms, memories, links, agents, routes) and the event stream (`task route move claim wait visit handoff reply answer train_step spawn phase artifact`). The renderer is a pure function of the event stream, which is why recordings and live runs look identical.
- **Protocol service** (`server/protocol/`, Python): the only place the loci rules live. Harnesses call its tools `visit`, `claim`, `handoff`, `reply` and `answer`; it enforces ownership, claim leases, verdicts and the grounding check, and emits every call as an event.
- **Harness adapters:** a QM fork (`qm/`, tools served over MCP by `qm/loci-mcp.ts`) and a UFO extension (`ufo_ext_mindpalace/`). They translate tool calls and contain no protocol logic.
- **Layout** (`server/layout.ts`): deterministic, so the same brain always produces the same building.
- **Web** (`web/src/`): the scene builds a runtime (`web/src/api.ts`), and agents, UI, walk, rooms and the flow panel are plugins on top of it.

## Sponsor tools

| Tool | How we use it |
| --- | --- |
| **GBrain** | The company brain: an isolated brain (96 pages, 180 typed links) seeded with Acme Robotics' pages. The loci retrieval skill reports gaps instead of guessing, and answers are grounded claim by claim. When a human answers a Loose End, it's written back to the page and `gbrain put` to the brain, then re-verified. `bun run gbrain:seed && bun run gbrain:stats`. |
| **QM** | The main harness. Our fork gives each team-scoped QM agent the loci tools. **Handoffs wake the owning team's QM agent, which replies itself.** The pre-post grounding gate blocks answers that cite unvisited stations or skip route stations. See `qm/FORK.md`, `docs/NOTES-qm-multi.md`, `?demo=qm-contract`, `?demo=qm-handoff`. |
| **UFO** | Second harness, same protocol: an extension exposing the loci tools. A UFO agent on Claude completed the contract route (`?demo=ufo-contract`). The Loose End loop is the business automation: a gap goes to the owning team, a human replies, the page updates, and the station re-verifies. |
| **River AI** | Department agents fine-tuned on Qwen3.5-9B from their own verified runs, with the palace's grounding check as the metric and the promotion gate. The 🏋 Gym leaderboard shows the Legal ladder: base 90% grounded; gen1 regressed to 20% and was not promoted; gen2 is training on River. Real job ids are in `fixtures/river-runs.json` and `docs/NOTES-river-serve.md`. The Gym's in-quest training steps are a labelled local sim. |
| **Memorable** | The learned-route store. Successful runs are ingested via `/v1/extract`, and new tasks recall a matching route (`memorable-cli`). `bun run memorable:demo "Fill out the security review Northwind sent us"` recalls the 7-station security-questionnaire route. |
| **Superset** | Where it was built: one Superset workspace ran an integrator agent that coordinated about 20 parallel Claude Code agents in git worktrees, merged through 23 PRs (`git log --merges`). |

## Repo layout

```
docs/SPEC.md          original build spec
docs/SUBMISSION.md    per-sponsor evidence and honest limits
docs/DEMO-SCRIPT.md   timed walkthrough script
docs/DEMO-PLAN.md     demo plan and build list
docs/NOTES-*.md       each build agent's notes and lessons
DEMO.md               stage runbook
CLAUDE.md             rules every build agent followed
fixtures/             seed brain, palace.json, replays, learned routes
server/               exporter, layout, ask, bridge, routes, commission quests, protocol service + judge,
                      GBrain write-back, Memorable client, doc importer, River training/serving
qm/                   QM fork patch and MCP tool server
ufo_ext_mindpalace/   UFO extension
web/src/              three.js scene, agents, UI, rooms, flow panel
```

## Development

```sh
bun run validate     # zod and referential checks on every fixture
bun run typecheck    # tsc
bun run export       # rebuild fixtures/palace.json from the seed brain
```

The demo runs on a fictional company, Acme Robotics. No real people or real company data.
