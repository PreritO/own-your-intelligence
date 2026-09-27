// FORK OVERLAY. Copy to <qm>/src/delivery/grounding-delivery.ts (see qm/FORK.md §3). It won't compile
// in this repo because it imports upstream QM types; it is kept here as the fork's diff.
//
// Harness-enforced grounding (the pre-post check). Every outbound message from a loci-bound scope (a team
// agent or a commissioned quest agent) is checked before QM delivers it to Slack or the web transcript.
// The check itself belongs to the protocol service (:8790). This wrapper only asks and obeys:
//
//   POST <adapter>/grounding {scopeId, agent, threadRef, text}
//     The loci MCP adapter (qm/loci-mcp.ts) knows which protocol run and which assigned route this
//     scope's turn is bound to. It forwards to the protocol service:
//   POST :8790/grounding {agent, run, text, route} -> {verdict: "ok" | "annotate" | "block", text?, reason?, run?}
//
//   ok        deliver as-is, plus a palace replay link
//   annotate  deliver the service's rewritten text (gaps and stale stations stated)
//   block     deliver an "answer blocked" notice instead, with the service's reason. This is where the
//             route gate lands: an answer whose agent skipped a station on its assigned route, without
//             stating it as a gap, is blocked by the service and never posted as fact.
// Other scopes pass through untouched. The wrapper fails closed.
import type { DeliveryStore } from "./delivery-store.ts";
import { lociScopeAgent } from "../mindpalace/loci-scopes.ts";

const ADAPTER_URL = (process.env.LOCI_MCP_URL ?? "http://localhost:8791").replace(/\/$/, "");
const GROUNDING_URL = process.env.LOCI_GROUNDING_URL ?? `${ADAPTER_URL}/grounding`;
const PALACE_URL = (process.env.LOCI_PALACE_URL ?? "http://localhost:5173").replace(/\/$/, "");

type Grounding = { verdict: "ok" | "annotate" | "block"; text?: string; reason?: string; run?: string; skipped?: string[] };

async function checkGrounding(body: { scopeId: string; agent: string; threadRef?: string; text: string }): Promise<Grounding> {
  try {
    const res = await fetch(GROUNDING_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { verdict: "block", reason: `grounding check HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return (await res.json()) as Grounding;
  } catch (e) {
    // Fail closed: an answer that can't be checked is not posted as fact.
    return { verdict: "block", reason: `grounding check unreachable (${(e as Error).message})` };
  }
}

const replayLink = (run: string | undefined) => (run ? `\n\n[Walk this answer in the palace](${PALACE_URL}/?demo=${encodeURIComponent(run)})` : "");

export function withGroundingCheck(store: DeliveryStore): DeliveryStore {
  return {
    ...store,
    async enqueue(input) {
      const scope = input.provenance?.sourceScopeId as string | undefined;
      const agent = lociScopeAgent(scope);
      if (!scope || !agent || input.shadow || !input.text.trim()) return store.enqueue(input);
      const g = await checkGrounding({ scopeId: scope, agent, threadRef: input.provenance?.sourceThreadRef, text: input.text });
      console.log(`[loci-grounding] ${agent} scope=${scope} run=${g.run ?? "?"} verdict=${g.verdict}${g.reason ? ` reason=${g.reason}` : ""}`);
      const text =
        g.verdict === "block"
          ? `⛔ Answer blocked by the loci grounding check (protocol service): ${g.reason ?? "cites stations not verified in this run"}.`
          : (g.verdict === "annotate" && g.text ? g.text : input.text) + replayLink(g.run);
      // A web reply in its own thread normally "settles" against the assistant entry the model already
      // streamed. When the check changed the text, record the checked text as its own transcript entry.
      const provenance =
        input.provenance && g.verdict !== "ok" && input.provenance.sourceAssistantEntrySeq !== undefined
          ? (({ sourceAssistantEntrySeq: _drop, ...rest }) => rest)(input.provenance)
          : input.provenance;
      return store.enqueue({ ...input, text, ...(provenance ? { provenance } : {}) });
    },
  };
}
