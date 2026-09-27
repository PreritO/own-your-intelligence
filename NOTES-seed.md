# NOTES — seed workspace

Branch `ws/seed`. Owns `fixtures/` and `scripts/make-fixtures.ts`. No schema, `api.ts` or `events.ts` changes.

## What's here

| Path | What |
| --- | --- |
| `fixtures/seed-brain/**.md` | 68 pages for Acme Robotics: `people/` 14, `companies/` 9, `legal/` 16, `finance/` 14, `eng/` 16 (the People wing holds people and companies) |
| `scripts/make-fixtures.ts` | Reads the seed brain and regenerates **everything below**. Deterministic (fixed TODAY = 2026-09-27, sorted ids). It fails loudly on a broken link, a page with fewer than 2 links, an untyped body wikilink, or a room with more than 12 pages. |
| `fixtures/palace.json` | Fixture palace: 9 rooms (foyer plus 2 per wing), 68 memories, 219 typed links, 3 fallback routes, 3 agents |
| `fixtures/traces/demo-{1,2,3}.json` | Single-question walks for the 3 demo questions |
| `fixtures/replays/demo-1.jsonl` | **Byte-identical** to Phase 0 (checked with `git diff`) |
| `fixtures/replays/contract-run1.jsonl` | Workshop run 1: `source: "explore"`, 9 hops, 31 events, `run: "contract-run1"` |
| `fixtures/replays/contract-run2.jsonl` | Workshop run 2: `source: "learned"`, 5 hops, 21 events, `run: "contract-run2"` |
| `fixtures/learned-routes.json` | `[{routeId, task, stations, uses}]`, 5 routes (uses 1 to 5) |
| `fixtures/synthetic-tasks.jsonl` | 150 Gym tasks, 50 per team: `{team, question, route, expectedAnswer, expectedGaps}` |
| `fixtures/seed-gbrain.sh` | Seeds an **isolated** project-local GBrain |

Regenerate: `bun run fixtures && bun run validate`.

## Page format

```markdown
---
title: Gripworks MSA
type: contract
team: legal            # finance | legal | eng; omitted = shared People wing
room: Contracts        # room-label hint inside the wing (see below)
updated: 2026-09-20    # freshness source
---
First paragraph = the excerpt (kept under 200 chars and self-contained).

Body with inline [[legal/approvals|Legal Approvals Log]] wikilinks.

## Links
- approved_in: [[legal/approvals]]
- funded_by: [[finance/budget-2026-q4]]
```

- Every body wikilink also appears as a typed line under `## Links`, which is the canonical edge list. Every page has at least 2 typed links. No H1; the first paragraph is the excerpt.
- **`room:` hint (extra frontmatter, not in the contract).** Room labels per wing: People → `People`, `Partners`; Legal → `Contracts`, `Corporate`; Finance → `Board & Plans`, `Budgets`; Eng → `Security`, `Platform`. The first label in each wing is `room-<wing>-0`. The demo replay depends on this mapping (for example `finance/budget-2026-q4` in `room-finance-1`). **Suggestion for export:** group pages by `room:` when it is present. Your replay-pinning approach also works.

## Freshness

`freshness = clamp(1 - days_since(updated)/180, 0, 1)`, with today fixed at 2026-09-27. Values run from 0 to 0.99. 12 pages are stale (below 0.3):
`eng/security-policy` (0.0, "last reviewed March"), `eng/soc2-owner` (0.1), `eng/soc2-2025-report`, `companies/halden-compliance`, `companies/axis-logistics`, `legal/axis-logistics-msa`, `legal/nda-template`, `legal/ip-assignment`, `legal/series-a-docs`, `finance/expense-policy`, `people/employee-handbook`, `people/lena-vogt`. No stale page sits on the `contract-run1`/`contract-run2` routes, so their `verified` verdicts stay honest.

**Git dates:** every seed page is committed with `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` set to its `updated:` date (one commit per date, oldest first), so `git log -1 --format=%cI -- <path>` agrees with the frontmatter. **Integrator: merge with a merge commit (`gh pr merge --merge`), not squash or rebase**, or the git dates collapse to today. Recommendation for export: **prefer `updated:` frontmatter over git dates**. It survives any merge strategy. Note that gbrain normalizes it to `'2026-04-18T00:00:00.000Z'`.

## Isolated GBrain (never the personal brain)

gbrain 0.42 honours `GBRAIN_HOME` (config dir = `$GBRAIN_HOME/.gbrain`). `--path` alone is NOT enough, because config would still go to `~/.gbrain/config.json`. `DATABASE_URL`/`GBRAIN_DATABASE_URL` override the config, so they are unset.

```bash
bash fixtures/seed-gbrain.sh --fresh     # what it runs:
export GBRAIN_HOME="$REPO"                # -> $REPO/.gbrain (gitignored)
unset DATABASE_URL GBRAIN_DATABASE_URL
gbrain init --pglite --non-interactive --no-embedding
gbrain config set auto_link false --force   # stop prose heuristics; our ## Links are canonical
gbrain import fixtures/seed-brain --no-embed
gbrain call add_link '{"from":"<a>","to":"<b>","link_type":"<kind>"}'   # once per typed link (219)
```

Result: `GBRAIN_HOME=$PWD gbrain stats` → `Pages: 68, Links: 219` (all typed). Runtime is about 1-2 min, mostly the 219 CLI calls. I checked that `~/.gbrain/config.json` was byte-identical before and after (sha1 `b005fe63…`).

