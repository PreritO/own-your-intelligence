// Fixture palace built from fixtures/seed-brain/ (the Acme Robotics seed brain).
// The real palace comes from server/export.ts; this one is the fixture every web workspace develops against.
// Deterministic: re-running produces byte-identical output (fixed TODAY, sorted ids, no randomness).
//
// Writes: fixtures/palace.json, fixtures/traces/demo-{1,2,3}.json,
//         fixtures/replays/{demo-1,contract-run1,contract-run2}.jsonl,
//         fixtures/learned-routes.json, fixtures/synthetic-tasks.jsonl
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Palace, Trace, PalaceEvent } from "../server/schema";

const BRAIN = "fixtures/seed-brain";
const TODAY = Date.UTC(2026, 8, 27); // 2026-09-27, the demo day. Fixed so output never drifts.
const GENERATED_AT = "2026-09-27T13:30:00Z";

// ---------- read the seed brain ----------
type Page = { id: string; title: string; type: string; team?: string; room: string; updated: string; body: string; links: { kind: string; to: string }[] };

function walk(dir: string): string[] {
  return readdirSync(dir).sort().flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : f.endsWith(".md") ? [p] : [];
  });
}

const problems: string[] = [];
const pages: Page[] = walk(BRAIN).map((file) => {
  const id = file.slice(BRAIN.length + 1, -3);
  const raw = readFileSync(file, "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing frontmatter`);
  const fm: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  const [body, linkSection = ""] = m[2].split(/\n## Links\n/);
  const links = [...linkSection.matchAll(/^- (\w+): \[\[([^\]|]+)(?:\|[^\]]*)?\]\]/gm)].map((x) => ({ kind: x[1], to: x[2] }));
  for (const k of ["title", "type", "room", "updated"]) if (!fm[k]) problems.push(`${id}: missing ${k}`);
  if (fm.team && !["finance", "legal", "eng"].includes(fm.team)) problems.push(`${id}: bad team ${fm.team}`);
  return { id, title: fm.title, type: fm.type, team: fm.team, room: fm.room, updated: fm.updated, body: body.trim(), links };
});
const pageIds = new Set(pages.map((p) => p.id));
for (const p of pages) {
  const targets = new Set(p.links.map((l) => l.to));
  if (targets.size < 2) problems.push(`${p.id}: links to ${targets.size} pages (need >= 2)`);
  for (const t of targets) if (!pageIds.has(t)) problems.push(`${p.id}: link to missing page ${t}`);
  for (const w of p.body.matchAll(/\[\[([^\]|]+)/g)) if (!targets.has(w[1])) problems.push(`${p.id}: body mentions [[${w[1]}]] without a typed link`);
}

const freshness = (updated: string) => {
  const days = (TODAY - Date.parse(`${updated}T00:00:00Z`)) / 86_400_000;
  return Math.round(Math.max(0, Math.min(1, 1 - days / 180)) * 100) / 100;
};
const plain = (s: string) =>
  s.replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, "$1").replace(/\[\[([^\]]+)\]\]/g, "$1").replace(/\s+/g, " ").trim();
const excerpt = (body: string) => {
  const first = plain(body.split(/\n\s*\n/)[0] ?? "");
  return first.length <= 200 ? first : first.slice(0, first.lastIndexOf(" ", 199)) + "…";
};

// ---------- layout ----------
type V3 = [number, number, number];
const ROOM: V3 = [12, 4, 12];
const r2 = (n: number) => Math.round(n * 100) / 100;

const wings = [
  { id: "people", label: "People", color: "#7aa2f7", owner: "shared", dir: [0, -1], rooms: ["People", "Partners"] },
  { id: "legal", label: "Legal", color: "#bb9af7", owner: "legal", dir: [1, 0], rooms: ["Contracts", "Corporate"] },
  { id: "finance", label: "Finance", color: "#e0af68", owner: "finance", dir: [0, 1], rooms: ["Board & Plans", "Budgets"] },
  { id: "eng", label: "Eng", color: "#9ece6a", owner: "eng", dir: [-1, 0], rooms: ["Security", "Platform"] },
] as const;

const rooms: any[] = [{ id: "foyer", wing: "foyer", owner: "shared", label: "Foyer", center: [0, 0, 0], size: ROOM, doors: [] as any[] }];
const wingOut: any[] = [];
const roomIdByLabel = new Map<string, string>(); // "wing/label" -> room id
for (const w of wings) {
  const ids: string[] = [];
  w.rooms.forEach((label, i) => {
    // room 0 sits 20 m from the foyer, each overflow room 14 m further out
    const dist = 20 + i * 14;
    const center: V3 = [w.dir[0] * dist, 0, w.dir[1] * dist];
    const id = `room-${w.id}-${i}`;
    const prev = i === 0 ? "foyer" : `room-${w.id}-${i - 1}`;
    const inner: V3 = [center[0] - w.dir[0] * 6, 0, center[2] - w.dir[1] * 6];
    rooms.push({ id, wing: w.id, owner: w.owner, label, center, size: ROOM, doors: [{ to: prev, pos: inner }] });
    const pc = rooms.find((x) => x.id === prev).center;
    rooms.find((x) => x.id === prev).doors.push({ to: id, pos: [pc[0] + w.dir[0] * 6, 0, pc[2] + w.dir[1] * 6] });
    roomIdByLabel.set(`${w.id}/${label}`, id);
    ids.push(id);
  });
  wingOut.push({ id: w.id, label: w.label, color: w.color, owner: w.owner, origin: rooms.find((x) => x.id === ids[0]).center, rooms: ids });
}

