# Agent Palace — Hackathon Build Spec

Sep 27, 2026 · @Prerit

## Overview

Agent Palace renders a company's shared brain as a walkable 3D memory palace, and shows a team of agents working inside it at once. Each wing belongs to a team (Finance, Legal, Eng, People), and each team's agent walks the palace to fetch, verify and hand off information. Memory champions have used the method of loci for 2,500 years; here it becomes the protocol agents use to retrieve correctly and coordinate.

The demo moment: three agents get tasks at the same time. You watch them fan out through the palace, walk fixed routes station by station, meet at a shared room, hand off a question to the agent that owns it, and flag a gap when a station comes up empty instead of guessing.

Why the loci technique matters for agents, not just for looks:

- **Routes as checklists.** A task type has a canonical route: an ordered list of stations. An agent must visit every station, so it can't skip the approvals room and answer from half the context.
- **Empty stations are loud.** A missing memory at an expected station is flagged as a gap, not papered over with a hallucination.
- **Place encodes ownership.** Rooms carry a team owner, matching QM's scoped memory and permissions. An agent that reaches a room it doesn't own asks the owner's agent rather than reading around the permission.
- **Markers coordinate work.** Agents leave claims and notes at stations. Another agent arriving sees "Finance agent is verifying this" and waits or moves on, so two agents never duplicate a task.

Hard constraints:

- **Time box:** hacking runs 1:15 to 5:00 PM (about 3.75 hours). Anything not demoable by 4:30 is cut.
- **Stack:** TypeScript, Vite, three.js, Bun. Runs in a browser against our QM fork, which orchestrates the agents; a small Bun server bridges QM to the palace.
- **Data:** GBrain holds the company brain as Markdown pages in a Git repo, with typed links. The demo runs on a seeded fake company, never real data.
- **Sponsors:** GBrain is the memory; QM is the core harness: we fork it, and the team agents are QM agents. Our fork adds three things to the harness: a palace UI plugin, cross-scope handoffs, and harness-enforced grounding. Memorable supplies learned routes. River trains team specialists in the Gym. UFO gets a Agent Palace extension and is QM's fallback harness. Superset is how we build.
- **Non-goals:** real auth, mobile, VR, editing memories by hand inside the palace.

## Side quests we're targeting

One project, entered for five side quests; each has a room or feature that owns it and evidence ready at judging.

| Side quest | What we show | Owned by | Evidence at judging |
| --- | --- | --- | --- |
| Superset: Best Agent Swarm | The whole palace built by 6 parallel Superset agents | The build process itself | Screen recording of the swarm, merge history, per-workspace PRs |
| Memorable: Most Memorable | Routes that are learned, not written: run 1 wanders, run 2 walks a clean route | Loci protocol step 1, the Workshop | Side-by-side replay: hops and tool calls, run 1 vs run 2 |
| GBrain: new skill or memory improvement | A loci retrieval skill: route-based lookup that reports gaps instead of guessing | `loci-protocol` skill, the Loose Ends room | The skill file + a gap caught live |
| River AI: best custom model | Team-specialist agents trained in the Gym on the company's own runs: SFT specialists plus RL with the palace as the environment | The Gym | Live RL job with reward climbing, per-team scoreboard vs base and frontier |
| QM: fork it, do something new | A QM fork where the harness itself gains a palace UI plugin, cross-scope handoffs and grounding enforcement | Orchestrator | The fork's diff, a task sent from Slack walking the palace, an ungrounded answer blocked live |

UFO (best extension, best business automation for startups): one Agent Palace extension for UFO that adds loci tools, a GBrain connector, the palace as a surface, and River specialists as a model provider. Evidence: a UFO agent in Slack walking the palace, and a Loose End posted to the owning team and answered by a human, writing the page back to GBrain.

## Demo script

Every feature exists to serve this 90-second walkthrough; build nothing it doesn't show.

1. **0:00 Hook (spoken).** "Memory champions memorize decks of cards by walking an imagined building. We gave a company's agents the same building, and the same technique."
2. **0:10 Enter.** Foyer of Acme Robotics' palace. Four wings, each lit in its team color: Finance, Legal, Eng, People.
3. **0:20 Tour.** Walk into the Legal wing. Memories glow on pedestals; stale ones are dim and dusty. Click one to read the page and its links.
4. **0:35 Dispatch.** Press `T` to send three tasks at once, e.g. "Can we sign the Gripworks contract this week?", "What did we promise Ada in the last board meeting?", "Who owns the SOC 2 renewal?"
5. **0:40 Fan out.** Three agent avatars (Legal, Finance, Eng) leave the foyer. Each walks its route, lighting stations in order with a step label. A side feed logs every visit.
6. **0:55 Coordination.** The Legal agent's route hits the Budget room in Finance's wing. It stops at the door, sends a handoff; the Finance agent detours, verifies the budget line, and returns the answer. A beam connects them during the handoff.
7. **1:05 Gap.** The Eng agent reaches the "SOC 2 owner" station and finds it empty. The station flashes amber: "gap: no owner recorded," and the agent reports that instead of guessing.
8. **1:15 Close.** Answers land in the feed with cited stations. "Every agent retrieves by route, respects who owns what, and says when memory is missing. You can see all of it, and you own all of it."

