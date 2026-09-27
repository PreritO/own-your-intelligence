---
name: qm-fork-lessons
description: Lessons from the qm-fork workspace - running upstream QM locally, wiring tools into it, and the bridge/routes servers. Load before touching qm/, server/bridge.ts or server/routes.ts again.
---
# qm-fork lessons

**What broke**
- **QM's npm build.** It fails on `build:connector-sdk` (ENOENT zod) because this machine's global npm config sets `legacy-peer-deps=true`. Prefix every npm command with `npm_config_legacy_peer_deps=false`.
- **The QM gate.** Stock QM came up in about 3 minutes (mock harness, web surface, Postgres in Docker). But three scoped agents need a real model key, and Slack tokens for the channel demo, and neither was available.
  - Check `.env` for `ANTHROPIC_API_KEY` first thing, before spending time on infra.
- **Worktree isolation.** In an isolated worktree agent, the sandbox refuses scripts run from other directories (such as `scripts/dev-instance.sh` in the upstream clone) and compound shell commands that include git. Keep commands simple, with one git operation per call.
- **Bun SSE.** `Bun.serve` kills an idle SSE stream after 10 s by default. Set `idleTimeout: 0` and send a `: ping` comment every 15 s.
- **Learning from a run.** "Visited stations" is the wrong thing to learn:
  - Handoffs remove a station from the asking agent's own visits.
  - The replying agent's visits pollute its own route.
  - The fix is to record fallback and learned routes exactly as walked, and filter only explore routes.

**What I'd do differently**
- Read QM's MCP client (`src/mcp/mcp-client.ts`) first. It is plain JSON-RPC to `${url}/mcp` with no handshake, so tools need no core change. That was the cheapest real integration, and it would have shaped the whole plan.
- Agree the protocol service's HTTP shape with ufo-ext up front: `POST /<tool>`, `POST /dispatch`, `POST /grounding`, and `GET /events`. The bridge currently guesses (`/dispatch`, then `/run`, then `/runs`, then `demo_run.py`).
- Keep a mock :8790 in the repo (only a scratch file here). Testing the bridge's live proxy against it took 5 minutes.

**Verify**
Start a mock or the real :8790. Then run `bun run bridge`, `curl -N localhost:8788/events` and `curl -XPOST localhost:8788/dispatch`. Expect a full run (task, route, visits, wait, handoff, reply, gap, three answers) and a `run-<ts>.jsonl` saved to `fixtures/replays/`. Finally, run `bun run validate`.
