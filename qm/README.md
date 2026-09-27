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

## The three team agents

Each team agent is a channel scope in QM: `channel:legal`, `channel:finance` and `channel:eng`. Each one has its own memory, files and sandbox. A web turn picks its agent with `{"scopeId":"channel:legal","channelName":"legal", ...}`. Then:

```bash
bun qm/loci-mcp.ts   # :8791
for a in legal finance eng; do
  curl -XPUT localhost:8081/v1/admin/mcp-servers/loci_$a -H 'content-type: application/json' \
    -d "{\"url\":\"http://localhost:8791/$a\",\"auth\":\"none\",\"enabled\":true}"
done
bun run bridge       # :8788, follows :8790/events, so QM-driven runs reach the palace
```
