// Dev helper for a local QM instance (scripts/dev-instance.sh up). It signs core admin calls the same
// way QM's admin plugin does, and sends turns through the portal.
//
//   bun qm/qm-admin.ts register                 # PUT loci-legal / loci-finance / loci-eng MCP connectors
//   bun qm/qm-admin.ts servers                  # list registered MCP servers
//   bun qm/qm-admin.ts turn legal "Can we sign the Gripworks contract this week?"
//   bun qm/qm-admin.ts run <runId>              # poll a run
//
// Core admin routes need source-auth (HMAC over "METHOD\npath\nbody" with CORE_SIGNING_SECRET). The dev
// instance derives that secret itself and doesn't write it anywhere. Take it from CORE_SIGNING_SECRET, or
// read it from the environment of the local core process (listening on :8081). It is never printed.
import { createHmac } from "node:crypto";
import { pickRoute } from "../server/routes";

const CORE = process.env.QM_CORE_URL ?? "http://localhost:8081";
const PORTAL = process.env.QM_PORTAL_URL ?? "http://localhost:8129";
const ORG = process.env.QM_ORG ?? "acme";
const ADMIN = process.env.QM_ADMIN_PRINCIPAL ?? process.env.USER ?? "dev-admin";
const LOCI_MCP = (process.env.LOCI_MCP_URL ?? "http://localhost:8791").replace(/\/$/, "");
const AGENTS = ["legal", "finance", "eng"] as const;

function coreSecret(): string {
  if (process.env.CORE_SIGNING_SECRET) return process.env.CORE_SIGNING_SECRET;
  const port = new URL(CORE).port || "80";
  const pids = Bun.spawnSync(["lsof", "-tiTCP:" + port, "-sTCP:LISTEN"]).stdout.toString().trim().split("\n").filter(Boolean);
  for (const pid of pids) {
    const env = Bun.spawnSync(["ps", "eww", "-o", "command=", "-p", pid]).stdout.toString();
    const m = env.match(/\bCORE_SIGNING_SECRET=(\S+)/);
    if (m) return m[1]!;
  }
  throw new Error(`CORE_SIGNING_SECRET not set and not found on the core process at ${CORE}`);
}

