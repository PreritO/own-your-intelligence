# NOTES: qm-multi

## Status (at the integrator's wrap-up call)
- **Done and verified live: handoffs wake the owning QM team agent.** `qm/handoffs.ts` follows the protocol's
  `GET /events`. On each `handoff`, it binds a new QM turn to the handoff's protocol run in the adapter, then
  sends a turn into the owner's QM project scope. The team agent (pi harness, claude-sonnet-5, with only its
  `loci-<team>_*` tools) calls claim, then visit, then `reply(handoffId, answer)`.
  - The adapter labels these replies "(replied by QM finance agent)".
  - If no reply lands within 45 s, the orchestrator answers instead: the owner re-verifies the page and Claude
    replies from that page only. The reply is labelled "(orchestrator fallback: ...)".
  - In every run so far the QM finance agent replied, in 6 to 8 s. The fallback was never needed.
- **Done: the route gate in the fork's pre-post grounding check.**
  - `withGroundingCheck` (overlay) sends every post from a loci scope to the adapter's `POST /grounding`. The
    adapter adds the bound protocol run and assigned route, then calls `:8790/grounding`.
  - Web posts are now recorded in the transcript as the text that was actually delivered.
  - Live result: legal skipped `legal/approvals`, and QM delivered "⛔ Answer blocked by the loci grounding
    check (protocol service): route not finished: legal/approvals".
- **Done: recorded fixture.** `fixtures/replays/qm-handoff.jsonl` is a real run with 3 QM agents (legal,
  finance, eng). Legal's handoff h1 to finance was answered by the QM finance agent. It passes `bun run validate`.
- **Not done: item 2, where the quest agent runs fully in QM.** It was designed but not built before the freeze.
  `server/commission/qm.ts` is unchanged: QM still drives only run 2. See "Hook needed" below.

## Setup I used (alternate ports; I did not touch the shared instance)
- **A second QM instance.** A clonefile copy of the QM clone at `~/Desktop/projects/qm-multi`, with
  `qm/patches/qm-fork.patch` applied and `qm/overlay/` copied in. `dev up` claimed slot pool2: core :8082,
  portal :8130, web :8098. It uses its own Postgres database.
  - The shared instance (pool1: :8081/:8129) runs with file watching on `~/Desktop/projects/qm-upstream`.
    Editing that tree would have reloaded someone else's QM, so I left it alone.
- **Protocol service** on :8990 and the **loci adapter** on :8991.

## Reproduce
```bash
# QM copy (once): cp -c -R ~/Desktop/projects/qm-upstream ~/Desktop/projects/qm-multi, restore upstream files,
# then apply qm/patches/qm-fork.patch and copy qm/overlay/src/* into src/
cd ~/Desktop/projects/qm-multi && PI_MODEL=claude-sonnet-5 DEV_INSTANCE_ORG_ID=acme \
  LOCI_SCOPES_FILE=<repo>/qm/state/scopes.json LOCI_MCP_URL=http://localhost:8991 \
  npm_config_legacy_peer_deps=false node scripts/dev/cli.ts up --surface web
# in the repo
PROTOCOL_PORT=8990 bun run protocol
LOCI_MCP_PORT=8991 PROTOCOL_URL=http://localhost:8990 bun qm/loci-mcp.ts
export QM_CORE_URL=http://localhost:8082 QM_PORTAL_URL=http://localhost:8130 LOCI_MCP_URL=http://localhost:8991 PROTOCOL_URL=http://localhost:8990
bun qm/qm-admin.ts setup                                   # legal/finance/eng projects, loci-<team> + loci-quest connectors, scope map
bun qm/qm-admin.ts demo --record qm-handoff                # 3 QM agents; finance replies to legal's handoff via QM
bun qm/qm-admin.ts demo --skip-gap legal/approvals legal   # route gate: the post is blocked
bun qm/handoffs.ts                                         # standalone relay for any run (skips quest-* handoffs)
```

## Protocol request for verify (route gate: "unless stated as a gap")
Today `/answer` blocks a skipped route station without exception ("route not finished: X"), and `/grounding`
repeats the verdict of the agent's last answer. The spec says a skipped station is allowed when the answer
states it as a gap. In the live run, legal's answer said "Gap: legal/approvals (the Legal Approvals Log) was
flagged unavailable today and was not visited", and it was still blocked. The exact request:

```
POST /grounding {agent, run, text, route?: string[]}      # the adapter already sends route (the assigned stations)
  skipped  = [s for s in (route or run.routes[agent]) if (agent, s) not in run.verdicts]
  unstated = [s for s in skipped if not (s in text or title(s) in text) near "gap"]
  -> unstated: {verdict: "block", reason: "route gate: skipped <ids> (not stated as a gap)", skipped: unstated}
  -> skipped but all stated: fall through to the normal ok/annotate checks
```
`/answer`'s "route not finished" should apply the same exemption, so that `answer` and `grounding` agree.

## Hook needed for item 2 (quest fully in QM)
`server/commission/quest.ts` only exposes `onExecute`. To let QM run plan, explore and execute, the quest
needs one hook:
`QuestHooks.runQuest?: (info: QuestInfo, quest: QuestDef | null) => Promise<void>`. When it is set,
`startQuest` calls it instead of `runQuest(...)`. The adapter already serves the quest tools on the shared
`loci-quest` connector: `plan`, `start_explore`, `claim`, `visit`, `handoff`, `await_replies`, `reflect`,
`write_page` and `answer`. It resolves `quest-<n>` from the scope map, so a new quest scope binds without a
QM restart.

## Calls I made
- I wrote the fixture as a cut of an existing verified run (`qm-demo-2026-09-27T22-38-58`), not a new
  recording, per the integrator's wrap-up instruction.
- The reply label goes in the reply text, because the schema has no source field for `reply`.
- Handoff wake turns end with `finish_silently`, so a team agent's reply-only turn posts nothing. If it did
  post, the gate would block it: no answer was made in that turn.
