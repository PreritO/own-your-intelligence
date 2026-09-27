# qm/: the Mind Palace fork of QM

Upstream QM is **not vendored** here, because it's about 42 MB and has its own toolchain. This directory holds the fork's own files and the design of its diff.

- Upstream: https://github.com/yc-software/qm (MIT). It was read at `a5a36675041a85e30b9ff3632f678ba36837aabf` (2026-09-27).
- `loci-mcp.ts` is the loci tools (`visit`, `claim`, `handoff`, `reply`, `answer`) as an MCP connector. It is a thin adapter to the protocol service on :8790. It already works against stock QM, with no core change.
- `overlay/src/...` holds files that are copied into a QM checkout at the same path.
- `FORK.md` lists every change to upstream QM and why.

## Run stock QM locally (worked at 14:02 with the mock harness)

```bash
git clone https://github.com/yc-software/qm ../qm-upstream && cd ../qm-upstream
git checkout a5a36675041a85e30b9ff3632f678ba36837aabf
# The global npm config here sets legacy-peer-deps=true, which breaks build:connector-sdk. Override it:
npm_config_legacy_peer_deps=false npm ci
npm_config_legacy_peer_deps=false npm run build:connector-sdk
# Needs Docker. Starts postgres:16-alpine on :55432.
npm_config_legacy_peer_deps=false HARNESS=mock DEV_INSTANCE_ALLOW_MOCK=1 bash scripts/dev-instance.sh up --surface web
#   portal :8129 (localhost sign-in bypass) · core :8081 · web :8097
curl -XPOST localhost:8129/api/turn -H 'content-type: application/json' -d '{"text":"hello","threadRef":"web-curl-1"}'  # 202 + runId
bash scripts/dev-instance.sh down && docker stop qm-dev-postgres
```

For real agents, drop `HARNESS=mock` and `DEV_INSTANCE_ALLOW_MOCK`, and put `ANTHROPIC_API_KEY` in `.env` (or use `HARNESS=codex`). Run `npm run sandbox:local:build` once before any turn that runs `execute`. For Slack, use `--surface both`. That needs `xoxb-` and `xapp-` tokens from an app built from `src/slack/manifest.json`, placed in `~/.config/qm/slack-pool/pool1.env`.

The sandbox in this repo's agent worktrees refuses `bash scripts/dev-instance.sh`. It does exactly two things, so run them directly from the clone: `npm run build:connector-sdk`, then `node scripts/dev/cli.ts up --surface web`.

## The three team agents (ran live at about 14:20 on claude-sonnet-5)

Each team agent is a QM **project scope** named `legal`, `finance` or `eng` (`group:web-project-<id>`), with its own memory, files and sandbox. A web user can't use `channel:*` scopes without Slack, which is why projects are used. Core admin routes need source-auth signatures, so use `qm-admin.ts` rather than raw curl:

```bash
# In the QM clone: apply the fork, then start with a real model and the scope map
git apply /path/to/mind-palace/qm/patches/qm-fork.patch
cp /path/to/mind-palace/qm/overlay/src/delivery/grounding-delivery.ts src/delivery/
LOCI_SCOPES='{"group:web-project-…":"legal",…}' PI_MODEL=claude-sonnet-5 node scripts/dev/cli.ts up --surface web

# In this repo
bun run qm:mcp                 # :8791, loci MCP adapter
bun run bridge                 # :8788, follows :8790/events, so QM-driven runs reach the palace
bun qm/qm-admin.ts setup       # creates the legal/finance/eng projects + registers loci-legal/-finance/-eng
bun qm/qm-admin.ts scopes      # scope ids for LOCI_SCOPES (re-run `dev up` after setting it)
bun qm/qm-admin.ts demo        # the 3 demo tasks in parallel, route from server/routes.ts
bun qm/qm-admin.ts run <runId> | python3 qm/summarize-run.py
```
