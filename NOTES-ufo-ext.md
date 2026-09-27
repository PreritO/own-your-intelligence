# NOTES: ufo-ext (protocol service + UFO extension)

This ran as a Claude Code subagent in an isolated worktree, and no human was available to answer questions. The calls I made on my own are listed under **Decisions**.

## Status

- Protocol service `server/protocol/` on :8790. 18 pytest tests pass: ownership refusal, claim wait, lease expiry, gap (empty, silent, blank owner field), stale, grounding block, handoff grounding, Loose End write-back, HTTP + SSE, `/dispatch`, `/grounding`.
- `server/protocol/demo_run.py` produces `fixtures/replays/protocol-run.jsonl` (a new file). It passes `bun run validate` on the seeded palace (9 rooms, 68 memories). The run has 1 handoff, 1 claim wait, 1 gap (`eng/soc2-owner`: "no owner recorded"), 1 stale, and 3 cited answers, none of them blocked.
- Stock UFO ran at about 14:05 (`ufo-core@63ba388`, SQLite, `ufoctl serve` on :8710). It lives outside the repo in `../ufo-core` (`/Users/preritoberai/Desktop/projects/own-your-intelligence/ufo-core`).
- A UFO agent completed the contract-signoff route through `ufo_ext_mindpalace` twice:
  - with the `mindpalace-walker` model (scripted, no key);
  - with `claude-sonnet-5`, whose run log is in `server/protocol/examples/ufo-claude-contract-signoff.jsonl`.

  Finance's handoff reply came from a scripted finance walker running against the same service.
- Loose End loop proven through UFO:
  1. The eng walker hits the gap.
  2. `loose_ends.poll_once` posts it to #eng.
  3. A Claude turn in UFO calls `loose_end_resolve`.
  4. The page is written to the overlay, and the eng agent re-visits it and gets `verified`.

## Protocol service API (:8790)

POST bodies are JSON. Every body may carry `run`; the default is the current run.

| Call | Body | Result |
| --- | --- | --- |
| `POST /run` | `{run?}` | fresh run (with `tasks` it behaves like `/dispatch`) |
| `POST /dispatch` | `{tasks?:[{agent,text,route?}], tick?}` | fresh run; scripted agents walk the tasks in a thread. `route` = palace route id or bridge `PickedRoute {routeId,stations,source}` |
| `POST /task` | `{agent,text}` | |
| `POST /route` | `{agent,routeId,stations?,source?}` | |
| `POST /claim` | `{agent,memoryId,ttl?}` | `{ok}` / `{wait,heldBy}` / 403 `{refused,owner,handoffTo}` |
| `POST /visit` | `{agent,memoryId,question?}` | `{verdict,note,content,freshness,source}`; auto-claims; wait / 403 as above |
| `POST /handoff` | `{agent,memoryId,question,toAgent?}` | `{id,toAgent}` |
| `POST /reply` | `{agent,id,answer}` | 409 unless replier visited the station in this run |
| `POST /answer` | `{agent,text,citations}` | `{blocked,reasons,gaps,stale}`; the event carries `blocked: true` when refused |
| `POST /grounding` | `{agent,text?,run?}` | `{verdict: ok\|annotate\|block, text?, reason?, run, citations?}` |
| `POST /writeback` | `{memoryId,content,by}` | Loose End answer; the page goes to the overlay |
| `GET /events` | `?run=&replay=1` | SSE `data: <PalaceEvent>\n\n`, CORS `*`; replays the current run first |
| `GET /events.jsonl` | `?run=` | the run's events as JSONL |
| `GET /inbox` | `?agent=` | open handoffs addressed to the agent |
| `GET /handoff` | `?id=` | handoff status |
| `GET /loose-ends` | | open Loose Ends |
| `GET /state`, `/health`, `/palace` | | service state |

Integrator check against the `bridge.ts` expectations:

