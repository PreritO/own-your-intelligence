// Loci protocol tools for QM agents, served as an MCP connector. This is a thin adapter: each tool call
// becomes one HTTP POST to the protocol service on :8790, and the result comes back unchanged. There is
// no protocol logic here. Ownership, claims, verdicts and grounding are all enforced by the service.
//
//   bun qm/loci-mcp.ts                 # :8791, PROTOCOL_URL defaults to http://localhost:8790
//
// Register it in QM, one connector per team agent. QM's MCP client POSTs JSON-RPC to `${url}/mcp`,
// with no initialize handshake, and it accepts plain JSON replies (src/mcp/mcp-client.ts):
//   curl -XPUT localhost:8081/v1/admin/mcp-servers/loci-legal   -d '{"url":"http://localhost:8791/legal","auth":"none","enabled":true}'
//   curl -XPUT localhost:8081/v1/admin/mcp-servers/loci-finance -d '{"url":"http://localhost:8791/finance","auth":"none","enabled":true}'
//   curl -XPUT localhost:8081/v1/admin/mcp-servers/loci-eng     -d '{"url":"http://localhost:8791/eng","auth":"none","enabled":true}'
// QM exposes these as tools like `loci-legal_visit`. Upstream QM passes the principal to MCP servers
// but not the scope, and connectors are visible org-wide, so the agent id comes from the URL path.
// The fork change in qm/FORK.md §1 injects `_qm.scopeId`. When present, it overrides the path.
const PORT = Number(process.env.LOCI_MCP_PORT ?? 8791);
const PROTOCOL_URL = (process.env.PROTOCOL_URL ?? "http://localhost:8790").replace(/\/$/, "");
const PREFIX = process.env.LOCI_TOOL_PREFIX ?? ""; // e.g. "/tools" if the service mounts tools there
const SHARED_RUN = process.env.LOCI_RUN ?? ""; // optional fixed protocol run id; default = the service's current run
const AGENTS = new Set(["legal", "finance", "eng"]);
const SCOPE_TO_AGENT: Record<string, string> = { "channel:legal": "legal", "channel:finance": "finance", "channel:eng": "eng" };

const str = (description: string) => ({ type: "string", description });
const TOOLS = [
  {
    name: "visit",
    description:
      "Walk to a station (memory id) on your route and read it. Returns the page and a verdict: verified, stale, or gap. Visit every station in order. Rooms you don't own are refused; use handoff instead.",
    inputSchema: { type: "object", properties: { memoryId: str("GBrain page slug, e.g. legal/gripworks-msa") }, required: ["memoryId"] },
  },
  {
    name: "claim",
    description: "Claim a station before working on it (a 30 s lease). If another agent holds it you get wait + heldBy; reuse its verdict or move on and come back.",
    inputSchema: { type: "object", properties: { memoryId: str("station to claim") }, required: ["memoryId"] },
  },
  {
    name: "handoff",
    description: "Ask the agent that owns a room one specific question about a station you may not read. Returns a handoffId. The owner answers with reply.",
    inputSchema: {
      type: "object",
      properties: { toAgent: str("legal | finance | eng"), memoryId: str("the station in their room"), question: str("one specific question") },
      required: ["toAgent", "memoryId", "question"],
    },
  },
  {
    name: "reply",
    description: "Answer a handoff that was sent to you, using only stations you verified.",
    inputSchema: { type: "object", properties: { handoffId: str("id from the handoff"), answer: str("your answer") }, required: ["handoffId", "answer"] },
  },
  {
    name: "answer",
    description:
      "Post your final answer. Every citation must be a station you (or a handoff reply) verified in this run, or the answer is blocked. State every gap and stale station.",
    inputSchema: {
      type: "object",
      properties: { text: str("the answer"), citations: { type: "array", items: { type: "string" }, description: "verified station ids" } },
      required: ["text", "citations"],
    },
  },
] as const;
const TOOL_NAMES = new Set<string>(TOOLS.map((t) => t.name));

type Rpc = { jsonrpc: "2.0"; id?: number | string | null; method: string; params?: Record<string, unknown> };
const ok = (id: Rpc["id"], result: unknown) => Response.json({ jsonrpc: "2.0", id: id ?? null, result });
const err = (id: Rpc["id"], code: number, message: string) => Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function callTool(agentFromPath: string, name: string, args: Record<string, unknown>) {
  const { _qm, ...rest } = args as { _qm?: { scopeId?: string; sessionId?: string; runId?: string } };
  const agent = (_qm?.scopeId && SCOPE_TO_AGENT[_qm.scopeId]) || agentFromPath;
  console.log(`→ ${agent}.${name}(${JSON.stringify(rest)})${_qm?.scopeId ? ` scope=${_qm.scopeId}` : ""}`);
  const res = await fetch(`${PROTOCOL_URL}${PREFIX}/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // All three team agents must share one protocol run, so handoffs, claims and waits can cross agents.
    // Each QM turn has its own runId, so that id is passed as qmRunId, not as the protocol `run`.
    body: JSON.stringify({ agent, ...rest, ...(SHARED_RUN ? { run: SHARED_RUN } : {}), ...(_qm?.runId ? { qmRunId: _qm.runId } : {}) }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.text();
  // A refusal or a blocked answer is protocol feedback the agent must see, so it comes back as a tool
  // result with isError set, not as a transport error.
  return { content: [{ type: "text", text: body || `HTTP ${res.status}` }], isError: !res.ok };
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/(\w+)\/mcp\/?$/);
    if (!m) return new Response("POST /<legal|finance|eng>/mcp\n", { status: 404 });
    const agent = m[1]!;
    if (!AGENTS.has(agent)) return new Response(`unknown agent ${agent}\n`, { status: 404 });
    if (req.method !== "POST") return new Response(null, { status: 405 });
    let rpc: Rpc;
    try {
      rpc = (await req.json()) as Rpc;
    } catch {
      return err(null, -32700, "parse error");
    }
    if (rpc.id === undefined) return new Response(null, { status: 202 }); // notification
    switch (rpc.method) {
      case "initialize":
        return ok(rpc.id, {
          protocolVersion: (rpc.params?.protocolVersion as string) ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: `loci-${agent}`, version: "0.1.0" },
        });
      case "ping":
        return ok(rpc.id, {});
      case "tools/list":
        return ok(rpc.id, { tools: TOOLS });
      case "tools/call": {
        const name = String(rpc.params?.name ?? "");
        if (!TOOL_NAMES.has(name)) return err(rpc.id, -32602, `unknown tool ${name}`);
        try {
          return ok(rpc.id, await callTool(agent, name, (rpc.params?.arguments as Record<string, unknown>) ?? {}));
        } catch (e) {
          return ok(rpc.id, { content: [{ type: "text", text: `protocol service unreachable: ${(e as Error).message}` }], isError: true });
        }
      }
      default:
        return err(rpc.id, -32601, `method not found: ${rpc.method}`);
    }
  },
});
console.log(`loci MCP adapter on http://localhost:${PORT}/<legal|finance|eng>/mcp -> ${PROTOCOL_URL}${PREFIX}/<tool>`);
