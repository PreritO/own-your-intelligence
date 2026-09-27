# NOTES — qm-fork

## QM gate (2:15): PARTIAL, so UFO is the live harness

- **Stock QM runs locally.** At about 14:02, upstream `yc-software/qm@a5a3667` came up with the mock harness, the web surface only, and Postgres in Docker. A `POST /api/turn` returned 202, and `GET /api/runs/<id>` then returned `done` with a reply. After the test it was shut down cleanly.
- **The three scoped agents were not shown.** Legal, Finance and Eng would each need a channel scope, and none was set up. There is no model key in env (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `OPENROUTER_API_KEY` are all unset), so the mock harness can't call tools. There are no Slack tokens either.
  - When I tried to start it a second time from this agent's isolated worktree, the sandbox refused to run the upstream `scripts/dev-instance.sh`. I did not push past that.
- **What this means for the demo:** live agents run on UFO plus the protocol service (ufo-ext). QM's part is shown as the fork diff (see `qm/FORK.md`) plus the MCP adapter in `qm/loci-mcp.ts`. The bridge (`server/bridge.ts`) doesn't care which harness is driving, so nothing downstream changes.
- **To finish the gate:** set `ANTHROPIC_API_KEY` in `.env` (or use `HARNESS=codex`, since `~/.codex/auth.json` exists). Then run the commands in `qm/README.md` and send three turns with `scopeId` `channel:legal`, `channel:finance` and `channel:eng`. This takes about 10 minutes.

## What's built here

| Item | Status |
| --- | --- |
| `server/bridge.ts` on :8788 | Done. Tested with a replay and with the live proxy against a mock :8790. |
| `server/routes.ts` | Done. Lookup order is learned (Memorable CLI, then `fixtures/learned-routes.json`), then fallback (`palace.json` routes), then explore. |
| `qm/loci-mcp.ts` | MCP server (streamable HTTP, JSON responses) exposing `visit`, `claim`, `handoff`, `reply` and `answer`. Each tool is a thin POST to :8790. Register it in QM with the admin API; no core change is needed. |
| `qm/overlay/src/delivery/grounding-delivery.ts` | `withGroundingCheck(DeliveryStore)`. It checks every outgoing QM answer against :8790 and then blocks it, annotates it, or adds the palace replay link. |
| `qm/FORK.md` | The fork diff: where each change lands in upstream QM, with file and line references. |

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