const byRoom = new Map<string, Page[]>();
for (const p of [...pages].sort((a, b) => a.id.localeCompare(b.id))) {
  const roomId = roomIdByLabel.get(`${p.team ?? "people"}/${p.room}`);
  if (!roomId) { problems.push(`${p.id}: unknown room "${p.room}" in wing ${p.team ?? "people"}`); continue; }
  if (!byRoom.has(roomId)) byRoom.set(roomId, []);
  byRoom.get(roomId)!.push(p);
}
const memories: any[] = [];
for (const [roomId, list] of byRoom) {
  if (list.length > 12) problems.push(`${roomId}: ${list.length} pages (max 12)`);
  const c = rooms.find((x) => x.id === roomId).center;
  list.forEach((p, i) => {
    // pedestals on a ring of radius 3.5 around the room center, sorted by id
    const a = (i / list.length) * Math.PI * 2 + Math.PI / 4;
    memories.push({
      id: p.id, title: p.title, type: p.type, room: roomId,
      pos: [r2(c[0] + Math.cos(a) * 3.5), 1.1, r2(c[2] + Math.sin(a) * 3.5)],
      freshness: freshness(p.updated), excerpt: excerpt(p.body), path: `${p.id}.md`,
    });
  });
}
memories.sort((a, b) => a.id.localeCompare(b.id));
const roomOf = (id: string) => memories.find((m) => m.id === id)!.room;

const seen = new Set<string>();
const links = pages
  .flatMap((p) => p.links.map((l) => ({ from: p.id, to: l.to, kind: l.kind })))
  .filter((l) => { const k = `${l.from}>${l.to}>${l.kind}`; return seen.has(k) ? false : (seen.add(k), true); })
  .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind));

if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  process.exit(1);
}

// ---------- routes (hand-authored fallbacks; demo relies on these exact stations) ----------
const ROUTES = {
  contract: ["companies/gripworks", "legal/gripworks-msa", "finance/budget-2026-q4", "legal/approvals", "people/signatories"],
  board: ["finance/board-2026-q3", "people/ada-chen", "people/org-chart"],
  soc2: ["eng/soc2-renewal", "eng/security-policy", "people/org-chart", "eng/soc2-owner"],
};
const Q = {
  contract: "Can we sign the Gripworks contract this week?",
  board: "What did we promise Ada in the last board meeting?",
  soc2: "Who owns the SOC 2 renewal?",
};

const palace = Palace.parse({
  version: 1,
  generatedAt: GENERATED_AT,
  wings: wingOut,
  rooms,
  memories,
  links,
  agents: [
    { id: "legal", label: "Legal agent", team: "legal", color: "#bb9af7", home: "room-legal-0" },
    { id: "finance", label: "Finance agent", team: "finance", color: "#e0af68", home: "room-finance-0" },
    { id: "eng", label: "Eng agent", team: "eng", color: "#9ece6a", home: "room-eng-0" },
  ],
  routes: [
    { id: "contract-signoff", label: "Contract sign-off", stations: ROUTES.contract },
    { id: "board-promises", label: "Board promises", stations: ROUTES.board },
    { id: "soc2-owner", label: "SOC 2 ownership", stations: ROUTES.soc2 },
  ],
});
writeFileSync("fixtures/palace.json", JSON.stringify(palace, null, 2) + "\n");

// ---------- traces (single-question retrieval walks) ----------
const traces: Record<string, any> = {
  "demo-1": {
    question: Q.contract,
    hops: [
      { step: 1, memoryId: "companies/gripworks", reason: "keyword match: Gripworks", score: 0.93 },
      { step: 2, memoryId: "legal/gripworks-msa", reason: "graph link: contract", score: 0.88 },
      { step: 3, memoryId: "finance/budget-2026-q4", reason: "graph link: funded_by", score: 0.76 },
      { step: 4, memoryId: "legal/approvals", reason: "graph link: approved_in", score: 0.71 },
      { step: 5, memoryId: "people/signatories", reason: "graph link: requires", score: 0.66 },
    ],
    answerMemoryIds: ["legal/approvals", "finance/budget-2026-q4", "people/signatories"],
    answer: "Yes, if Mara Okafor or Dev Lindqvist signs. Legal approved MSA v3 on Sep 22 and the $40k fits the $55k Q4 supplier line.",
  },
  "demo-2": {
    question: Q.board,
    hops: [
      { step: 1, memoryId: "finance/board-2026-q3", reason: "keyword match: board meeting, Ada", score: 0.91 },
      { step: 2, memoryId: "people/ada-chen", reason: "graph link: attended", score: 0.84 },
      { step: 3, memoryId: "finance/board-action-items", reason: "graph link: tracked_in", score: 0.72 },
      { step: 4, memoryId: "finance/gross-margin-plan", reason: "graph link: committed", score: 0.67 },
    ],
    answerMemoryIds: ["finance/board-2026-q3", "people/ada-chen", "finance/board-action-items"],
    answer: "At the Q3 board meeting (Aug 13) we committed to Ada Chen: a hardware gross-margin plan by Dec 15 and monthly burn updates. The August burn update went out; the margin plan is still an outline (owner Raj Patel).",
  },
  "demo-3": {
    question: Q.soc2,
    hops: [
      { step: 1, memoryId: "eng/soc2-renewal", reason: "keyword match: SOC 2 renewal", score: 0.94 },
      { step: 2, memoryId: "eng/soc2-owner", reason: "graph link: owned_by", score: 0.81 },
      { step: 3, memoryId: "eng/security-policy", reason: "graph link: governed_by (stale: last reviewed March)", score: 0.62 },
      { step: 4, memoryId: "people/org-chart", reason: "graph link: listed_in", score: 0.57 },
    ],
    answerMemoryIds: ["eng/soc2-renewal"],
    answer: "No owner is recorded. The SOC 2 Owner page is empty, the security policy is stale and names no compliance owner, and the org chart has no security or compliance lead. The renewal window opens Nov 1 with Brightline.",
  },
};
for (const [name, t] of Object.entries(traces)) writeFileSync(`fixtures/traces/${name}.json`, JSON.stringify(Trace.parse(t), null, 2) + "\n");

