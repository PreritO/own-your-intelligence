# NOTES-import

`bun server/import/index.ts <dir> --out <brainDir> [--slack export.json] [--palace out.json] [--gbrain <isolatedDir>] [--cache dir] [--offline]`

Sample: `bun server/import/index.ts fixtures/import-sample --out fixtures/imported-brain --palace fixtures/imported-palace.json --cache server/import/cache/sample --offline`
(offline replays the recorded responses; drop `--offline` to call Claude). Tests: `bun test server/import` (offline).

## Calls made (no human available)
- **No Anthropic SDK**: raw `fetch` + `output_config.format` (json_schema), like `server/commission/claude.ts`. Adding `@anthropic-ai/sdk` needs the integrator (package.json).
- API key: env, else the main checkout's `.env` via `git rev-parse --git-common-dir`. Never logged.
- Model `claude-sonnet-5`, effort medium. Cache key = sha256(model, system, user, schema). Committed cache: `server/import/cache/sample/`.
- Slack: the model keeps only decision/owner messages; only those reach the page (no thread roots, so discussion can't leak in as fact).
- `Owner: not recorded.` is written only when the model marks a page as a policy/process and names no owner. It sits in the first 240 chars so `server/ask.ts` gap detection sees it.
- People and companies get entity pages built from verified exact quotes (a quote not found in the source is dropped).
- Verbatim tripwire: numbers on a page that don't appear in the source are logged as warnings in `_import.json`.
- Output dir is only overwritten if it has an `_import.json` (our report).

## Needs integrator
1. **`bun server/validate.ts fixtures/imported-palace.json` fails**, only on the Acme checks: it validates `fixtures/traces` and `fixtures/replays` (Acme ids) against whichever palace is given. The importer runs the same palace-level checks (`checkPalace` in index.ts: rooms, doors, links, agent homes, ≤12/room) and they pass. Proposed patch: in validate.ts, only check traces/replays when `palacePath === "fixtures/palace.json"` (or add `--palace-only`).
2. **UI `?palace=`**: `web/src/main.ts` line 13 hardcodes `fetch("/palace.json")`. Change to `fetch("/" + (params.get("palace") ?? "palace") + ".json")` (sanitize to `[\w-]+`), so `?palace=imported-palace` loads the Kitewing palace. Replays/traces are Acme-only, so `?demo` should be off for an imported palace, and routes are empty.
3. `buildPalace` still adds Acme `AGENTS` and tries Acme `FALLBACK_ROUTES` (dropped as missing stations). Fine for now; a company-agnostic export would take agents from the wings that have pages.
4. `--gbrain` is implemented (GBRAIN_HOME isolation, auto_link off, add_link) but was not run in this session.