Extended cut (another 45 seconds, if judging allows):

- **1:25 Run it again.** Resend the contract task. Run 1's wandering trail fades; run 2 walks the Workshop's learned route in half the hops. "Memorable remembered how we did it."
- **1:40 Loose Ends.** Fly to the Loose Ends board: the SOC 2 gap is already pinned there under Eng.
- **1:50 The Gym.** Walk into the Gym: Legal's ghosts spar on the treadmill lanes while the reward climbs on the scoreboard. Switch Legal to its new checkpoint and dispatch once more. "The company now owns a model that knows its own memory."

Backup plan: a recorded event log replays identically if live agents or the network fail. `?demo` loads it.

## Architecture

One GBrain feeds two paths: an export that builds the palace once, and an ask path that records which pages retrieval touched so the renderer can replay them as a walk.

&#91;embedded content: Agent Palace pipeline · build path and ask path\]

The exporter and the ask server are the only code that knows GBrain exists; the renderer only reads `palace.json` and `trace.json`, so frontend agents can work against fixtures from minute one.

Repo layout:

```
agent-palace/
  CLAUDE.md                 # this spec, condensed; read first
  .claude/skills/           # custom skills (see below)
  fixtures/
    seed-brain/             # ~60 Markdown pages, fake people/companies/ideas
    palace.json             # generated, committed for frontend work
    traces/*.json           # 3 canned retrieval traces for the demo
  server/
    export.ts               # GBrain -> graph -> layout -> palace.json
    layout.ts               # wing/room/pedestal placement, deterministic
    ask.ts                  # Bun HTTP: POST /ask -> answer + trace
  web/
    index.html
    src/main.ts             # boot, load palace.json
    src/scene/              # rooms, pedestals, corridors, lighting
    src/controls.ts         # pointer-lock WASD + click picking
    src/walk.ts             # trace replay: orb path, room highlights
    src/ui/                 # memory panel, ask bar, answer panel
```

The multiplayer layer replaces the Bun ask server with our QM fork: QM runs the team agents, and a bridge streams their events to the browser over Server-Sent Events at `GET /events`. The renderer draws one avatar per agent and replays the stream.

## Multiplayer: agents in the org palace

Three team agents share one palace, and the loci protocol below is what keeps their retrieval correct and their work from colliding.

**The loci protocol** (every agent follows it, enforced by the orchestrator, not by prompting alone):

1. **Pick a route.** Routes are learned, not written. The orchestrator asks Memorable for a stored workflow matching the task. If one exists, that becomes the route: an ordered list of stations (memory IDs). If not, the agent explores, Memorable records the successful path, and the next similar task walks it directly. Hand-authored routes are only a fallback. Example: `contract-signoff` = Vendor profile, Contract terms, Budget line, Legal approval, Signatory.
2. **Walk in order.** The agent visits each station, reads that page, and records a verdict: `verified`, `stale` (freshness under 0.3), or `gap` (page missing or silent on the question).
3. **Respect ownership.** Each room has an owning team. At a room it doesn't own, the agent emits a `handoff` to the owner's agent with a specific question, then waits for the `reply` before continuing.
4. **Claim before working.** On arrival the agent places a `claim` marker at the station. Another agent that arrives sees the claim and either waits for the result or skips to its next station.
5. **Answer only from verified stations.** The final answer cites stations; any `gap` or `stale` verdict is stated in the answer, never filled in.

**Agents for the demo:** three QM agents, Legal, Finance and Eng, each scoped to its wing. People wing is shared read-only. Their tools are `visit(memoryId)`, `claim(memoryId)`, `handoff(agent, question)`, `reply(handoffId, answer)` and `answer(text, citations)`, implemented in the fork so the harness executes them and emits events.

## The QM fork: pushing the harness