1. `GET /events`: SSE, CORS `*`. Matches.
2. `POST /dispatch {tasks:[{agent,text,route?}]}`: exists. `/run` and `/runs` with `tasks` do the same thing.
3. `POST /<tool>` for visit, claim, handoff, reply and answer: all exist. Also task and route.
4. `POST /grounding {agent,run?,text}` returns `{verdict,text?,reason?,run?}`:
   - `ok` when the agent's last `answer` passed.
   - `annotate` when it passed but the text omits gap or stale stations; the service appends them.
   - `block` when the answer was blocked or never went through `/answer`.

Rules enforced in `loci.py` (adapters hold no protocol logic):

- **Ownership:** a team's own rooms plus `shared` rooms. Anything else is refused, and the agent is moved to the door.
- **Leases:** 30 s by default. A lease is released when its verdict lands.
- **Verdict:** gap beats stale (freshness < 0.3), which beats verified. A page is a gap when it is empty, has a blank key field ("Owner: not recorded"), or its lead paragraph says the fact is not on record. Checked against all 68 seed pages: only `eng/soc2-owner` is a gap.
- **Answer:** every citation must be verified in this run by this agent or by a handoff reply, and every route station needs a verdict. Otherwise the answer is blocked.

## UFO contracts (from `spec.md` "Extension system" and `extensions/sample`)

