---
name: memorable-lessons
description: Lessons from the memorable workspace - Memorable as the learned-route store (server/memorable, server/routes.ts). Covers the memorable CLI, the /v1/extract trace shape, admission refusals, and mapping recall output to palace station ids. Load before changing learned routes or anything that talks to Memorable.
---
# memorable lessons

**What broke**
- **There is no HTTP recall.** `/v1/extract` only parses a trace and returns a draft, which the caller has to store. Recall lives in the CLI's local store (`memorable recall`, then `show`). Install it with `npm i -g memorable-cli` and sign in with `echo $KEY | memorable login --paste`, then run `enable`. `server/memorable/setup.ts` does all of that.
- **Admission refusals.** Traces made only of reads, traces without a successful final step (`no_postcondition`), and traces where every command starts with one word (`single_verb`) are *not stored*. Write each loci tool call as its own verb: `route`, `visit`, `handoff`, `answer`, with exit 0 on the answer.
- **Only allow-listed input fields survive** (`command`, `path`, `file_path`, …). Custom keys like `memoryId` and `verdict` are silently dropped. Put the slug, title and verdict inside `command`.
- **Titles are written by a model.** Re-ingesting the same run can mint a new slug; prune the duplicate.
- The worktree sandbox refuses bash lines containing `enable` (a shell builtin), plus loops and heredocs. Run such commands from a TS script instead.
- The CLI emits ANSI colour even when piped, because `FORCE_COLOR` is inherited. Strip it, or drop `FORCE_COLOR` from the child env.

**What I'd do differently**
- Read the CLI's `dist/cli.js` for output formats and refusal reasons first. It is quicker than the docs.
- Put the seed runs' route ids into `learned-routes.json` early, so the local cache and Memorable agree.

**Verify**
Run `bun test server/memorable`, then `bun server/memorable/demo.ts "Fill out the security review Northwind sent us"`. Expect a `memorable-quest-answer-northwind…` route with 7 stations. Then run `MEMORABLE_DISABLE=1 bun server/routes.ts pick "Who owns the SOC 2 renewal?"` and expect `local-soc2-owner`.