// ---------- replays ----------
const writeReplay = (name: string, ev: any[]) => {
  ev.forEach((e) => PalaceEvent.parse(e));
  writeFileSync(`fixtures/replays/${name}.jsonl`, ev.map((e) => JSON.stringify(e)).join("\n") + "\n");
};

// demo-1: canned multiplayer replay. One handoff, one claim wait, one gap, one stale, three answers.
writeReplay("demo-1", [
  { t: 0, agent: "legal", type: "task", text: Q.contract },
  { t: 0, agent: "finance", type: "task", text: Q.board },
  { t: 0, agent: "eng", type: "task", text: Q.soc2 },
  { t: 0.3, agent: "legal", type: "route", routeId: "contract-signoff", stations: ROUTES.contract, source: "fallback" },
  { t: 0.3, agent: "finance", type: "route", routeId: "board-promises", stations: ROUTES.board, source: "fallback" },
  { t: 0.3, agent: "eng", type: "route", routeId: "soc2-owner", stations: ROUTES.soc2, source: "fallback" },
  { t: 0.5, agent: "legal", type: "move", to: "room-people-0" },
  { t: 0.5, agent: "finance", type: "move", to: "room-finance-0" },
  { t: 0.5, agent: "eng", type: "move", to: "room-eng-0" },
  { t: 1.2, agent: "finance", type: "claim", memoryId: "finance/board-2026-q3" },
  { t: 1.4, agent: "eng", type: "claim", memoryId: "eng/soc2-renewal" },
  { t: 2.0, agent: "finance", type: "visit", memoryId: "finance/board-2026-q3", verdict: "verified" },
  { t: 2.2, agent: "eng", type: "visit", memoryId: "eng/soc2-renewal", verdict: "verified" },
  { t: 2.5, agent: "legal", type: "claim", memoryId: "companies/gripworks" },
  { t: 2.9, agent: "eng", type: "claim", memoryId: "eng/security-policy" },
  { t: 3.1, agent: "legal", type: "visit", memoryId: "companies/gripworks", verdict: "verified" },
  { t: 3.2, agent: "finance", type: "move", to: "room-people-0" },
  { t: 3.5, agent: "eng", type: "visit", memoryId: "eng/security-policy", verdict: "stale", note: "last reviewed March" },
  { t: 3.6, agent: "legal", type: "move", to: "room-legal-0" },
  { t: 3.9, agent: "finance", type: "claim", memoryId: "people/ada-chen" },
  { t: 4.0, agent: "eng", type: "move", to: "room-people-0" },
  { t: 4.3, agent: "legal", type: "claim", memoryId: "legal/gripworks-msa" },
  { t: 4.6, agent: "finance", type: "visit", memoryId: "people/ada-chen", verdict: "verified" },
  { t: 4.8, agent: "legal", type: "visit", memoryId: "legal/gripworks-msa", verdict: "verified" },
  { t: 5.3, agent: "eng", type: "claim", memoryId: "people/org-chart" },
  { t: 5.4, agent: "legal", type: "move", to: "room-finance-1" },
  { t: 5.6, agent: "finance", type: "wait", memoryId: "people/org-chart", heldBy: "eng" },
  { t: 6.2, agent: "eng", type: "visit", memoryId: "people/org-chart", verdict: "verified" },
  { t: 6.3, agent: "finance", type: "visit", memoryId: "people/org-chart", verdict: "verified", note: "reused eng's verdict" },
  { t: 6.4, agent: "legal", type: "handoff", id: "h1", toAgent: "finance", memoryId: "finance/budget-2026-q4", question: "Is Gripworks within Q4 budget?" },
  { t: 6.6, agent: "finance", type: "move", to: "room-finance-1" },
  { t: 6.8, agent: "eng", type: "move", to: "room-eng-0" },
  { t: 7.6, agent: "finance", type: "claim", memoryId: "finance/budget-2026-q4" },
  { t: 8.0, agent: "eng", type: "claim", memoryId: "eng/soc2-owner" },
  { t: 8.4, agent: "finance", type: "visit", memoryId: "finance/budget-2026-q4", verdict: "verified" },
  { t: 8.6, agent: "eng", type: "visit", memoryId: "eng/soc2-owner", verdict: "gap", note: "no owner recorded" },
  { t: 8.9, agent: "finance", type: "reply", id: "h1", answer: "Yes, $40k of $55k supplier line; $15k already committed." },
  { t: 9.2, agent: "finance", type: "answer", text: "At the Q3 board meeting we committed to Ada Chen: a hardware gross-margin plan by Dec 15 and monthly burn updates.", citations: ["finance/board-2026-q3", "people/ada-chen"] },
  { t: 9.4, agent: "legal", type: "move", to: "room-legal-0" },
  { t: 9.8, agent: "eng", type: "answer", text: "Gap: no SOC 2 owner is recorded. The renewal window opens Nov 1 (auditor Brightline); the security policy is stale and names no compliance owner.", citations: ["eng/soc2-renewal"], gaps: ["eng/soc2-owner"], stale: ["eng/security-policy"] },
  { t: 10.1, agent: "legal", type: "claim", memoryId: "legal/approvals" },
  { t: 10.7, agent: "legal", type: "visit", memoryId: "legal/approvals", verdict: "verified" },
  { t: 11.1, agent: "legal", type: "move", to: "room-people-0" },
  { t: 12.0, agent: "legal", type: "claim", memoryId: "people/signatories" },
  { t: 12.6, agent: "legal", type: "visit", memoryId: "people/signatories", verdict: "verified" },
  { t: 13.2, agent: "legal", type: "answer", text: "Yes, this week, if Mara Okafor or Dev Lindqvist signs. Legal approved MSA v3 on Sep 22 and Finance confirmed the $40k fits the Q4 supplier line.", citations: ["legal/gripworks-msa", "finance/budget-2026-q4", "legal/approvals", "people/signatories"] },
]);

