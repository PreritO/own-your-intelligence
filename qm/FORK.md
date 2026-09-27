# The QM fork diff (design; upstream `yc-software/qm@a5a3667`)

The rule: QM stays a harness. All loci protocol logic (ownership, claims, verdicts, grounding) lives in the protocol service on :8790. The fork only (a) gives agents the tools, (b) makes handoffs a harness primitive, and (c) refuses to post an answer the service hasn't cleared.

| # | Change | Where in upstream | Size | Status |
| --- | --- | --- | --- | --- |
| 0 | Loci tools as an MCP connector | none; `qm/loci-mcp.ts` + `PUT /v1/admin/mcp-servers/loci-<team>` (ids must use hyphens) | 0 lines of core | **live**: 3 QM scopes on claude-sonnet-5 walking routes via :8790 |
| 1 | Scope-bound loci connectors + scope passed to MCP | `src/harness/agent-tools.ts` (MCP `execute`), `LOCI_SCOPES` env | ~33 lines | **applied** (`patches/qm-fork.patch`) |
| 2 | Handoff primitive, threaded in Slack | new `src/tools/handoff.ts`; registered in `createAgentTools()` next to `finishSilently` | ~80 lines | designed; handoff is logged by the service, but no wake/reply loop yet |
| 3 | Harness-enforced grounding | `src/delivery/grounding-delivery.ts` (overlay); wired at `src/wiring.ts:1678`; web path `src/core/orchestrator.ts` ~3776/~4010 | ~60 + 2 lines | **applied** for deliveries (Slack/cross-scope). The web path isn't covered: live blocking comes from the service's `answer` check |
| 4 | Palace replay link on answers | inside #3 (`replayLink`); alternatively `buildDebugFooter()` in `src/core/orchestrator/surface-tools.ts` | ~3 lines | in overlay |
| 5 | Palace UI plugin (read QM agents/scopes) | new `plugins/palace/`, reading `/v1/projects` and scope APIs; wings = scopes | stretch | not started |

## 0. Tools: an MCP connector, no core change

QM's MCP client (`src/mcp/mcp-client.ts`) POSTs JSON-RPC to `${url}/mcp`, skips the initialize handshake, and accepts plain JSON. It namespaces tools as `<serverId>_<tool>`. `qm/loci-mcp.ts` serves `/<agent>/mcp`, and each of the five tools becomes `POST :8790/<tool> {agent, ...args}`. A refusal or blocked answer comes back as `isError: true` tool output, so the model sees it and follows the protocol (for example, handing off after an ownership refusal).

The limitation this works around: `callMcpTool` passes the principal but not the scope, and connectors are org-wide. So the agent id comes from the URL, and nothing stops the Legal scope calling `loci-finance_visit`. The service still enforces ownership for whatever agent id it gets. Change #1 closes the gap.

## 1. Scope-aware MCP calls

```diff
--- a/src/harness/agent-tools.ts   (mcpTools → defineTool → execute, ~line 4043)
-            const out = await tc.callMcpTool(d.name, (params ?? {}) as Record<string, unknown>);
+            const args = { ...((params ?? {}) as Record<string, unknown>) };
+            if (d.serverId.startsWith("loci-")) args._qm = { scopeId: ref.scopeLabel, runId: ref.runId };
+            const out = await tc.callMcpTool(d.name, args);
```
`loci-mcp.ts` already prefers `_qm.scopeId` over the URL path. With this change, only one connector (`loci`) needs to be registered.

## 2. Handoffs as a harness primitive

Upstream facts: `src/slack/message-gating.ts:32` drops the bot's own messages, so a post in `#finance` does not wake the Finance agent. Swarms (`POST /v1/swarm`) stay inside one scope. Cross-scope wake is possible with the per-scope signed webhook (`agent-tools.ts:2699`, hmac-sha256).

The new `handoff` tool, in the harness:
1. Calls `POST :8790/handoff {agent, toAgent, memoryId, question}`. The service checks ownership, logs the handoff and emits the `handoff` event, then returns `{id}`.
2. Posts the question into `#<toAgent>` as a thread root with `reachEnqueue` (`surface-tools.ts:215`), then records `channelId:threadTs` via `withThread()` (`src/reach/reach.ts`).
3. Wakes the target scope with a turn whose `deliveryTarget` is that thread, so the reply lands threaded under the question. Plan A uses the target scope's signed webhook. Plan B adds a small core route: `POST /v1/scopes/:scopeId/turn {text, deliveryTarget}` → `orchestrator.runTurn`.
4. The owner agent answers with `reply(handoffId, answer)`, which goes to `:8790/reply` and emits the `reply` event. The harness then posts the reply in the thread and wakes the asking scope with it.

Claims ship with this primitive: `claim` is just the `:8790/claim` lease. The harness shows `wait`/`heldBy` in the thread and does nothing else.

## 3. Grounding before anything posts

Every outbound message in QM goes through one `DeliveryStore`, built at `src/wiring.ts:1678`:

```diff
--- a/src/wiring.ts
+import { withGroundingCheck } from "./delivery/grounding-delivery.ts";
@@ ~1678
-  const deliveries = withWebTranscriptDeliveries(
-    config.databaseUrl ? createPostgresDeliveryStore(config.databaseUrl) : createDeliveryStore(),
-    sessions,
-  );
+  const deliveries = withWebTranscriptDeliveries(
+    withGroundingCheck(config.databaseUrl ? createPostgresDeliveryStore(config.databaseUrl) : createDeliveryStore()),
+    sessions,
+  );
```

`withGroundingCheck` (see the overlay file) sends each delivery from a loci scope to `POST :8790/grounding` and obeys the verdict. `ok` gets a replay link appended. `annotate` delivers the service's text, with gaps and stale stations stated. `block` delivers a "blocked" notice. The wrapper fails closed.

Web replies stream from session entries rather than deliveries, so the same check wraps `result.reply` in `runHarnessTurn` (`src/core/orchestrator.ts` ~3776, and the direct-reply paths ~3905/~3976).

This needs a new protocol service endpoint (owned by ufo-ext): `POST /grounding {agent, run?, text} -> {verdict, text?, reason?, run?}`. It can reuse the `answer` check: the verdict is `ok` if this agent's last `answer` event in the run was not blocked, and `block` otherwise.

The demo beat "an ungrounded answer blocked live" works like this: the agent calls `answer` citing an unvisited station. The service emits `answer {blocked:true}` (the palace shows it) and returns `isError`. The Slack post is then replaced by the blocked notice.

## 4. Replay link

`replayLink(run)` produces `<http://localhost:5173/?demo=<run>|Walk this answer in the palace>`. `run` is the bridge's saved replay id (`fixtures/replays/run-<ts>.jsonl`), and the service returns it from `/grounding`. The alternative is to append it inside `buildDebugFooter()`, which already adds session links when `SURFACE_DEBUG_FOOTER=true`.
