# NOTES — qm-fork

## QM gate: PASSED at about 14:20 (late). Three scoped QM agents ran live on claude-sonnet-5

- **What ran.** Stock QM `yc-software/qm@a5a3667` ran with a real model: the pi harness, `PI_MODEL=claude-sonnet-5` and the key from `.env`. It used the web surface with Postgres in Docker.
- **The three agents.** Each is a QM project scope with its own memory, files and sandbox:
  - legal = `group:web-project-7d89e9ed-…`
  - finance = `group:web-project-9e79ca02-…`
  - eng = `group:web-project-4db84b6c-…`
- **The connectors.** `loci-legal`, `loci-finance` and `loci-eng` are registered through the signed core admin API (`bun qm/qm-admin.ts setup`). They all point at `qm/loci-mcp.ts` (:8791), which forwards to the protocol service (:8790).
- **The protocol service isn't on origin yet.** ufo-ext's service was already running locally on :8790 from their worktree, and I used it as-is. My calls added events to their shared dev run. One probe of mine (`POST /answer`, citing `people/signatories`) emitted a blocked answer event into their run `ufo-loose-end-1`.

### What the live QM run showed
Seen with `bun qm/qm-admin.ts demo` and `curl -N localhost:8788/events`:

- **Legal**
  - Walked contract-signoff: `companies/gripworks` then `legal/gripworks-msa`, both verified.
  - Trying to claim `finance/budget-2026-q4` was **refused by the service**: "legal may not enter room-finance-1 (owned by finance); send a handoff".
  - It then called `loci-legal_handoff` to finance (event `h1`), and went on through `legal/approvals` and `people/signatories`.
  - Its answer passed.
- **Finance** walked board-promises (three stations verified) and answered.
- **Eng**
  - Walked soc2-owner: `eng/security-policy` was **stale**, and `eng/soc2-owner` was a **gap** ("page is empty").
  - Its first `answer` was **blocked live**: "eng/security-policy: verdict is stale, not verified; eng/soc2-owner: verdict is gap, not verified".
  - It re-answered citing only verified stations and stating the gap and the stale page, and that answer passed. In the second demo run, the legal and eng agents each had one blocked answer and then a corrected one.
- **The bridge** followed :8790 and streamed everything on :8788/events. It saved the runs to `fixtures/replays/run-*.jsonl`, which are now gitignored, and learned the routes into `fixtures/learned-routes.json`.

### Fork changes now running in the QM clone (`qm/patches/qm-fork.patch`)
1. **Scope-bound loci connectors** (`src/harness/agent-tools.ts`, MCP `execute`).
   - The harness refuses a call from one team's scope to another team's `loci-<team>_*` tool. This happened in the first run, when the legal agent called `loci-finance_handoff`.
   - It also injects `_qm: {scopeId, runId}`.
   - Scopes are mapped to agents through the `LOCI_SCOPES` env var: JSON `{scopeId: agent}`.
2. **`withGroundingCheck`** (`src/delivery/grounding-delivery.ts` + `src/wiring.ts`). It wraps QM's single `DeliveryStore`, so a delivery from a team scope goes through `POST :8790/grounding` first. The endpoint exists and fails closed.
   - **Not demonstrated:** web replies stream from session entries rather than deliveries, so this wrapper only acts on Slack and cross-scope posts, and Slack is off.
   - Live, the blocking is done by the service's `answer` check. The agent sees `isError` and must re-answer, and the palace shows `answer {blocked:true}`.

### Still open
- **Handoff reply loop.** `handoff` is logged and threaded in the protocol service, but nothing wakes the Finance QM scope to `reply`. That needs FORK.md §2 (a webhook or core route) plus Slack tokens.
- **Runs split in the bridge.** The service's run id changes, `t` resets, and ufo-ext is driving the same service at the same time. As a result the bridge splits a QM demo into several `run-*` files.
  - `qm/loci-mcp.ts` now sends the QM runId as `qmRunId`, not as `run`, so the three agents share the service's current run.
  - Set `LOCI_RUN=<id>` to pin one.
- **Model note.** The pi harness returns `finish_silently` after posting with the `web` tool, so `result.reply` is null. The answer lives in the web transcript and in the `answer` event.

## Demo commands (QM as the harness)

