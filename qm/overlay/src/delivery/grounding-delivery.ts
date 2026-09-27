// FORK OVERLAY. Copy to <qm>/src/delivery/grounding-delivery.ts (see qm/FORK.md §3). It won't compile
// in this repo because it imports upstream QM types; it is kept here as the fork's diff.
//
// Harness-enforced grounding: every outbound message from a loci-scoped agent (#legal, #finance, #eng)
// passes a grounding check before QM delivers it to Slack or the web. The check itself belongs to the
// protocol service (:8790). This wrapper only asks and obeys:
//   POST :8790/grounding {agent, run?, text} -> {verdict: "ok" | "annotate" | "block", text?, reason?}
//   ok        deliver as-is, plus a palace replay link
//   annotate  deliver the service's rewritten text (e.g. "Gap: no SOC 2 owner recorded" appended)
//   block     deliver a short "answer blocked" notice instead, naming the reason
// Other scopes pass through untouched.
import type { DeliveryStore } from "./delivery-store.ts";

const PROTOCOL_URL = (process.env.LOCI_PROTOCOL_URL ?? "http://localhost:8790").replace(/\/$/, "");
const PALACE_URL = (process.env.LOCI_PALACE_URL ?? "http://localhost:5173").replace(/\/$/, "");
const SCOPE_TO_AGENT: Record<string, string> = {
  "channel:legal": "legal",
  "channel:finance": "finance",
  "channel:eng": "eng",
};

type Grounding = { verdict: "ok" | "annotate" | "block"; text?: string; reason?: string; run?: string };

async function checkGrounding(agent: string, text: string, run: string | undefined): Promise<Grounding> {
  try {
    const res = await fetch(`${PROTOCOL_URL}/grounding`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent, text, ...(run ? { run } : {}) }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { verdict: "block", reason: `grounding service HTTP ${res.status}` };
    return (await res.json()) as Grounding;
  } catch (e) {
    // Fail closed: an answer that can't be checked is not posted as fact.
    return { verdict: "block", reason: `grounding service unreachable (${(e as Error).message})` };
  }
}

const replayLink = (run: string | undefined) =>
  run ? `\n<${PALACE_URL}/?demo=${encodeURIComponent(run)}|Walk this answer in the palace>` : "";

export function withGroundingCheck(store: DeliveryStore): DeliveryStore {
  return {
    ...store,
    async enqueue(input) {
      const scope = input.provenance?.sourceScopeId as string | undefined;
      const agent = scope ? SCOPE_TO_AGENT[scope] : undefined;
      if (!agent || input.shadow) return store.enqueue(input);
      const run = input.provenance?.sourceSessionId;
      const g = await checkGrounding(agent, input.text, run);
      const text =
        g.verdict === "block"
          ? `:no_entry: Answer blocked by grounding check: ${g.reason ?? "cites stations not verified in this run"}.`
          : (g.verdict === "annotate" && g.text ? g.text : input.text) + replayLink(g.run ?? run);
      return store.enqueue({ ...input, text });
    },
  };
}