- **Extension.** A Python package whose `ufo.extension` entry point returns `ufo.sdk.manifest.Manifest`. It may import only `ufo.sdk.*`.
- **Activation.** A deploy activates the manifests named by `[pack] name` in `ufo.toml`. A pack is a `ufo.pack` entry point returning `Pack(name, version, extensions=(...))`, and a pack name must not equal an extension name. The pack I shipped is `mindpalace_pack` = the stock `assistant` set + `mindpalace`. A trimmed set failed at boot, because the `memory` extension's actions need kinds that other extensions register.
- **Tools.** `ToolDef(name, description, input_model=<pydantic>, handler=async (ToolContext, args) -> ToolResult)`. `ToolContext.agent.name` identifies the UFO agent, which I map to the palace team (`mindpalace-legal` → `legal`, override with `MP_AGENT_MAP=chat=legal`).
- **Connectors.** `ConnectorProvider` is an OAuth broker, too heavy for this. UFO already ships a `gbrain` extension with `gbrain_folder`/`gbrain_git` *sources*, which sync markdown into UFO memory. Our "GBrain connector scoped per team" is the `gbrain_stations` tool (team-filtered view) plus `loci_visit`, the only way to read a page body.
- **Model providers.** `ModelSpec(id, provider, client=lambda spec, key: ModelClient, price, ...)`. A `ModelClient.complete(request)` yields `ModelStreamStart`, then `TextDelta` or `ToolCallStart`+`ToolCallDelta`, then `Usage`. The `mindpalace-walker` provider is implemented this way.
- **Surfaces.** `SurfaceSpec` + `SurfaceRoute`, mounted at `/surface/<name>`; Slack is a durable surface. Not built; see the to-dos. The terminal surface `/surface/ufo/<channel>` takes a text body with `Authorization: Bearer ~/.ufoctl/token` and header `x-ufo-model`. `scripts/mp_ask.py` uses it, so no Rust client is needed (cargo isn't installed here).
- **Jobs.** They need `candidates` built from the extension's own tables (migrations), so the Loose End poller runs standalone instead of as a UFO job.

## Exact commands that worked

```bash
# protocol service
uv run --project server/protocol python server/protocol/service.py          # :8790
(cd server/protocol && uv run pytest -q)
uv run --project server/protocol python server/protocol/demo_run.py          # -> fixtures/replays/protocol-run.jsonl
curl -XPOST localhost:8790/dispatch -d '{}'                                  # live scripted run (real time)

# stock UFO (outside the repo)
git clone --depth 1 https://github.com/ufo-ai/ufo-core ../ufo-core && cd ../ufo-core
uv sync                                                  # = make install minus pre-commit hook
UFO_ANTHROPIC_API_KEY=... uv run ufoctl init --email ufo-demo@example.com   # init refuses without a key
# extension
uv pip install --python .venv/bin/python -e <repo>/ufo_ext_mindpalace       # NOT plain `uv pip install` (went to conda base)
sed -i '' 's/^name = "assistant"/name = "mindpalace_pack"/' ufo.toml
cp <repo>/ufo_ext_mindpalace/scripts/mp_*.py .
.venv/bin/python mp_serve.py <repo>/.env        # maps ANTHROPIC_API_KEY -> UFO_ANTHROPIC_API_KEY, runs ufoctl serve (:8710)
.venv/bin/python mp_ask.py palace-legal mindpalace-walker "Can we sign the Gripworks contract this week?"
.venv/bin/python mp_ask.py palace-legal claude-sonnet-5  "Can we sign the Gripworks contract this week?"

# finance must reply to legal's handoff: run a finance walker against the same service
(cd ufo_ext_mindpalace && uv run python -m ufo_ext_mindpalace.walker finance "What did we promise Ada in the last board meeting?")
# Loose Ends
(cd ufo_ext_mindpalace && uv run python -m ufo_ext_mindpalace.loose_ends --watch)       # posts gaps to #team
(cd ufo_ext_mindpalace && uv run python -m ufo_ext_mindpalace.loose_ends --resolve eng/soc2-owner "Priya Nair owns it")
rm -rf server/protocol/.overlay    # reset write-backs, or the SOC 2 gap stays closed in the live demo
```

## Decisions

- **Stdlib HTTP server.** I used `ThreadingHTTPServer` instead of FastAPI, so the service has zero runtime dependencies and `uv run` needs nothing. pytest is a dev dependency.
- **Auto-claim on visit.** The service auto-claims when an agent visits without claiming. That is enforcement, not a bypass, and it keeps the thin adapters simple.
- **Move to the door on refusal.** A refused claim or visit emits a `move` to that room, so the palace shows the agent stopping at the door, but no claim or visit. There is no `refused` event type in the frozen schema.
- **Write-backs go to an overlay.** They go to `server/protocol/.overlay/` (gitignored), never into `fixtures/seed-brain` (seed owns it) and not into gbrain (the MCP server was down). The overlay beats seed-brain, which beats the palace excerpt.
- **Extra hop in the scripted demo.** The seed's `board-promises` route no longer shares a station with `soc2-owner`, so no claim wait would happen. `demo_run.py` gives Finance one extra explore hop (`people/org-chart`), emitted with `source: "explore"`, so the demo keeps one wait. This only happens in the default scripted run; bridge-dispatched routes are used as given.
- **Two harness-neutral extras.** The scripted walker policy is harness-neutral (`walker.py`, no ufo imports). The Loose End loop posts to a Slack webhook when `MP_SLACK_WEBHOOK_<TEAM>` is set, and otherwise to `server/protocol/runs/channels/<team>.log`.

## Integrator to-dos / proposals

- **Dependencies:** none for `package.json`. The Python projects are `server/protocol/pyproject.toml` (no deps) and `ufo_ext_mindpalace/pyproject.toml` (host UFO provides `ufo.sdk`).
- **Bridge fallback path.** The bridge's fallback spawns `uv run python server/protocol/demo_run.py` from the repo root. That works: `demo_run.py` reads `PROTOCOL_URL` and drives the live service, and in that mode it doesn't write the fixture.
- **Not done:**
  - a palace UFO surface (spec point 3, stretch);
  - River checkpoints as a model provider (the walker provider is the seam: swap `WalkerModelClient` for a River-served client);
  - a Slack surface for the Loose End channel (needs Slack app credentials).
- **UFO edits outside our repo.** UFO's `ufo.toml` and `.env` in `../ufo-core` were edited locally (pack name, generated secrets). Nothing is committed there.