```bash
# 0. The protocol service on :8790 (ufo-ext) must be running.
# 1. QM, with a real model. Run from the QM clone. Its .env is a symlink to this repo's .env.
cd ~/Desktop/projects/qm-upstream
npm_config_legacy_peer_deps=false npm run build:connector-sdk
LOCI_SCOPES='{"group:web-project-7d89e9ed-fe85-4fc2-a2ab-df191ca041bc":"legal","group:web-project-9e79ca02-0f9a-4dc6-88ad-caa3fe90823c":"finance","group:web-project-4db84b6c-03c1-47a9-a92f-0c0d9fefcfb9":"eng"}' \
  PI_MODEL=claude-sonnet-5 node scripts/dev/cli.ts up --surface web   # portal :8129, core :8081
# 2. In this repo:
bun run qm:mcp                      # loci MCP adapter :8791 -> :8790
bun run bridge                      # :8788, follows :8790/events
bun qm/qm-admin.ts setup            # creates the legal/finance/eng scopes if missing + registers the connectors
curl -N localhost:8788/events       # watch (or open the palace at :5173)
bun qm/qm-admin.ts demo             # the 3 demo tasks, one per team scope, in parallel
bun qm/qm-admin.ts demo legal       # just contract-signoff
bun qm/qm-admin.ts run <runId> | python3 qm/summarize-run.py   # tool calls and verdicts inside QM
# Web UI: http://localhost:8129 shows the legal/finance/eng projects with their transcripts.
# Stop: node scripts/dev/cli.ts down && docker stop qm-dev-postgres
```
A fresh database gets new project ids. After `setup`, copy the ids from `bun qm/qm-admin.ts scopes` into `LOCI_SCOPES`, then run `dev up` again, which reloads in place. The QM clone must have `qm/patches/qm-fork.patch` applied and `qm/overlay/` copied in.

## Earlier status (14:05): PARTIAL
Stock QM ran with the mock harness only. There was no model key, and the sandbox refused `scripts/dev-instance.sh`. The workaround was to run `node scripts/dev/cli.ts` directly from the clone.

## What's built here

| Item | Status |
| --- | --- |
| `server/bridge.ts` on :8788 | Done. Tested with a replay and with the live proxy against a mock :8790. |
| `server/routes.ts` | Done. Lookup order is learned (Memorable CLI, then `fixtures/learned-routes.json`), then fallback (`palace.json` routes), then explore. |
| `qm/loci-mcp.ts` | MCP server (streamable HTTP, JSON responses) exposing `visit`, `claim`, `handoff`, `reply` and `answer`. Each tool is a thin POST to :8790. Register it in QM with the admin API; no core change is needed. |
| `qm/overlay/src/delivery/grounding-delivery.ts` | `withGroundingCheck(DeliveryStore)`. It checks every outgoing QM answer against :8790 and then blocks it, annotates it, or adds the palace replay link. |
| `qm/FORK.md` | The fork diff: where each change lands in upstream QM, with file and line references. |
| `qm/patches/qm-fork.patch` | The applied fork diff: scope-bound loci connectors and the grounding delivery wiring. Apply with `git apply`, plus copy `qm/overlay/`. |
| `qm/qm-admin.ts` | Dev CLI for a local QM: signed core admin calls, team scope setup, connector registration, and demo turns (the route comes from `routes.ts`). |

## QM facts (from reading upstream at a5a3667)