// Workshop demo. Legal's stations are walked in order; stations in Finance's rooms go through a handoff.
// Emits move (only when the room changes), claim, visit; handoff + finance claim/visit/reply for finance rooms.
function walkRun(run: string, routeId: string, source: "explore" | "learned", stations: string[], notes: Record<string, string>, answer: string) {
  const ev: any[] = [
    { t: 0, agent: "legal", type: "task", text: Q.contract, run },
    { t: 0.3, agent: "legal", type: "route", routeId, stations, source, run },
  ];
  let t = 0.5, here = "", financeHere = "room-finance-0", h = 0;
  const at = (dt: number) => (t = r2(t + dt));
  for (const s of stations) {
    const room = roomOf(s);
    if (room !== here) { ev.push({ t, agent: "legal", type: "move", to: room, run }); here = room; at(0.6); }
    if (room.startsWith("room-finance")) {
      const id = `${run}-h${++h}`;
      const question = s === "finance/budget-2026-q4" ? "Is Gripworks within Q4 budget?" : "Does a $40k Gripworks contract need PO approval before signing?";
      const reply = s === "finance/budget-2026-q4" ? "Yes, $40k of $55k supplier line; $15k already committed." : "A PO over $25k needs Raj Patel, but a PO is not a contract signature. Check the budget line.";
      ev.push({ t, agent: "legal", type: "handoff", id, toAgent: "finance", memoryId: s, question, run }); at(0.3);
      if (financeHere !== room) { ev.push({ t, agent: "finance", type: "move", to: room, run }); financeHere = room; at(0.6); }
      ev.push({ t, agent: "finance", type: "claim", memoryId: s, run }); at(0.6);
      ev.push({ t, agent: "finance", type: "visit", memoryId: s, verdict: "verified", run }); at(0.3);
      ev.push({ t, agent: "finance", type: "reply", id, answer: reply, run }); at(0.4);
    } else {
      ev.push({ t, agent: "legal", type: "claim", memoryId: s, run }); at(0.6);
      ev.push({ t, agent: "legal", type: "visit", memoryId: s, verdict: "verified", ...(notes[s] ? { note: notes[s] } : {}), run }); at(0.4);
    }
  }
  ev.push({ t, agent: "legal", type: "answer", text: answer, citations: ["legal/gripworks-msa", "finance/budget-2026-q4", "legal/approvals", "people/signatories"], run });
  writeReplay(run, ev);
  return ev;
}

const CONTRACT_ANSWER = "Yes, this week, if Mara Okafor or Dev Lindqvist signs. Legal approved MSA v3 on Sep 22 and Finance confirmed the $40k fits the Q4 supplier line.";
const RUN1 = [
  "companies/gripworks", "legal/contract-playbook", "legal/voltcell-supply-agreement", "legal/gripworks-msa",
  "legal/vendor-onboarding", "finance/purchase-order-policy", "finance/budget-2026-q4", "legal/approvals", "people/signatories",
];
const run1 = walkRun("contract-run1", "explore-contract-signoff", "explore", RUN1, {
  "legal/contract-playbook": "general positions only, nothing Gripworks-specific",
  "legal/voltcell-supply-agreement": "wrong vendor, dead end",
  "legal/vendor-onboarding": "points to Finance for budget and PO route",
}, CONTRACT_ANSWER);
const run2 = walkRun("contract-run2", "contract-signoff", "learned", ROUTES.contract, {}, CONTRACT_ANSWER);

// ---------- learned routes (Memorable fallback store; Workshop floor paths) ----------
const learned = [
  { routeId: "contract-signoff", task: Q.contract, stations: ROUTES.contract, uses: 4 },
  { routeId: "board-promises", task: Q.board, stations: ["finance/board-2026-q3", "people/ada-chen", "finance/board-action-items"], uses: 2 },
  { routeId: "soc2-owner", task: Q.soc2, stations: ROUTES.soc2, uses: 1 },
  { routeId: "vendor-onboarding", task: "What do we need before onboarding a new supplier?", stations: ["legal/vendor-onboarding", "legal/nda-template", "eng/vendor-risk-reviews", "legal/contract-playbook", "people/signatories"], uses: 3 },
  { routeId: "burn-update", task: "What is our current burn and runway?", stations: ["finance/burn-report-2026-08", "finance/runway-forecast", "finance/venture-debt-facility"], uses: 5 },
];
for (const l of learned) for (const s of l.stations) if (!pageIds.has(s)) throw new Error(`learned ${l.routeId}: unknown station ${s}`);
writeFileSync("fixtures/learned-routes.json", JSON.stringify(learned, null, 2) + "\n");

