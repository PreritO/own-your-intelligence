---
name: harness-adapters
description: Load when working on the QM fork (qm/, server/bridge.ts, server/routes.ts) or the UFO extension (ufo_ext_mindpalace/) - wiring agent harness tool calls to the loci protocol service and streaming /events to the palace.
---
# Harness adapters (QM fork + UFO)

- **Read before coding.** QM: its repo docs on plugins, tools, scopes → `NOTES-qm-fork.md`. UFO: `spec.md` extension-system section + `extensions/sample` in ufo-core → `NOTES-ufo-ext.md`. Record the extension points you found and the exact commands that got stock software running.
- **Gate 2:15:** stock QM running with three agents scoped to Legal, Finance, Eng. If not, UFO (single process, SQLite: `make install && make init && make serve`) becomes the demo harness. Tell the integrator the moment you know.
- Both harnesses call the same protocol service on :8790 and nothing else. Adapters only translate: tool call → HTTP → result. No ownership/claim/grounding logic in adapters.
- `server/bridge.ts` (Bun, :8788): `GET /events` as SSE (`data: <PalaceEvent JSON>\n\n`, CORS `*`), `POST /dispatch` to start the three demo tasks, and it appends every run to `fixtures/replays/run-<timestamp>.jsonl`. It can proxy the protocol service's own event stream, so either harness produces identical `/events`.
- `server/routes.ts`: Memorable lookup → explore → fallback; persist successful paths to Memorable or `fixtures/learned-routes.json` (`[{routeId, task, stations, uses}]`).
- Secrets live in `.env` (gitignored). Never commit keys.
- Verify: with the harness running, `curl -N localhost:8788/events` while dispatching shows task → route → visits → handoff → reply → answers; `bun run validate` passes on the saved replay.