gbrain gotchas:
- `gbrain link a b --type T` returns ok but **ignores `--type`**. The param is `link_type`, so use `gbrain call add_link`.
- With `auto_link` false *before* import, import stores no untyped edges, so every edge is typed. Default auto-link only recognizes `people|companies|finance|…/` prefixes (not `legal/`, `eng/`) and guesses types from prose.
- `gbrain list` caps at 50 rows; use `gbrain stats` for counts.
- `gbrain search "SOC 2 owner"` ranks `eng/soc2-owner` first; `search "Gripworks contract"` ranks approvals → msa → gripworks. `query` needs embeddings (not run: `--no-embed`).

## The three demo questions: 3-5 hop answer paths

1. **"Can we sign the Gripworks contract this week?"** (route `contract-signoff`, 5 hops, Legal)
   `companies/gripworks` (supplier, $40k 12-month deal) →contract→ `legal/gripworks-msa` (v3, Net-45, cap 1x fees, $40k) →funded_by→ `finance/budget-2026-q4` (supplier line $55k, $15k committed; **Finance-owned, so Legal hands off**) → `legal/approvals` (approved by Tomas Reyes Sep 22, pending budget) →requires→ `people/signatories` (over $30k needs CEO Mara Okafor or COO Dev Lindqvist).
   Answer: *Yes, this week, if Mara Okafor or Dev Lindqvist signs; Legal approved v3 Sep 22 and the $40k fits the Q4 supplier line.*
2. **"What did we promise Ada in the last board meeting?"** (route `board-promises`, 3 stations; trace demo-2 walks 4)
   `finance/board-2026-q3` (Aug 13: gross-margin plan by Dec 15 + monthly burn updates) →attended→ `people/ada-chen` (Lumen Ventures observer) → `people/org-chart` (Raj Patel owns Finance), or in the trace `finance/board-action-items` → `finance/gross-margin-plan` (outline, owner Raj Patel).
   Answer: *A hardware gross-margin plan by Dec 15 and monthly burn updates.*
3. **"Who owns the SOC 2 renewal?"** (route `soc2-owner`, 4 hops, Eng). **Deliberate gap.**
   `eng/soc2-renewal` (window Nov 1, auditor Brightline, evidence not started) →governed_by→ `eng/security-policy` (**stale**, last reviewed March, owner line blank) → `people/org-chart` (no security/compliance lead; row removed when Halden Compliance left) → `eng/soc2-owner` (exists; "Owner: not recorded" → **gap**).
   No page anywhere names a SOC 2 or compliance owner. `eng/soc2-evidence-tracker` owner column is blank, `eng/roadmap-2026-h2` says "TBD", and the Brightline letter's contact field is blank.
   Answer: *Gap: no SOC 2 owner is recorded …*

All facts in `demo-1.jsonl` (Net-45, Sep 20/22, $40k/$55k/$15k, $30k threshold, Dec 15, Nov 1, Brightline, March) are stated verbatim in the pages.

## Replays for the Workshop

- `contract-run1` wanders: gripworks → contract-playbook ("general positions only") → voltcell-supply-agreement ("wrong vendor, dead end") → gripworks-msa → vendor-onboarding → purchase-order-policy (handoff) → budget-2026-q4 (handoff) → approvals → signatories. It has 9 visit hops and 2 handoffs to Finance.
- `contract-run2` walks the learned 5-station route with 1 handoff.
- **Decision:** an explore run emits its `route` event at t=0.3 with the full path it ends up walking (`routeId: "explore-contract-signoff"`), because `stations` needs at least 1 entry and the presence/Workshop code needs something to draw. Every event carries `run`. Handoff ids are `<run>-h<n>`, so they never collide with demo-1's `h1`.
- Hop/tool-call counter: run1 = 9 visits / 31 events, run2 = 5 visits / 21 events.

## Synthetic tasks

50 per team (25 base facts × 2 phrasings), each with a ground-truth `route` (1-5 stations, all real ids). 8 base tasks have `expectedGaps` (SOC 2 owner ×4, evidence-tracker owner, Axis 2026 rate card, gross-margin cost model, Q3 access-review schedule). There is no `expectedStale` field (keeping to the requested shape). Training can derive stale from `palace.json` freshness under 0.3.

## Decisions made without asking

- Went to 68 pages (not 60) so each wing has two rooms with room to grow. Every room has 12 or fewer pages (People room exactly 12).
- Kept Phase 0 names (Mara Okafor, Dev Lindqvist, Raj Patel, Tomas Reyes, Priya Nand, Lena Vogt, Ada Chen). Added Iris Kowalczyk (Controller) and Nikhil Brandt (firmware lead). All are invented.
- Kept the fixture palace layout algorithm from Phase 0 (rooms 20 m, then 34 m out). The fixture palace now has all 68 memories, so web workspaces can develop against the full brain before export merges.
- Some Phase 0 freshness values moved slightly (e.g. `legal/approvals` 0.8 → 0.97, since its content is dated Sep 22). The verdicts in demo-1 are unchanged: `eng/security-policy` is still stale and every other demo-1 station is still 0.3 or higher.

## Contract proposals

None required. Optional: add `room?: string` to the documented page frontmatter (a hint only; palace.json is unaffected).