We fork QM and make the protocol part of the harness, so it holds for any agent QM runs, not just ours. QM is a multiplayer agent harness where each employee and project room gets isolated memory, files, permissions and a sandbox, and its web UI and Slack are plugins over one API ([QM](https://qm.ycombinator.com/)). Our fork adds three things:

1. **Palace UI plugin.** A third interface next to Slack and the web UI: the palace reads QM's real agents, rooms and memory through the same API. Wings map to QM scopes; the org chart becomes a building.
2. **Handoffs as a harness primitive.** A first-class cross-scope request: an agent asks another team's agent a specific question, and the harness checks permissions, threads it, logs it, and shows it in Slack and the palace. Claims (leases on a station or task that expire) ship as part of this primitive.
3. **Harness-enforced grounding.** Before any answer posts, the harness checks every citation against the stations that agent actually visited in this run, with verdict `verified`. Uncited or unvisited claims are blocked or annotated, and gaps must be stated. The prompt explains the rule; the harness enforces it.

Every answer QM posts to Slack also carries a replay link to the palace, using QM's shareable artifacts. Longer term, every QM agent's runs become domain-labeled training data for its team's specialist in the Gym.

**Setup risk and fallback.** QM is cloud-first and deploys to your own infrastructure with its own Postgres. The `qm-fork` agent's first job is getting stock QM running locally or on Fly; this is gated at 2:15. If QM isn't running by then, the demo switches to UFO (below), which runs as one process on SQLite. Because both harnesses call the same protocol service and emit the same `/events` stream, nothing downstream changes, and the QM fork's diff is shown as work in progress.

## The protocol service and the UFO extension

The loci protocol lives once, in a small harness-neutral service, and each harness gets a thin adapter: the QM fork and a UFO extension. One core, two side-quest entries, and a real harness either way.

**Protocol service** (`server/protocol/`, Python, HTTP on port 8790): implements `visit`, `claim`, `handoff`, `reply` and `answer`, including ownership checks, claim leases, verdicts and the grounding check, and emits every call to `/events`. Python so it shares code with the Gym. Adapters never re-implement protocol logic; they only translate tool calls.

**UFO** is an open-source runtime for business agents: teams give agents work in chat, and agents read files and run commands in a sandbox. It runs as one process on SQLite and local files with no Docker, turns are durable workflows, and everything is an extension: tools, connectors, subagents, surfaces, model providers and sandbox carriers. An extension is a Python package that imports only `ufo.sdk` and declares one entry point ([ufo-core](https://github.com/ufo-ai/ufo-core)). The repo is brand new, so expect rough edges.

Our extension, `ufo_ext_mindpalace`, uses four extension points:

1. **Tools:** `visit`, `claim`, `handoff`, `reply`, `answer`, each forwarding to the protocol service. Any UFO agent follows the loci protocol.
2. **Connector:** GBrain as the memory the agent walks, scoped per team.
3. **Surface:** the palace as a UFO surface next to Slack, web and terminal, with a replay link on every answer.
4. **Model provider:** Gym-trained River checkpoints served to UFO agents, so a team's agent can run on its own specialist.

**Business automation for startups:** Loose Ends becomes a loop. Each `gap` verdict posts to the owning team's channel as a question for a human; the human's reply is written back to the GBrain page, and the next agent that visits that station finds it verified. The pitch: your agents find out what your company doesn't know, and close the gap.

## Special rooms: the palace as the company's operating system

Beyond the team wings, five special rooms turn the palace from a visualization into something a company would run every day. Each is tiered: Tier 1 is in the demo, Tier 2 if time allows, Tier 3 is the pitch for where this goes.

### The Workshop (Memorable, Tier 1)

Where learned routes live. Each Memorable workflow is a lit path on the floor between stations, thicker the more it's been reused.

- Demo: rerun a task. Run 1's wandering trail fades; run 2 walks the Workshop's path in half the hops, and a counter shows hops and tool calls saved.
- Useful because every repeated question in a company gets cheaper and more consistent over time, and you can see which procedures the org actually relies on.

### The Loose Ends room (GBrain skill, Tier 1)

Every `gap` and `stale` verdict any agent hits lands here as a glowing card on a board, grouped by owning team.

- Demo: the SOC 2 gap from the Eng agent appears on the board live, tagged "Eng: no owner recorded."
- Useful because it's an automatic list of what the company doesn't know or hasn't updated, discovered by real work instead of audits. Tier 2: each card becomes a task a human claims, and answering it writes the page back to GBrain.

### The Gym (River AI, Tier 2)

The company's team agents come to the Gym to get better at their own jobs, trained on the company's own agent runs. River fits this directly: its API does LoRA fine-tuning (SFT), reinforcement learning with tools and environments, and multi-teacher distillation, all driven from a Python client ([River docs](https://docs.river.ai/)).

**Where the training data comes from.** Every run in the palace, whether from our orchestrator or later from QM agents, is logged as a trajectory: the task, the team (domain label), every tool call (visit, claim, handoff, answer), each station's verdict and the final answer. For the hackathon: orchestrator replays plus about 300 synthetic tasks per team generated from the seed brain, each with its ground-truth route, answer and any expected gap.

**The stations** (each is a physical area of the Gym room):

1. **Weight rack: team specialists (SFT).** One LoRA adapter per team (Legal, Finance, Eng), trained on that team's verified runs: input = task + station list, target = the correct route and cited answer. Each saved checkpoint is a plate on that team's rack. River's own quickstart learns a small pattern in about 15 steps, so a specialist is a short job.
2. **Sparring ring: learning the loci protocol (RL).** The palace itself is the RL environment. River lets you declare tools with a decorator and run multi-turn rollouts where your Python code executes the tools ([Tools and environments](https://docs.river.ai/guides/rl-tools/)). Our tools are `visit`, `claim`, `handoff` and `answer`; the reward is programmatic because we have ground truth:
   - +1 for a correct answer that cites only verified stations
   - +0.5 for correctly reporting an expected gap; -1 for inventing content where a gap is
   - -0.25 per skipped station on the route; -0.5 for reading a room it doesn't own without a handoff

   River trains in groups: several attempts per task, rewards centered within the group, GRPO-style ([First RL run](https://docs.river.ai/guides/rl-sync/)). In the room, each attempt is a ghost avatar running a miniature palace model on a treadmill lane: 8 ghosts per task, the best ones glowing green.
3. **Team practice: one company agent (distillation, Tier 3).** River's multi-teacher distillation routes each task to its domain's specialist and trains one student across all of them, keeping the domain mix explicit and scoring each domain separately ([Multi-teacher distillation](https://docs.river.ai/guides/distillation-multi-teacher/)). The three team specialists coach one generalist company agent.
4. **Scoreboard: personal records.** Held-out tasks per team, scored for base model, each checkpoint and the frontier planner on the same metrics: correct answers, protocol compliance (no skipped stations, gaps reported), and latency. The best score per team is its PR on the board.

**Demo moment:** the Legal agent walks into the Gym, steps onto the treadmill, and its ghosts spar through the mini-palace while the reward climbs on the scoreboard. It walks out with a level badge, and its next task runs on the new checkpoint.

**Useful because** each team ends up owning a model trained on how that team actually works, rewarded for retrieving correctly and admitting gaps. That's "own your intelligence" at the company level. If training doesn't finish by 4:15, show the dataset, the live job's metrics and the eval harness.

### The Archive and its gardener (Tier 2)

Stale memories drift to a dim Archive wing. A gardener agent walks it on a schedule, re-verifies pages against newer ones, and either refreshes them or flags a Loose End.

- Useful because memory rots silently; this makes decay visible and gives it a caretaker.

### The Onboarding tour (Tier 3)

A new hire gets a guided walk along the routes their team uses most, with the memory-athlete memorize mode for key facts.

- Useful because onboarding is the most expensive knowledge transfer a company does, and a palace makes it spatial and memorable.

Tier 3 pitch lines for the closing (not built): palaces per team that link through shared corridors; an agent's route replay attached to every answer it posts in Slack; one palace per customer for support agents.

## Data contracts

Two JSON files are the only interface between backend and frontend agents; freeze them in the first 20 minutes and change them only by agreement.

`palace.json` (written by the exporter, read by the renderer). All positions are in meters, y is up, and layout is deterministic for the same brain.

```json
{
  "version": 1,
  "generatedAt": "2026-09-27T13:30:00Z",
  "wings": [
    { "id": "people", "label": "People", "color": "#7aa2f7",
      "origin": [0, 0, -20], "rooms": ["room-people-0"] }
  ],
  "rooms": [
    { "id": "room-people-0", "wing": "people", "label": "People A-F",
      "center": [0, 0, -20], "size": [12, 4, 12],
      "doors": [{ "to": "foyer", "pos": [0, 0, -14] }] }
  ],
  "memories": [
    { "id": "people/ada-chen", "title": "Ada Chen", "type": "person",
      "room": "room-people-0", "pos": [-4, 1.1, -22],
      "freshness": 0.85, "excerpt": "Robotics founder, met at YC dinner...",
      "path": "people/ada-chen.md" }
  ],
  "links": [
    { "from": "people/ada-chen", "to": "companies/gripworks", "kind": "founded" }
  ]
}
```

- `memory.id` = the GBrain page slug (path without `.md`). Everything else keys off it.
- `freshness` is 0 to 1, from the page's last git commit date: 1 = today, 0 = 180+ days. Drives glow and dust.
- `type` is kept for icons; the wing is the owning team, from a page's team frontmatter (finance, legal, eng). Pages with no team go to the shared People wing.

`trace.json` (written by `POST /ask`, read by the walk animator). Hops are ordered in the sequence retrieval actually touched them.

```json
{
  "question": "Who should I intro to the robotics founder?",
  "hops": [
    { "step": 1, "memoryId": "people/ada-chen", "reason": "keyword match: robotics founder", "score": 0.91 },
    { "step": 2, "memoryId": "companies/gripworks", "reason": "graph link: founded", "score": 0.74 },
    { "step": 3, "memoryId": "people/raj-patel", "reason": "graph link: investor in similar", "score": 0.69 }
  ],
  "answerMemoryIds": ["people/raj-patel"],
  "answer": "Raj Patel. He invested in two grasping-robotics companies..."
}
```

Open question for the backend agent: how GBrain exposes the pages a query touched. Check the `gbrain` CLI help and its MCP tools first. If it only returns final results, build the trace from the ranked results plus one-hop graph expansion, and label hops honestly in `reason`.

Multiplayer additions to `palace.json`: `owner` on every wing and room, plus top-level `agents` and `routes`.

```json
{
  "agents": [
    { "id": "legal", "label": "Legal agent", "team": "legal", "color": "#bb9af7", "home": "room-legal-0" }
  ],
  "rooms": [
    { "id": "room-finance-1", "wing": "finance", "owner": "finance", "label": "Budgets" }
  ],
  "routes": [
    { "id": "contract-signoff", "label": "Contract sign-off",
      "stations": ["companies/gripworks", "legal/gripworks-msa", "finance/budget-2026-q4", "legal/approvals", "people/signatories"] }
  ]
}
```

`GET /events` streams one JSON object per line (also saved as `fixtures/replays/demo-1.jsonl` for `?demo`). The renderer is a pure function of this stream.

```json
{ "t": 4.2, "agent": "legal", "type": "move", "to": "room-finance-1" }
{ "t": 5.0, "agent": "legal", "type": "handoff", "id": "h1", "toAgent": "finance", "memoryId": "finance/budget-2026-q4", "question": "Is Gripworks within Q4 budget?" }
{ "t": 5.1, "agent": "finance", "type": "claim", "memoryId": "finance/budget-2026-q4" }
{ "t": 6.8, "agent": "finance", "type": "visit", "memoryId": "finance/budget-2026-q4", "verdict": "verified" }
{ "t": 7.3, "agent": "finance", "type": "reply", "id": "h1", "answer": "Yes, $40k of $55k allocated." }
{ "t": 9.0, "agent": "eng", "type": "visit", "memoryId": "eng/soc2-owner", "verdict": "gap", "note": "no owner recorded" }
{ "t": 12.4, "agent": "legal", "type": "answer", "text": "...", "citations": ["legal/gripworks-msa", "finance/budget-2026-q4"] }
```

Event types: `task`, `route`, `move`, `claim`, `visit` (with `verdict`), `handoff`, `reply`, `answer`. `t` is seconds since dispatch; the replay can speed it up to fit 15 to 25 seconds on stage.

## Components and acceptance criteria

Each component is done when its checkboxes pass on the seeded brain; the agent that owns it checks them off in its PR description.

### 1. Seed brain (`fixtures/seed-brain/`)

About 60 Markdown pages for a fake company, Acme Robotics, split across Finance, Legal, Eng and a shared People wing, with realistic cross-links and varied commit dates so freshness spans the range. Include the 3 demo routes and one deliberate gap (no SOC 2 owner recorded).

- [ ] `gbrain init` + `gbrain import fixtures/seed-brain` succeeds
- [ ] Every page links to at least 2 others; no real people's names
- [ ] The 3 demo questions each have a clear 3 to 5 hop answer path

### 2. Exporter + layout (`server/export.ts`, `server/layout.ts`)

Reads the brain, builds the graph, places it, writes `palace.json`.

- [ ] One foyer at origin with 4 wings radiating from it (N/E/S/W)
- [ ] Rooms hold at most 12 memories; overflow creates the next room in that wing, joined by a door
- [ ] Pedestals on a ring or grid inside each room, never overlapping walls or doors
- [ ] Same input produces byte-identical output (sorted IDs, no randomness without a fixed seed)
- [ ] Runs in under 5 seconds on the seed brain

### 3. Renderer (`web/src/scene/`, `web/src/controls.ts`)

three.js, first-person, loads `palace.json`.

- [ ] Pointer-lock WASD + mouse-look, collision with walls, 60 fps on a laptop
- [ ] Rooms are low-poly boxes with wing-colored trim and a floating room label
- [ ] Memories are glowing objects on pedestals; emissive intensity = `freshness`; stale ones get a dust particle haze
- [ ] Links render as thin light beams between pedestals, brightening when you approach either end
- [ ] Clicking a memory opens a side panel with title, excerpt and linked memories (clickable to fly there)
- [ ] Minimap in a corner showing wings and your position

### 4. Ask server (`server/ask.ts`)

Bun HTTP on port 8787.

- [ ] `POST /ask {question}` returns `trace.json` shape within 8 seconds
- [ ] Answer generated from the retrieved pages only, citing `answerMemoryIds`
- [ ] `GET /palace` serves the latest `palace.json`
- [ ] Falls back to the matching canned trace in `fixtures/traces/` on any error

### 5. Retrieval walk (`web/src/walk.ts`, the hero feature)

- [ ] Ask bar opens on `/`; submitting dims the palace to 30%
- [ ] Camera leaves pointer-lock and follows a guide orb along a path through doorways (not through walls) from hop to hop
- [ ] Each hop's memory flares and shows a floating label: step number + `reason`
- [ ] Visited rooms stay lit; the path leaves a fading light trail
- [ ] Final hop opens the answer panel; `Esc` returns control to the player
- [ ] Whole walk takes 8 to 15 seconds regardless of hop count

### 5a. QM fork (`qm/` as a forked checkout, plus `server/bridge.ts`)

- [ ] First: read QM's repo docs on plugins, tools and scopes before writing any code; record the extension points found in `docs/NOTES-qm-fork.md`
- [ ] Stock QM runs (locally or on Fly) by 2:15, with three agents scoped to Legal, Finance and Eng rooms
- [ ] Tools `visit`, `claim`, `handoff`, `reply`, `answer` added to the fork as thin adapters to the protocol service (no protocol logic in the fork)
- [ ] Handoff primitive: permission check, threaded request and reply, visible in Slack and emitted as events
- [ ] Claims: leases with expiry; a second agent visiting a claimed station waits for the verdict
- [ ] Grounding check runs before any answer posts; a test answer citing an unvisited station is blocked
- [ ] `server/bridge.ts` turns QM's activity into `/events` lines and saves each run as a `.jsonl` replay
- [ ] Answers posted to Slack include a palace replay link
- [ ] Fallback path proven: with QM down, the UFO path emits the same events from the same protocol service

### 5c. Protocol service + UFO extension (`server/protocol/`, `ufo_ext_mindpalace/`)

- [ ] First: read `spec.md`'s extension-system section and `extensions/sample` in ufo-core before writing any code; note the tool, connector, surface and model-provider contracts in `docs/NOTES-ufo-ext.md`
- [ ] Stock UFO runs (`make install`, `make init`, `make serve` on SQLite) by 2:15
- [ ] Protocol service passes its own tests: ownership refusal, claim wait, gap verdict, blocked ungrounded answer
- [ ] UFO extension installs and exposes the five tools; a UFO agent completes the contract-signoff route
- [ ] GBrain connector reads pages scoped to the agent's team
- [ ] Loose End loop: a gap posts to the owning team's channel; a reply writes the page back and the station re-verifies
- [ ] Stretch: palace surface, and River checkpoints as a model provider
- [ ] Fallback proven: with QM down, the demo runs end to end on UFO with the same `/events` stream

### 5b. Presence layer (`web/src/agents/`)

- [ ] One avatar per agent: a glowing orb in team color with a floating name tag, pathing through doors
- [ ] Station states render live: claimed (ring in agent color), verified (green flare), stale (dim amber), gap (pulsing amber with note)
- [ ] Handoffs draw a beam between the two avatars until the reply lands
- [ ] Side feed lists events in plain words ("Legal asked Finance: is Gripworks within budget?")
- [ ] Camera modes: free walk, follow one agent (keys 1 to 3), and an overhead view showing all agents at once
- [ ] The replay renders identically at 1x and 3x speed

### 6. Stretch: memorize mode

The memory-athlete tie-in. Only start after 5 is demo-ready.

- [ ] Paste 10 facts; the agent writes them as pages and places each in the palace with a vivid one-line image ("a giant brass key for the Series A date")
- [ ] Guided walk along the route, then a recall quiz where the player names each fact at its pedestal

### 7. Learned routes, Workshop and Loose Ends (`server/routes.ts`, `web/src/rooms/`)

- [ ] Orchestrator asks Memorable for a matching workflow before each task; falls back to exploration, then to hand-authored routes
- [ ] After a successful run, the station path is recorded to Memorable (or to `fixtures/learned-routes.json` if Memorable is unavailable, same shape)
- [ ] Workshop room renders learned routes as floor paths, width by reuse count
- [ ] Run 2 of a task shows fewer hops than run 1, with a hops and tool-calls counter
- [ ] Loose Ends room shows every `gap` and `stale` verdict as a card grouped by team, updating live

### 8. The Gym (River AI) (`server/train/`, Python, Tier 2)

Training runs in a separate Python process (River's client is Python: `pip install river-client`) that posts progress to the orchestrator as `train_step` events.

- [ ] `trajectories.py` converts replays + synthetic tasks into per-team datasets with a `domain` field; 30 held-out tasks per team
- [ ] `sft.py` trains one LoRA specialist per team and saves each with `save_weights(..., mode="inference")`
- [ ] `palace_env.py` implements an `rl.Env` whose tools call the orchestrator's `visit`, `claim`, `handoff` and `answer`, with the reward in the Gym section
- [ ] `rl.py` runs the RL loop for one team first (Legal), starting from its SFT checkpoint; logs `reward/mean` per step
- [ ] `eval.py` scores base, each checkpoint and the frontier planner on held-out tasks per team
- [ ] Orchestrator can switch any team's planner to its River checkpoint at runtime
- [ ] Gym room renders: weight rack (checkpoints per team), treadmill lanes (ghost rollouts from `train_step` events), scoreboard with PRs
- [ ] First step before anything else: check which base models the key can use (River's Models and access page) and pick the smallest capable one; the RL guide uses `Qwen/Qwen3.5-9B`

## Superset parallel agent plan

Seven agents run in parallel Superset workspaces, each on its own branch and worktree, with file ownership split so they never edit the same files. You act as the integrator: review diffs in Superset, merge to `main` in the order below.

**Phase 0 (you, 15 min, before spawning anything):** scaffold the repo, commit `CLAUDE.md`, both JSON contracts, the skills folder and a hand-written 10-memory `fixtures/palace.json`. Every agent branches from this commit.

| Workspace | Agent's job | Owns (only edits these) | Starts from | Merge |
| --- | --- | --- | --- | --- |
| `seed` | Seed company brain, fallback routes, canned run-1 and run-2 replays, synthetic questions | `fixtures/` | Contracts | 1st, \~2:00 |
| `export` | Exporter + layout, owners, routes | `server/export.ts`, `server/layout.ts` | Stub palace, then `seed` | 2nd, \~2:45 |
| `scene` | Rooms, pedestals, links, lighting, controls | `web/src/scene/`, `web/src/controls.ts`, `web/src/main.ts` | Fixture palace | 3rd, \~3:00 |
| `ufo-ext` | Protocol service, UFO extension, Loose End loop | `server/protocol/`, `ufo_ext_mindpalace/` | Contracts; stock UFO running by 2:15 | 4th, \~3:10 |
| `qm-fork` | Fork QM: tool adapters to the protocol service, handoffs in Slack, palace plugin, bridge to `/events`, Memorable learned routes | `qm/`, `server/bridge.ts`, `server/routes.ts` | Stock QM running by the 2:15 gate, then protocol service | 5th, \~3:20 |
| `presence` | Avatars, station states, handoff beams, feed, camera modes | `web/src/agents/`, `web/src/walk.ts`, `web/src/ui/` | Fixture palace + canned replay | 6th, \~3:45 |
| `training` | River datasets, SFT + RL jobs, eval, the Gym, Workshop and Loose Ends rooms | `server/train/`, `web/src/rooms/` | Fixture replays; start the River job by 2:30 | 7th, \~4:00 |

Rules every agent follows (put these in `CLAUDE.md`):

- Never edit files outside your "Owns" column. Need a change elsewhere? Write it in `docs/NOTES-<workspace>.md` and stop.
- Never change `palace.json` or `trace.json` shape. Propose changes in notes.
- Commit every 20 to 30 minutes with a message that says which checkbox passed. Keep Superset's screen recording running all afternoon: the swarm is itself a side-quest entry.
- Work against fixtures, not live services, until your merge slot.
- When done, run your skill's verification step and paste the output in the PR description.

After the `walk` merge, spawn one `polish` workspace for lighting, labels and the demo path, and keep `main` demo-ready from 4:15 on.

## Custom skills

Five skills go in `.claude/skills/<name>/SKILL.md` during Phase 0; each agent loads the one matching its workspace plus `palace-contracts`. Draft them from the text below, or have your first Claude Code session expand them.

```markdown
---
name: palace-contracts
description: Load before touching palace.json, trace.json, or any code that reads or writes them. Defines the frozen data contracts and ownership rules for Agent Palace.
---
# Palace contracts
- Schemas live in the spec's Data contracts section; copies in fixtures/.
- memory.id = GBrain page slug. Never invent another key.
- Positions are meters, y-up. Rooms are axis-aligned boxes.
- Never change a schema. Write proposals in docs/NOTES-<workspace>.md.
- Verify: `bun run validate` checks both fixtures against zod schemas in server/schema.ts.
```

```markdown
---
name: threejs-palace-scene
description: Load when building or changing the three.js palace: rooms, pedestals, link beams, lighting, controls, picking. Style and performance rules for Agent Palace.
---
# Palace scene
- Look: dark marble floor, low-poly walls, wing-colored trim, warm emissive memories. Calm, museum-at-night.
- One InstancedMesh per repeated object (pedestals, memory orbs). Target under 200 draw calls.
- Freshness: emissiveIntensity = 0.2 + 1.8 * freshness; freshness < 0.3 gets a small Points dust cloud.
- Link beams: thin additive-blended lines; opacity rises within 6 m of either end.
- Controls: PointerLockControls + simple AABB collision against room walls; doors are gaps.
- Picking: Raycaster on memory orbs only; click opens the side panel via a DOM event.
- Verify: load fixtures/palace.json, walk foyer to every wing, check fps counter stays >= 55.
```

```markdown
---
name: retrieval-walk
description: Load when working on the ask bar, trace replay, guide orb, camera path, or answer panel. The hero demo feature of Agent Palace.
---
# Retrieval walk
- Input: a trace.json. Output: a 8-15 s cinematic from the player's position to the answer.
- Path: foyer and door waypoints between hops (from palace.json rooms/doors), then a CatmullRomCurve3 through them. Never cut through walls.
- Timing: total 8-15 s, split evenly per hop; ease in/out at each memory.
- Per hop: flare the orb, show a sprite label "<step>. <reason>", keep the room lit.
- End: open answer panel with answer text and cited memories; Esc restores pointer-lock.
- Always works offline: `?demo` loads fixtures/traces/demo-1.json.
- Verify: replay all 3 canned traces; none clip through geometry; each ends on the answer memory.
```

```markdown
---
name: gbrain-bridge
description: Load when reading from GBrain: exporting pages and links, running queries, building retrieval traces for Agent Palace.
---
# GBrain bridge
- GBrain stores pages as Markdown in a git repo with typed links, plus a Postgres/PGLite index. Prefer the gbrain CLI and MCP tools over parsing internals; run `gbrain --help` first.
- Export: all pages -> {id, title, type, links[], excerpt (first 200 chars), lastCommit}.
- Freshness from `git log -1 --format=%cI -- <path>`.
- Traces: record every page retrieval touched, in order. If only final results are exposed, synthesize hops from ranked results + one-hop link expansion, and say so in each hop's reason.
- Never point at a personal brain. Demo runs on fixtures/seed-brain only.
- Verify: `bun run export` then `bun run validate`; `curl -XPOST localhost:8787/ask` with each demo question.
```

```markdown
---
name: loci-protocol
description: Load when writing agent prompts, orchestrator tools, or anything that decides how agents retrieve, claim, hand off or answer in Agent Palace.
---
# Loci protocol
- Retrieval is by route: an ordered list of stations. Visit every station, in order. No skipping, no answering early.
- Each visit records a verdict: verified, stale (freshness < 0.3), or gap. Never invent content for a gap.
- Ownership lives on rooms. Visiting a room you don't own is refused by the orchestrator; send a handoff with one specific question.
- Claim a station before reading it. If another agent holds the claim, wait for its verdict or move to your next station.
- The answer cites verified stations and states every gap or stale station in plain words.
- These rules are enforced in orchestrator code; prompts explain them but never are the only guard.
- Verify: run the 3 demo tasks; the replay must show one handoff, one claim wait, one gap, and three cited answers.
```

Also worth having each agent write one skill for its future self as the last step of its workspace: what broke, what it would do differently. That's on theme for a hackathon about agents that learn.

## Timeline and cut list

Features freeze at 4:15 no matter what; from then on only the demo path gets touched.

&#91;embedded content: Build timeline, 5 phases and 2 gates\]

If the 3:00 gate fails, the integrator stops merging new work and pairs agents onto `walk` until a canned trace replays on the fixture palace.

Cut in this order when behind (first to go at the top):

1. Slack replay links (the fork itself stays; if QM misses the 2:15 gate, run on UFO)
2. Archive gardener, Onboarding tour, memorize mode
3. RL in the Gym and the live checkpoint switch (keep SFT specialists and show the scoreboard instead)
4. Minimap, overhead camera, dust particles, link-beam fade
5. Live agents (demo runs on canned run-1 and run-2 `.jsonl` replays via `?demo`; the renderer can't tell the difference)
6. Third agent (two agents still show a handoff and a claim)

Never cut: the team wings, clickable memories, agents walking routes, one handoff and one gap. Those are the demo.
