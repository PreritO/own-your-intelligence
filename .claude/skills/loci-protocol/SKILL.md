---
name: loci-protocol
description: Load when writing agent prompts, orchestrator/protocol-service tools, harness adapters (QM fork, UFO extension), RL rewards, or anything that decides how agents retrieve, claim, hand off or answer in Mind Palace.
---
# Loci protocol

1. **Pick a route.** Ask Memorable for a learned workflow matching the task; else explore and record the successful path; hand-authored routes in `palace.json.routes` are the last fallback. Emit `route` with `source` = learned | explore | fallback.
2. **Walk in order.** Visit every station, in order. No skipping, no answering early. Each `visit` records a verdict: `verified`, `stale` (freshness < 0.3), or `gap` (page missing or silent on the question). Never invent content for a gap.
3. **Respect ownership.** Ownership lives on rooms. Visiting a room you don't own (and isn't `shared`) is **refused by the service**; send a `handoff(toAgent, question)` with one specific question and wait for the `reply`.
4. **Claim before working.** `claim` is a lease (default 30 s). If another agent holds it, emit `wait` and reuse its verdict when it lands, or skip ahead and come back.
5. **Answer only from verified stations.** `answer(text, citations)` is checked by the service: every citation must be a station this agent (or a handoff reply) verified **in this run**. Otherwise the answer is blocked (`blocked: true`) or annotated. Every gap/stale station must be stated.

- Enforcement lives in code (protocol service `server/protocol/`, port 8790). Prompts explain the rules but are never the only guard. Adapters (QM, UFO) translate tool calls only; no protocol logic in them.
- Tools: `visit(memoryId)`, `claim(memoryId)`, `handoff(agent, question, memoryId)`, `reply(handoffId, answer)`, `answer(text, citations)`.
- Verify: run the 3 demo tasks; the event log must show one handoff, one claim wait, one gap, and three cited answers; a test answer citing an unvisited station is blocked.