export async function core(method: string, path: string, body?: unknown) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000);
  const sig = "v0=" + createHmac("sha256", coreSecret()).update(`v0:${ts}:${method}\n${path}\n${raw}`).digest("hex");
  const res = await fetch(CORE + path, {
    method,
    headers: { "content-type": "application/json", "x-timestamp": String(ts), "x-signature": sig, "x-admin-actor": `${ADMIN}@${ORG}` },
    ...(raw ? { body: raw } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

export async function portal(method: string, path: string, body?: unknown) {
  const res = await fetch(PORTAL + path, {
    method,
    headers: { "content-type": "application/json", origin: PORTAL },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.text() };
}

// Team agents are QM project scopes named legal / finance / eng (group:web-project-<id>): each gets its
// own memory, files and sandbox. `setup` creates any that are missing.
async function teamScopes(): Promise<Record<string, string>> {
  const r = await core("GET", `/v1/projects?principalId=${encodeURIComponent(ADMIN)}`);
  const projects = (JSON.parse(r.body).projects ?? []) as { name: string; scopeId: string }[];
  const out: Record<string, string> = {};
  for (const p of projects) if ((AGENTS as readonly string[]).includes(p.name) && !out[p.name]) out[p.name] = p.scopeId;
  return out;
}

async function registerConnectors() {
  for (const a of AGENTS) {
    const r = await core("PUT", `/v1/admin/mcp-servers/loci-${a}`, {
      name: `Loci protocol (${a})`,
      url: `${LOCI_MCP}/${a}`,
      auth: "none",
      readOnly: false,
      enabled: true,
    });
    const tools = r.status === 200 ? (JSON.parse(r.body).tools ?? []).join(",") : r.body.slice(0, 200);
    console.log(`connector loci-${a}: HTTP ${r.status} tools=${tools}`);
  }
}

const TASKS: Record<string, string> = {
  legal: "Can we sign the Gripworks contract this week?",
  finance: "What did we promise Ada in the last board meeting?",
  eng: "Who owns the SOC 2 renewal?",
};
// Loci protocol step 1: the harness picks the route (learned -> fallback -> explore) and hands it over.
const brief = (agent: string, task: string) => {
  const route = pickRoute(task);
  return (
  `You are the ${agent} team agent at Acme Robotics. Task: ${task}\n` +
  `Your route (${route.source} route ${route.routeId}), in order: ${route.stations.join(" -> ")}.\n` +
  `Follow the loci protocol with your loci-${agent}_* tools only: for each station on your route, call ` +
  `loci-${agent}_claim then loci-${agent}_visit, in order, never skipping. If a room is refused, use ` +
  `loci-${agent}_handoff to the owning agent. Finish with loci-${agent}_answer citing only verified stations, ` +
  `and state every gap. Never invent content for a gap.`
  );
};

async function turn(agent: string, text: string) {
  const scopes = await teamScopes();
  const scopeId = scopes[agent];
  if (!scopeId) throw new Error(`no QM project named ${agent}; run: bun qm/qm-admin.ts setup`);
  const r = await portal("POST", "/api/turn", { text, threadRef: `web:${ADMIN}:loci-${agent}-${Date.now()}`, scopeId, channelName: agent });
  console.log(`${agent} (${scopeId}): HTTP ${r.status} ${r.body.slice(0, 300)}`);
  return r.status < 300 ? (JSON.parse(r.body).runId as string | undefined) : undefined;
}

// Commissioned quests (server/commission/qm.ts): one QM project named "quest" drives quest agents' run 2.
export async function questScope(): Promise<string | undefined> {
  const r = await core("GET", `/v1/projects?principalId=${encodeURIComponent(ADMIN)}`);
  const projects = (JSON.parse(r.body).projects ?? []) as { name: string; scopeId: string }[];
  return projects.find((p) => p.name === "quest")?.scopeId;
}

const [cmd, ...args] = import.meta.main ? process.argv.slice(2) : ["--imported"];
if (cmd === "--imported") {
  // imported as a module: no CLI
} else if (cmd === "quest-setup") {
  if (!(await questScope())) console.log("create project quest:", (await portal("POST", "/api/projects", { name: "quest" })).status);
  console.log("quest scope:", await questScope());
  const r = await core("PUT", "/v1/admin/mcp-servers/quest-loci", {
    name: "Loci protocol (commissioned quest)",
    url: `${process.env.QUEST_MCP_URL ?? "http://localhost:8792"}/quest-1`,
    auth: "none",
    readOnly: false,
    enabled: true,
  });
  console.log(`connector quest-loci: HTTP ${r.status} ${r.status === 200 ? (JSON.parse(r.body).tools ?? []).join(",") : r.body.slice(0, 200)}`);
} else if (cmd === "setup") {
  const have = await teamScopes();
  for (const a of AGENTS) if (!have[a]) await portal("POST", "/api/projects", { name: a });
  console.log("scopes:", JSON.stringify(await teamScopes()));
  await registerConnectors();
} else if (cmd === "register") {
  await registerConnectors();
} else if (cmd === "scopes") {
  console.log(JSON.stringify(await teamScopes(), null, 2));
} else if (cmd === "servers") {
  const r = await core("GET", "/v1/admin/mcp-servers");
  console.log(r.status, r.body);
} else if (cmd === "core" && args[0] && args[1]) {
  const r = await core(args[0], args[1], args[2] ? JSON.parse(args[2]) : undefined);
  console.log(r.status, r.body);
} else if (cmd === "portal" && args[0] && args[1]) {
  const r = await portal(args[0], args[1], args[2] ? JSON.parse(args[2]) : undefined);
  console.log(r.status, r.body);
} else if (cmd === "turn" && args[0] && args[1]) {
  await turn(args[0], args[1]);
} else if (cmd === "demo") {
  // The three demo tasks, one per team scope, all at once. Pass agent names to run a subset.
  const who = args.length ? args : [...AGENTS];
  await Promise.all(who.map((a) => turn(a, brief(a, TASKS[a] ?? a))));
} else if (cmd === "run" && args[0]) {
  const r = await portal("GET", `/api/runs/${encodeURIComponent(args[0])}`);
  console.log(r.status, r.body);
} else {
  console.error(
    'usage: bun qm/qm-admin.ts setup | register | scopes | servers | demo [agent...] | turn <legal|finance|eng> "<text>" | run <runId> | core|portal <METHOD> <path> [json]',
  );
  process.exit(1);
}