// ---------- synthetic Gym tasks ----------
const tasks = synthetic().flatMap(([team, questions, route, expectedAnswer, expectedGaps = []]) =>
  questions.map((question) => ({ team, question, route, expectedAnswer, expectedGaps })));
for (const tk of tasks) for (const s of [...tk.route, ...tk.expectedGaps]) if (!pageIds.has(s)) throw new Error(`synthetic "${tk.question}": unknown page ${s}`);
writeFileSync("fixtures/synthetic-tasks.jsonl", tasks.map((tk) => JSON.stringify(tk)).join("\n") + "\n");

const perTeam = (t: string) => tasks.filter((x) => x.team === t).length;
const hops = (ev: any[]) => ev.filter((e) => e.type === "visit").length;
console.log(`palace: ${rooms.length} rooms, ${memories.length} memories, ${links.length} links`);
console.log(`replays: demo-1, contract-run1 (${hops(run1)} hops, ${run1.length} events), contract-run2 (${hops(run2)} hops, ${run2.length} events)`);
console.log(`learned routes: ${learned.length}; synthetic tasks: legal ${perTeam("legal")}, finance ${perTeam("finance")}, eng ${perTeam("eng")}`);

// [team, phrasings, ground-truth route, expected answer, expected gaps]. Two phrasings each -> 50 per team.
// Training (server/train) scales these up to ~300 per team.
type Syn = [team: "legal" | "finance" | "eng", questions: string[], route: string[], expectedAnswer: string, expectedGaps?: string[]];
function synthetic(): Syn[] {
  const contract = ["companies/gripworks", "legal/gripworks-msa", "finance/budget-2026-q4", "legal/approvals", "people/signatories"];
  return [
    // ---- legal ----
    ["legal", ["Can we sign the Gripworks contract this week?", "Is the Gripworks MSA ready for signature?"], contract,
      "Yes, if Mara Okafor or Dev Lindqvist signs. Legal approved MSA v3 on Sep 22 and the $40k fits the Q4 supplier line ($15k of $55k committed)."],
    ["legal", ["Who can sign a $40k vendor contract?", "Which executives may sign contracts above $30k?"], ["legal/approvals", "people/signatories", "legal/board-consents"],
      "The CEO (Mara Okafor) or COO (Dev Lindqvist); contracts over $30k need one of them."],
    ["legal", ["What payment terms are in the Gripworks MSA?", "Is the Gripworks deal Net-30 or Net-45?"], ["companies/gripworks", "legal/gripworks-msa"],
      "Net-45."],
    ["legal", ["What is the liability cap in the Gripworks MSA?", "Does the Gripworks liability cap match our playbook?"], ["companies/gripworks", "legal/gripworks-msa", "legal/contract-playbook"],
      "1x fees, which matches the Contract Playbook standard."],
    ["legal", ["When did Legal approve the Gripworks MSA?", "Has Tomas approved Gripworks v3 yet?"], ["legal/gripworks-msa", "legal/approvals"],
      "Tomas Reyes approved MSA v3 on Sep 22, pending budget confirmation."],
    ["legal", ["Can Tomas Reyes sign the Gripworks contract himself?", "Is the GC allowed to sign the $40k Gripworks MSA?"], ["legal/gripworks-msa", "people/signatories", "people/tomas-reyes"],
      "No. The GC can sign up to $30k; the $40k MSA needs the CEO or COO."],
    ["legal", ["What are the steps to onboard a new supplier?", "What do we need before a new vendor can be signed?"], ["legal/vendor-onboarding", "legal/nda-template", "eng/vendor-risk-reviews", "finance/purchase-order-policy", "people/signatories"],
      "Mutual NDA, vendor risk review, contract per the playbook, Finance budget and PO confirmation, then signature by an authorized signatory."],
    ["legal", ["What NDA do we use with suppliers?", "How long is our standard NDA term?"], ["legal/contract-playbook", "legal/nda-template"],
      "The mutual NDA template with a two-year term, used unchanged."],
    ["legal", ["What is our standard payment term for vendor contracts?", "What does the contract playbook say about payment terms and governing law?"], ["legal/contract-playbook", "legal/gripworks-msa"],
      "Net-45, liability cap 1x fees, 12-month default term, Delaware law."],
    ["legal", ["When does the Voltcell price review happen?", "What are the key terms of the Voltcell battery agreement?"], ["companies/voltcell", "legal/voltcell-supply-agreement"],
      "24-month agreement signed March 2025, $180k per year, Net-30, price review each April."],
    ["legal", ["Who signed the Voltcell supply agreement?", "Which executive signed our battery supply contract?"], ["legal/voltcell-supply-agreement", "people/mara-okafor"],
      "Mara Okafor."],
    ["legal", ["What is our 2026 freight rate with Axis Logistics?", "Which rate card applies to Axis shipments this year?"], ["companies/axis-logistics", "legal/axis-logistics-msa"],
      "Gap: the 2026 rate card was never attached to the signed Axis Logistics MSA.", ["legal/axis-logistics-msa"]],
    ["legal", ["Do we need an export license to ship arms to the EU?", "What export classification do our arms ship under?"], ["legal/export-controls", "companies/axis-logistics"],
      "No license needed for US and EU customers; the arm and controller ship under EAR99."],
    ["legal", ["Do we have a DPA with Harbor Cloud?", "Is Harbor Cloud covered for EU customer data?"], ["companies/harbor-cloud", "legal/harbor-cloud-dpa", "legal/approvals"],
      "Yes. The Harbor Cloud DPA was approved Jul 14 with standard contractual clauses attached."],
    ["legal", ["How long do we retain customer telemetry?", "Can customers ask us to delete their telemetry?"], ["legal/privacy-policy", "legal/harbor-cloud-dpa"],
      "Telemetry is retained 13 months and customers can request deletion."],
    ["legal", ["When is the soft wrist non-provisional patent due?", "What is the patent deadline for the Gripper v2 wrist?"], ["legal/patent-soft-wrist", "eng/gripper-v2"],
      "March 2027 (the US provisional covers the compliant wrist used with Gripper v2)."],
    ["legal", ["Is the GRIPPER V2 trademark registered?", "Which Acme trademarks are registered?"], ["legal/trademark-acme", "legal/series-a-docs"],
      "ACME ROBOTICS is registered in the US and EU; GRIPPER V2 is pending in the US."],
    ["legal", ["Who led our Series A and how much was it?", "How big was the Series A?"], ["legal/series-a-docs", "companies/lumen-ventures"],
      "$12M, led by Lumen Ventures in 2024."],
    ["legal", ["What investor rights does Lumen Ventures have?", "What do we owe our Series A lead each month?"], ["legal/series-a-docs", "companies/lumen-ventures", "people/ada-chen"],
      "One board observer seat (Ada Chen) and monthly financials."],
    ["legal", ["What did the August board consent decide about signature authority?", "Where is signature authority set?"], ["legal/board-consents", "people/signatories"],
      "The Aug 14 board consent reconfirmed that contracts over $30k need the CEO or COO."],
    ["legal", ["What are the Ferro Castings scrap terms?", "What payment terms apply to Ferro Castings POs?"], ["companies/ferro-castings", "legal/ferro-castings-po-terms"],
      "Per-PO pricing, Net-30, and scrap over 4% is credited back."],
    ["legal", ["Do contractors need to sign the IP assignment?", "When do new hires sign the invention assignment?"], ["legal/ip-assignment", "people/onboarding-guide"],
      "Yes, everyone signs on day one; contractor agreements without it are void for Eng work."],
    ["legal", ["Who maintains the contract approvals log?", "Who keeps Legal's approvals log?"], ["legal/approvals", "people/tomas-reyes"],
      "Tomas Reyes, the General Counsel."],
    ["legal", ["Which contracts did Legal approve this quarter?", "What is on the approvals log since July?"], ["legal/approvals", "legal/gripworks-msa", "legal/ferro-castings-po-terms", "legal/harbor-cloud-dpa"],
      "Gripworks MSA v3 (Sep 22), Ferro Castings PO terms (Aug 26) and the Harbor Cloud DPA (Jul 14)."],
    ["legal", ["Who is the compliance contact on Brightline's renewal engagement letter?", "Who should Brightline contact about the SOC 2 renewal?"], ["companies/brightline", "eng/soc2-renewal", "eng/soc2-owner"],
      "Gap: the compliance contact field is blank and no SOC 2 owner is recorded.", ["eng/soc2-owner"]],

    // ---- finance ----
    ["finance", ["What did we promise Ada in the last board meeting?", "What commitments did we make to the board observer in Q3?"], ["finance/board-2026-q3", "people/ada-chen", "people/org-chart"],
      "At the Q3 board meeting we committed to Ada Chen: a hardware gross-margin plan by Dec 15 and monthly burn updates."],
    ["finance", ["Is Gripworks within the Q4 budget?", "Does the $40k Gripworks contract fit Q4?"], ["finance/budget-2026-q4", "finance/supplier-spend-ledger"],
      "Yes: $40k of the $55k supplier line; $15k is already committed."],
    ["finance", ["How much of the Q4 supplier line is committed?", "What's left on the Q4 supplier budget?"], ["finance/budget-2026-q4", "finance/supplier-spend-ledger"],
      "$15k committed (the Ferro Castings PO), $40k remaining of $55k."],
    ["finance", ["Who approves a $30k purchase order?", "Who signs off POs over $25k?"], ["finance/purchase-order-policy", "people/raj-patel"],
      "Raj Patel, VP Finance (POs over $25k)."],
    ["finance", ["Who approves a $10k purchase order?", "Can the Controller approve small POs?"], ["finance/purchase-order-policy", "people/iris-kowalczyk"],
      "The Controller, Iris Kowalczyk (POs up to $25k)."],
    ["finance", ["What was August net burn?", "How much cash did we have at the end of August?"], ["finance/burn-report-2026-08", "people/iris-kowalczyk"],
      "Net burn $610k, cash $7.9M, runway 13 months."],
    ["finance", ["What is our runway including venture debt?", "How long does the undrawn debt extend runway?"], ["finance/runway-forecast", "finance/venture-debt-facility"],
      "13 months base case; 17 months with the undrawn $2M of venture debt."],
    ["finance", ["How much venture debt have we drawn?", "What is the size of the Northgate facility?"], ["finance/venture-debt-facility", "companies/northgate-bank"],
      "$2M of the $4M Northgate facility, drawn in May."],
    ["finance", ["What are the Northgate debt covenants?", "What does the bank require from us monthly?"], ["finance/venture-debt-facility", "companies/northgate-bank"],
      "Monthly financials and minimum cash of $2M."],
    ["finance", ["When is the gross-margin plan due and who owns it?", "Who is on the hook for the board margin plan?"], ["finance/gross-margin-plan", "finance/board-action-items", "people/raj-patel"],
      "Due to the board Dec 15; owner Raj Patel; currently an outline."],
    ["finance", ["What is our hardware gross margin versus the Series B bar?", "How far is gross margin from what Lumen expects?"], ["finance/board-2026-q3", "finance/gross-margin-plan", "companies/lumen-ventures"],
      "31% today against a 45% bar for a Series B."],
    ["finance", ["What does the gross-margin plan's cost model show?", "What unit cost does the margin plan assume?"], ["finance/gross-margin-plan", "eng/hardware-bom"],
      "Gap: the gross-margin plan is an outline and its cost model has not been started.", ["finance/gross-margin-plan"]],
    ["finance", ["What did the Q2 board meeting approve?", "Were there any Q2 board commitments?"], ["finance/board-2026-q2", "finance/operating-plan-2026", "finance/venture-debt-facility"],
      "The 2026 operating plan revision and the venture debt drawdown; no commitments to observers."],
    ["finance", ["What is the 2026 revenue plan?", "What headcount does the 2026 operating plan assume?"], ["finance/operating-plan-2026"],
      "$9.5M revenue, 52 people by year end, 38% hardware gross margin (the margin target has slipped)."],
    ["finance", ["How did Q3 supplier spend end?", "Did we stay within the Q3 supplier budget?"], ["finance/budget-2026-q3", "finance/supplier-spend-ledger"],
      "The $70k Q3 supplier line was fully committed and closed 4% over plan."],
    ["finance", ["What is the Q4 cloud budget?", "How much cloud budget is left in Q4?"], ["finance/budget-2026-q4", "eng/cloud-infra"],
      "$90k allocated, $88k committed, $2k remaining."],
    ["finance", ["What did the 2025 financial audit find?", "Why do we have a PO policy?"], ["finance/audit-2025", "finance/purchase-order-policy"],
      "Clean opinion; one recommendation to formalize PO approvals, which led to the current PO policy."],
    ["finance", ["How quickly must expenses be submitted?", "Do I need a receipt for a $40 expense?"], ["finance/expense-policy", "people/employee-handbook"],
      "Within 30 days; receipts are required over $50."],
    ["finance", ["What is the manager expense approval limit?", "Who approves a $3k expense?"], ["finance/expense-policy", "finance/purchase-order-policy"],
      "Managers approve up to $2k; anything above follows the Purchase Order Policy."],
    ["finance", ["Who prepares the monthly burn report?", "Who sends burn numbers to the board?"], ["finance/burn-report-2026-08", "people/iris-kowalczyk"],
      "Iris Kowalczyk, the Controller."],
    ["finance", ["What board action items are open?", "Where do we stand on the Q3 board follow-ups?"], ["finance/board-action-items", "finance/gross-margin-plan", "finance/burn-report-2026-08"],
      "Gross-margin plan due Dec 15 (Raj Patel, outline) and monthly burn updates (Iris Kowalczyk, August sent)."],
    ["finance", ["How much have we spent with Voltcell this year?", "Is any Voltcell spend committed in Q4?"], ["finance/supplier-spend-ledger", "companies/voltcell"],
      "$45k in Q3; nothing committed in Q4."],
    ["finance", ["Does PO approval count as a contract signature?", "Can Raj sign the Gripworks contract since he approves POs?"], ["finance/purchase-order-policy", "people/signatories"],
      "No. A PO is not a contract signature; contracts over $30k need the CEO or COO."],
    ["finance", ["Who holds the board observer seat?", "Which investor has an observer at our board meetings?"], ["companies/lumen-ventures", "people/ada-chen"],
      "Ada Chen from Lumen Ventures."],
    ["finance", ["Which levers feed the gross-margin plan?", "How do we plan to get hardware margin to 45%?"], ["finance/gross-margin-plan", "eng/hardware-bom", "eng/manufacturing-yield"],
      "Cheaper castings and lower scrap, BOM reduction, and Gripper v2 pricing."],

    // ---- eng ----
    ["eng", ["Who owns the SOC 2 renewal?", "Who is responsible for our SOC 2 audit this year?"], ["eng/soc2-renewal", "eng/security-policy", "people/org-chart", "eng/soc2-owner"],
      "Gap: no SOC 2 owner is recorded. The renewal window opens Nov 1 (auditor Brightline); the security policy is stale and names no compliance owner.", ["eng/soc2-owner"]],
    ["eng", ["When does the SOC 2 renewal window open?", "Which auditor is doing our SOC 2 renewal?"], ["eng/soc2-renewal", "companies/brightline"],
      "Nov 1, with Brightline."],
    ["eng", ["How much SOC 2 evidence has been collected?", "Are we on track with SOC 2 evidence?"], ["eng/soc2-evidence-tracker", "eng/soc2-renewal"],
      "3 of 34 controls have evidence filed; 31 not started."],
    ["eng", ["Who owns the SOC 2 evidence controls?", "Who is assigned to collect SOC 2 evidence?"], ["eng/soc2-evidence-tracker", "eng/soc2-owner"],
      "Gap: the owner column is blank for every control and no SOC 2 owner is recorded.", ["eng/soc2-evidence-tracker", "eng/soc2-owner"]],
    ["eng", ["When was the security policy last reviewed?", "Is the security policy current?"], ["eng/security-policy"],
      "Last reviewed in March; it is stale and does not reflect org changes since."],
    ["eng", ["Who is our compliance lead?", "Who replaced Halden Compliance?"], ["people/org-chart", "eng/security-policy", "companies/halden-compliance", "eng/soc2-owner"],
      "Gap: nobody. Halden Compliance's engagement ended in January and no compliance lead or SOC 2 owner is recorded.", ["eng/soc2-owner"]],
    ["eng", ["What exceptions did the 2025 SOC 2 report have?", "Did we pass SOC 2 last year?"], ["eng/soc2-2025-report"],
      "Unqualified opinion with two exceptions: a late access review and one missing vendor review."],
    ["eng", ["When was the Q2 access review completed?", "How many accounts were revoked in the Q2 access review?"], ["eng/access-review-2026-q2"],
      "Completed Jul 3, two days late; 212 accounts reviewed, 9 revoked."],
    ["eng", ["When is the Q3 access review scheduled?", "Who is running the Q3 access review?"], ["eng/access-review-2026-q2", "eng/security-policy"],
      "Gap: the Q3 access review is not yet scheduled.", ["eng/access-review-2026-q2"]],
    ["eng", ["Did Gripworks pass vendor risk review?", "Has security reviewed Gripworks?"], ["eng/vendor-risk-reviews", "companies/gripworks"],
      "Yes, Gripworks passed in August."],
    ["eng", ["What is the Sev-1 customer notice window?", "How fast must we notify customers of a Sev-1?"], ["eng/incident-response"],
      "Within 24 hours; Sev-1 also pages on-call."],
    ["eng", ["Who is on call this week?", "Who is primary on-call right now?"], ["eng/oncall-rotation", "people/nikhil-brandt"],
      "Nikhil Brandt."],
    ["eng", ["When does Firmware 4.2 ship?", "Is Firmware 4.2 on schedule?"], ["eng/firmware-release-4-2"],
      "Target Oct 8; the release candidate was cut Sep 24."],
    ["eng", ["What does Firmware 4.2 add?", "Which firmware release supports Gripper v2?"], ["eng/firmware-release-4-2", "eng/gripper-v2"],
      "Firmware 4.2 adds Gripper v2 support and force-limited grasping."],
    ["eng", ["When do Gripper v2 pilot builds start?", "What is blocking the Gripper v2 pilot?"], ["eng/gripper-v2", "legal/gripworks-msa"],
      "November, once the Gripworks MSA is signed."],
    ["eng", ["What is the unit BOM cost of the arm?", "What are the top BOM lines?"], ["eng/hardware-bom"],
      "$14.2k per unit; castings $3.1k, battery pack $2.4k, controller board $1.9k, gripper $1.2k."],
    ["eng", ["What is driving yield loss?", "Why did first-pass yield drop?"], ["eng/manufacturing-yield", "companies/ferro-castings"],
      "Casting porosity from Ferro Castings; first-pass yield fell from 91% in June to 86% in August."],
    ["eng", ["Where does fleet telemetry run?", "What does our cloud cost per month?"], ["eng/cloud-infra", "companies/harbor-cloud"],
      "Harbor Cloud, US-East and EU-Central, about $29k per month."],
    ["eng", ["What is the arm controller loop rate?", "What does the arm controller do?"], ["eng/arm-controller"],
      "A 1 kHz real-time joint loop with a safety-rated stop and telemetry uplink."],
    ["eng", ["What are Eng's H2 priorities?", "What is on the H2 2026 roadmap?"], ["eng/roadmap-2026-h2"],
      "Gripper v2 pilot, Firmware 4.2, 8% BOM cost cut, and passing the SOC 2 renewal."],
    ["eng", ["Who owns compliance on the H2 roadmap?", "Which engineer is assigned to SOC 2 on the roadmap?"], ["eng/roadmap-2026-h2", "eng/soc2-owner"],
      "Gap: compliance ownership is listed as TBD and no SOC 2 owner is recorded.", ["eng/soc2-owner"]],
    ["eng", ["Who ran SOC 2 audit prep last year?", "What happened to our compliance contractor?"], ["eng/soc2-2025-report", "companies/halden-compliance"],
      "Halden Compliance ran 2025 prep; their engagement ended in January 2026."],
    ["eng", ["Which suppliers are on the BOM?", "Who supplies arm castings and batteries?"], ["eng/hardware-bom", "companies/ferro-castings", "companies/voltcell", "companies/gripworks"],
      "Ferro Castings (castings), Voltcell (battery packs) and Gripworks (gripper parts)."],
    ["eng", ["Who leads Eng and how big is the team?", "How many engineers do we have?"], ["people/org-chart", "people/priya-nand"],
      "Priya Nand leads Eng, 34 people."],
    ["eng", ["Does Harbor Cloud's SOC 2 report count as our evidence?", "Which vendor reports are in the SOC 2 evidence?"], ["companies/harbor-cloud", "eng/soc2-evidence-tracker"],
      "Yes, Harbor Cloud's SOC 2 report is collected as evidence for Acme's audit."],
  ];
}