- **Repo:** https://github.com/yc-software/qm (MIT, about 42 MB). It is not vendored; `qm/README.md` points at it. Clone it outside this repo, to `../qm-upstream` or `~/Desktop/projects/qm-upstream`.
- **Stack:** TypeScript on Node ≥ 24. The core is Fastify, Slack uses Bolt, and the web UI uses Vite and Lit. Harnesses are pi, opencode, codex, claude-code and mock. It needs Postgres (the launcher runs `postgres:16-alpine` on :55432) and Docker (for sandboxes).
- **Global npm config gotcha:** `legacy-peer-deps=true` in the global npm config breaks `build:connector-sdk`. Prefix every npm command with `npm_config_legacy_peer_deps=false`.
- **Local ports:** portal :8129 (localhost sign-in bypass), core :8081, web :8097.
- **Extension points:**
  - **Tools.** `src/harness/agent-tools.ts` → `createAgentTools()` has a fixed list (around line 4200), then `mcpTools` (around 4026), then `clientTools` (around 4062).
    - MCP servers are registered with `PUT /v1/admin/mcp-servers/:id {url, auth:"none", enabled:true}`. `http://localhost` is allowed (`src/api/routes/admin/mcp-servers.ts:68`).
    - Tools are named `<serverId>_<tool>`.
    - `callMcpTool` passes the principal but **not the scope**, and MCP servers are org-wide. The fork adds `_qm.scopeId` to the arguments (`FORK.md` §1).
  - **Scopes.** Scope kinds are `personal | channel | team | org | group`, with ids of the form `kind:ref`. A web turn accepts `scopeId: "channel:<ref>"` plus `channelName`. Three agents means three channel scopes, `#legal`, `#finance` and `#eng`, each with its own memory and sandbox.
  - **Outbound messages.** Every outgoing message goes through `DeliveryStore.enqueue` (`src/delivery/delivery-store.ts:37`). That store is built once, at `src/wiring.ts:1678`, as `withWebTranscriptDeliveries(...)`. This is the single choke point for the grounding check. Web replies stream from session entries, so the fork also checks `result.reply` around `orchestrator.ts:3776`.
  - **Slack.** `src/slack/message-gating.ts:32` drops the bot's own messages, so a bot post in `#finance` does **not** wake the Finance agent. A handoff has to wake the target scope some other way: its signed webhook (`agent-tools.ts:2699`) or a small core route.
  - **Links.** Run results carry `adminUrl`. `buildDebugFooter()` in `surface-tools.ts` is where to append the palace replay link.

## Memorable

- The public docs show recall only through the CLI (`memorable recall "<query>"`), and it isn't installed here. Ingest is `POST https://memorable-extraction-api.memorable.workers.dev/v1/extract` with `Authorization: Bearer $MEMORABLE_API_KEY`.
- In `routes.ts`:
  - Recall runs the CLI when it's on `PATH` and scans its output for palace memory ids.
  - Record always writes `fixtures/learned-routes.json`, and also POSTs `/v1/extract` when `MEMORABLE_API_KEY` is set in `.env`.
  - No key was found in env, so the local file is the source of truth for now.

## Calls I made (no human to ask)

1. **`t` on `/events` is the harness's logical seconds-since-dispatch.** It is not rescaled by `speed`. `speed` only changes wall-clock pacing, so a saved run looks like its source. `t` is clamped to stay monotonic, and each event gets `run: <run id>` (the field is optional in the schema).
2. **Every run is saved to `fixtures/replays/run-<ISO-UTC>.jsonl`.** These files are **not committed**, because `fixtures/` belongs to `seed`. `bun run validate` checks every `.jsonl` in that directory, so the bridge drops any event that fails `PalaceEvent` before it is saved or streamed.
3. **Late subscribers get the active run's events so far** (turn this off with `?catchup=0`). Named SSE events `run` and `end` mark the run boundaries; `EventSource.onmessage` ignores them, so presence code is unaffected.
4. **Live `POST /dispatch` with the protocol service down falls back to replaying `demo-1`,** so the demo can't show a blank screen. Use `?fallback=0` for a strict 503.
5. **The protocol service's dispatch endpoint isn't frozen.** The bridge tries `POST :8790/dispatch`, then `/run`, then `/runs`, with body `{tasks:[{agent,text,route}]}`. If none of those work, it spawns `uv run python server/protocol/demo_run.py`. The route comes from `routes.ts`, so the service can use it or ignore it.
6. **Learning happens after a live run.** Each agent whose answer wasn't blocked records its route: a fallback or learned route as walked (gaps kept), or, for an explore route, the non-gap and handed-off stations. A replay only learns when `?learn=1` is passed.
7. **Protocol tool HTTP contract assumed by `qm/loci-mcp.ts`:** `POST :8790/<tool>` with JSON `{agent, ...args}`. The prefix can be changed with `LOCI_TOOL_PREFIX`.

## For the integrator

- **Package scripts** (`package.json` belongs to you): `"bridge"` already exists. It would help to add `"routes": "bun server/routes.ts"` and `"qm:mcp": "bun qm/loci-mcp.ts"`.
- **`.gitignore`:** consider adding `fixtures/replays/run-*.jsonl` and `fixtures/learned-routes.json`, unless you want to commit a run-2 replay for the Workshop demo.
- **ufo-ext:** please confirm the protocol service exposes (a) `GET /events` as SSE with `data: <PalaceEvent>`, and (b) a way to start the three demo tasks (`POST /dispatch` preferred). The bridge also handles the case where the service emits `run` ids; a new id starts a new bridge run.
