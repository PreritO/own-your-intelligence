# NOTES: loose-ends workspace

Branch `ws/loose-ends`. Owns `server/protocol/loose_ends.py`, `server/gbrain/`, `web/src/rooms/looseEnds.ts`; `service.py` got 4 small hooks (import, GET hook, POST hook, `attach` in `main()`).

## What resolve writes, and where

`POST :8790/loose-ends/<memoryId>/resolve {text, by}`:

1. **Seed-brain page:** `fixtures/seed-brain/<id>.md`, the real Markdown file (`server/gbrain/pages.py`).
   - A blank key field (`Owner: not recorded`, `| Owner | (none recorded) |`) is filled in place.
   - A silent lead paragraph is replaced by the answer; an empty page gets the answer as its body; a stale page gets it appended.
   - Every write adds a dated line under `## Answers` (placed above `## Links`) with the answer, who answered and the question.
   - `updated:` is bumped to today. Wikilinks are stripped from answers, because fixtures require body wikilinks to appear under `## Links`.
   - The patch is re-judged with `loci.judge` before writing. If a strategy would still read as a gap, it falls through to the next one.
2. **Isolated GBrain:** `gbrain put <id>` with the page on stdin, run with `GBRAIN_HOME=<repo>` (so `<repo>/.gbrain`).
   - `DATABASE_URL` and `GBRAIN_DATABASE_URL` are removed from the child environment.
   - It refuses if the home resolves to `~/.gbrain`, and skips (saying so) if the brain isn't seeded.
   - Then it runs `gbrain get` and reports `readBack`.
   - I checked `~/.gbrain/config.json` before and after: sha1 `b005fe63…`, unchanged.
3. **Owner notified:** `.env` has no `SLACK_WEBHOOK_URL` today, so this appended to `server/protocol/.outbox/<team>.log`. With a webhook it posts to Slack, and falls back to the outbox with `slackError` if the post fails.
4. **Event:** `resolved {memoryId, by, text, channel}` goes into the current run. `channel` is `outbox` or `slack`, whichever actually happened.
5. **Re-check:** the owning team's agent does a real `visit` straight away, quoting the patched line as evidence, so the lectern's book comes back on `verified`.
   - Every later visit re-judges from disk: `FreshBrain` lets a page's `updated:` raise (never lower) the palace freshness, and a legacy `.overlay` copy is deleted.
   - Inbox state lives in `server/protocol/.loose-ends/inbox.json`. It and `.outbox/` create their own `.gitignore`.

Verified live on :8891 against the real seed brain and the isolated gbrain. The SOC 2 page came back `verified`, and `gbrain get` returned the new owner.

## Reset

- Running service: `curl -XPOST localhost:8790/loose-ends/reset -d '{"brain":true}'`. This reverts marked pages (git checkout), re-puts them into the isolated gbrain, and clears the inbox, outbox and overlay.
- Offline: `uv run --project server/protocol python server/gbrain/reset.py [--dry-run|--all]`.
- By hand: `git checkout -- fixtures/seed-brain`.
- By default, only pages containing the marker "via Loose Ends" are reverted, so a seed author's uncommitted edits survive.

## Requests for the integrator / other workspaces

- **package.json** (integrator):
  - `"reset-brain": "uv run --project server/protocol python server/gbrain/reset.py"`
  - `"test:loose-ends": "uv run --project server/protocol pytest server/gbrain/tests -q"`
- **ui:** the `.mp-top` Quest board panel covers the Loose Ends board when the camera frames `room-loose-ends`. Collapse it while that room is framed, or while the answer form (`form.mp-le`) is open.
- **voxel/scene (optional):** the lectern clears on the re-check's `visit: verified` event. If a harness resolves without a re-check, the scene could also treat `resolved` as "clear gap".
- **ufo-ext:** `POST /writeback` still writes only the legacy overlay. It is kept so `test_soc2_gap_loose_end_loop` keeps passing. Switch `loose_ends.resolve()` in `ufo_ext_mindpalace` to `POST /loose-ends/<id>/resolve` to get the real write-back.
- **seed:** `bash fixtures/seed-gbrain.sh` stops at `add_link marketing/gripper-v2-launch-plan -> ops/gripper-v2-production-plan`, because that page isn't imported. The 96 pages still import.

## Decisions made without a human

- The inbox attaches only in `service.py main()`. Other workspaces' tests, which build a `Protocol` directly, keep the legacy `/loose-ends` behaviour and never write the repo seed brain.
- `gbrain put` runs only when the protocol reads the repo's own `fixtures/seed-brain` (`MP_GBRAIN_SYNC=0` turns it off).
- An item's verdict is the latest read of the page. A later `verified` visit on an open item closes it as `resolvedBy: "page re-verified"`.
- "Who asked" follows this order:
  - the handoff that sent the visiting agent there (the quest agent, plus its quest task);
  - else the plan subtask;
  - else the agent's task;
  - else a generic question.
- `?protocol=http://localhost:8891` points the board at another service. Under `?demo`, the board is read-only unless `?protocol` is given.

## Verify

- `uv run --project server/protocol pytest server/gbrain/tests -q`: 13 passed. These cover page patching, the inbox, resolve over HTTP with a fake `gbrain` CLI (argv/env/stdin asserted), re-visit verified, the Slack path, reset, and legacy fallthrough.
- `server/protocol` pytest: 22 passed. `ufo_ext_mindpalace` pytest: 6 passed.
- `bun run validate && bun run typecheck`: clean.
- Headless Chrome (playwright-core, channel chrome) did the following:
  - clicked the real card via its projected screen position, and the cursor was `pointer`;
  - the form reads "Answer for Eng: who owns the SOC 2 renewal?";
  - submitting gave the toast "Written to fixtures/seed-brain/eng/soc2-owner.md · GBrain updated · Eng told via outbox · re-check: verified" and the card flipped;
  - under `?demo`, clicking only shows a read-only toast.
