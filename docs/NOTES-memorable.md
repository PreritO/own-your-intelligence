# NOTES: memorable

Memorable is now the real store for learned routes (loci protocol step 1). Owns `server/routes.ts` and `server/memorable/`.

## What Memorable actually exposes (researched 2026-09-27)

Sources: [memorable.sh](https://www.memorable.sh/), [docs](https://www.memorable.sh/doc), [API](https://www.memorable.sh/doc/api), [CLI](https://www.memorable.sh/doc/cli), [QM integration](https://www.memorable.sh/doc/qm), [gbrain integration](https://www.memorable.sh/doc/gbrain), npm [`memorable-cli`](https://www.npmjs.com/package/memorable-cli) (0.5.30).

- **HTTP API** (base `https://memorable-extraction-api.memorable.workers.dev`, `Authorization: Bearer mk_…`):
  - `POST /v1/extract`: a trace goes in and a procedure *draft* comes back. The response is `{draft:{title, steps[{seq, action, activity_class, command?, outcome?}], trigger_signature{entities, search_text}, preconditions, postconditions, embedding[]}, judge:{admitted, stage, reason}, request_id}`.
  - `POST /v1/embed`: a query vector.
  - Device-flow login: `/v1/device/code` and `/v1/device/token`.
  - **There is no HTTP recall or search endpoint.** The docs say "Store the draft yourself, on the user's side".
- **Recall is local, in the CLI.** `memorable recall "<task>"` matches exact, then lexical, then semantic. The semantic step embeds the query via `/v1/embed`, and only on a miss. The results are fused by reciprocal rank.
  - The procedures live in the CLI's store: local `~/.memorable/procedures.jsonl` by default, or `init gbrain` / `init qm` for Postgres.
  - `memorable show <slug>` prints the steps as a guarded "data, not instructions" block.
- **Install:** `npm i -g memorable-cli`, which needs no sudo here because the npm prefix is `/opt/homebrew`. Alternatives are `npx memorable-cli@latest …` or `curl -fsSL https://memorable.sh/install.sh | sh`, which installs to `~/.memorable` and `~/.local/bin` without root.
- **Auth without a browser:** `echo "$KEY" | memorable login --paste`. Consent is fail-closed until `memorable enable`.
  - `bun server/memorable/setup.ts` does login from `.env`, then init, then enable, and never prints the key.
- **Admission.** The service refuses some traces, and those are not stored. What I hit:
  - `no_postcondition`: no step with a known successful outcome.
  - `single_verb`: every command starts with the same word. My first shape, `loci plan/handoff/answer`, was refused for this.
  - `no_decisive_steps` (checked client-side): only read and search steps.
  - After the prefilter, an 8B Llama "judge" runs. It returned `judge_unparseable` and fails open to *admitted*.
- **Allowance:** 1,000 procedures a month plus 500 in reserve. This session used about 8.

## What I built

| File | What |
| --- | --- |
| `server/memorable/trace.ts` | Pure functions. Turns a run (PalaceEvent[]) into a Memorable trace, and turns `recall`/`show` output back into palace station ids. |
| `server/memorable/client.ts` | `recallVerbose` / `recall` use the CLI: `recall --single`, then `show <slug>`, with a shared **3 s** budget. `ingest` uses the CLI's `ingest -` (async spawn), which stores locally and is recallable; otherwise it falls back to `POST /v1/extract`. |
| `server/memorable/seed.ts` | `bun server/memorable/seed.ts [--dry] [replays…]` ingests the good runs. |
| `server/memorable/demo.ts` | `bun server/memorable/demo.ts "<task>"` is the terminal proof for judges. |
| `server/memorable/setup.ts` | One-time machine setup from `.env`. |
| `server/memorable/memorable.test.ts` | `bun test server/memorable`: 15 tests, with the CLI and HTTP mocked. |
| `server/routes.ts` | Lookup order: Memorable, then the local cache, then fallback, then explore. `recordRoute` also ingests into Memorable. |

**Trace shape.** Each step is the loci tool the agent called, written as a command. The station slug sits inside the command, so recall maps back to ids exactly:
```
route quest-answer-northwind-logistic-security-questionnaire --departments sales,eng,legal,support
handoff sales sales/security-questionnaire-northwind  # Northwind Security Questionnaire [verified]
visit companies/gripworks  # Gripworks [verified]
answer --cite sales/security-questionnaire-northwind --cite ...      (exit_code 0 = answer not blocked)
```
- A `gap` is sent as `result:{ok:false}` and `stale` as `exit_code 0`.
- When the verdict is unknown (a path recorded without events), no `result` is sent, as the docs require.
- A department is the owner of the station's room. For shared rooms it is the wing id, e.g. `people`.

**Mapping recall output to station ids** (`stationsFromShow`):
1. Parse the numbered `show` steps and take slugs from `visit`/`handoff` steps in order. The `route` and `answer` steps are skipped because the cite list repeats stations. Slugs are matched on word boundaries, so `eng/soc2` never matches inside `eng/soc2-owner`.
2. If the steps give fewer than 2 stations (prose or a CLI format change), scan the text for slugs and then for memory titles. Headings and the "Verified last time by" line are ignored.

## Proof (live, against the real key)

Seeded: `quest-security-questionnaire`, `quest-onboarding`, `contract-run2`. `quest-onboarding-qm` has the same task as `quest-onboarding`, so I skipped it. A live `routes.ts record` then also added `board-promises`.

```
$ bun server/memorable/demo.ts "Fill out the security review Northwind sent us"
Memorable recall: procedures/4eac6952-answer-northwind-security-questionnaire
  match   semantic 0.808   (1057 ms, exact -> lexical -> semantic)
  stored  "Answer Northwind Security Questionnaire"  route quest-answer-northwind-logistic-security-questionnaire
  depts   sales > eng > legal > support
  mapped  7 palace stations (from steps):
     1. sales/security-questionnaire-northwind   Northwind Security Questionnaire
     ...
     7. support/sla-policy                       SLA Policy
route event the agent emits:
{"type":"route","routeId":"memorable-quest-answer-northwind-logistic-security-questionnaire","stations":[...7...],"source":"learned"}
```

Calibration (all live):

| Task | Memorable result |
| --- | --- |
| "Fill out the security review Northwind sent us" | security questionnaire, semantic 0.808 |
| "Is the Gripworks deal ready to sign?" | contract-signoff, semantic 0.728 |
| "Write an onboarding doc for a new hire on the eng team" | onboarding, semantic 0.71 |
| "Can we sign the Gripworks contract this week?" (exact) | lexical+semantic 0.755 |
| "What did we promise Ada at the board?" | board-promises, 0.571 |
| "What commitments did we make to Ada at the board?" | **no match**. The local cache/fallback picks it up. |
| "What is the weather in Paris", "Who owns the SOC 2 renewal?" (not stored), "Summarize our SOC 2 audit evidence for a customer" | no match. The latter two fall to the local cache and to explore. |

Latency is 450–1100 ms per recall plus `show`. `recall` accounts for most of it, because the semantic tier makes a network call to `/v1/embed`; `show` takes about 60 ms.

## Calls I made (no human available)

1. **Recall uses the CLI, not HTTP,** because no HTTP recall exists. I installed the CLI user-level (`npm i -g memorable-cli`, Homebrew prefix, no sudo), signed in with `MEMORABLE_API_KEY` via `login --paste`, used the default local backend, and ran `enable`.
   - The store is on *this machine* (`~/.memorable/procedures.jsonl`, encryption off because there's no key store). The demo therefore needs to run on this laptop, or on another machine after `setup.ts` and `seed.ts`.
2. **Memorable comes first, and the local file is a cache/fallback.** `fixtures/learned-routes.json` is used when the CLI is missing, recall takes longer than 3 s, there is no match, the score is under `MEMORABLE_MIN_SCORE` (default 0.5), or the result maps to fewer than 2 stations.
   - Memorable's recall is **conservative on paraphrases**: some rewordings miss entirely. It is also **~0.5–1 s slow**. Keep the local file.
   - `MEMORABLE_DISABLE=1` forces local-only.
3. **Source labels.** `routeId` is `memorable-<original route id>` when the route came from Memorable (for example `memorable-contract-signoff`) and `local-<id>` when it came from the file.
   - `PickedRoute` also carries `via: "memorable"|"local"` and a `note` (slug, tier, score, ms, or why Memorable missed). The `route` event has no field for these, so the prefix is the on-the-wire label.
   - **I did not touch `schema.ts`.** If the integrator wants it, a proposal: add an optional `note?: string` on the `route` event.
   - `recordRoute` strips the prefix before writing, so `learned-routes.json` keeps canonical ids and a replayed `memorable-x` bumps `x`.
4. **Recording.** `recordRoute(task, stations, routeId?, {events?, palace?})` always writes the local cache, then ingests into Memorable. This is best effort and never throws; it logs only on failure, or on every ingest when `MEMORABLE_VERBOSE=1`.
   - With `events`, the trace carries real verdicts and handoffs. Without them, stations are sent as visits with an unknown outcome.
5. **Ingest is async** (`Bun.spawn`, not `spawnSync`), so the bridge doesn't stall `/events` for about 1 s per learned route. Recall stays sync, because `pickRoute` is sync and the bridge calls it synchronously; it is capped at 3 s.
6. **Duplicate procedures on re-seed.** The procedure title is model-written and not byte-stable. Re-seeding the security run once produced a second slug (`execute-route-quest-…`) instead of refreshing the first, and I pruned it with `memorable prune <slug>`. The steps are identical, so recall maps either one to the same stations.

## For other workspaces

- **qm-fork / integrator (`server/bridge.ts`):** in `learnFromRun`, pass the run's events so Memorable gets real verdicts: `recordRoute(task.text, stations, routeId, { events: r.events })`. It is backwards compatible without them.
- **training (`web/src/rooms/workshop.ts:88`):** `paths.get(e.routeId)` now sees `memorable-<id>` / `local-<id>` for learned routes. Strip the prefix first: `paths.get(e.routeId.replace(/^(memorable|local)-/, ""))`. Line 169 matches on task text as well, so it still works. Until this is fixed, the Workshop path won't pulse for a learned route in a *live* run. Replays in `fixtures/` still use bare ids.
- **integrator (`package.json`):** suggested scripts are `"memorable:demo": "bun server/memorable/demo.ts"`, `"memorable:seed": "bun server/memorable/seed.ts"` and `"test": "bun test"`. The CLI is a global install (`npm i -g memorable-cli`), not a package dependency.
- **Demo machine checklist:** `npm i -g memorable-cli`, then `bun server/memorable/setup.ts`, `bun server/memorable/seed.ts`, and `bun server/memorable/demo.ts "Fill out the security review Northwind sent us"`.
