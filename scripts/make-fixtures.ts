// Phase 0 hand-authored fixture palace. The real one comes from server/export.ts.
// Deterministic: re-running produces byte-identical output.
import { writeFileSync } from "node:fs";

type V3 = [number, number, number];
const ROOM: V3 = [12, 4, 12];
const r = (n: number) => Math.round(n * 100) / 100;

const wings = [
  { id: "people", label: "People", color: "#7aa2f7", owner: "shared", dir: [0, -1] },
  { id: "legal", label: "Legal", color: "#bb9af7", owner: "legal", dir: [1, 0] },
  { id: "finance", label: "Finance", color: "#e0af68", owner: "finance", dir: [0, 1] },
  { id: "eng", label: "Eng", color: "#9ece6a", owner: "eng", dir: [-1, 0] },
] as const;

// room index 0 sits 20 m from the foyer, each overflow room 14 m further out
const roomsByWing: Record<string, string[]> = {
  people: ["People"], legal: ["Contracts"], finance: ["Board & Plans", "Budgets"], eng: ["Security"],
};

const rooms: any[] = [
  { id: "foyer", wing: "foyer", owner: "shared", label: "Foyer", center: [0, 0, 0], size: ROOM, doors: [] as any[] },
];
const foyer = rooms[0];
const wingOut: any[] = [];
for (const w of wings) {
  const ids: string[] = [];
  roomsByWing[w.id].forEach((label, i) => {
    const dist = 20 + i * 14;
    const center: V3 = [w.dir[0] * dist, 0, w.dir[1] * dist];
    const id = `room-${w.id}-${i}`;
    const prev = i === 0 ? "foyer" : `room-${w.id}-${i - 1}`;
    const inner: V3 = [center[0] - w.dir[0] * 6, 0, center[2] - w.dir[1] * 6];
    const room = { id, wing: w.id, owner: w.owner, label, center, size: ROOM, doors: [{ to: prev, pos: inner }] };
    rooms.push(room);
    const prevRoom = rooms.find((x) => x.id === prev);
    const pc = prevRoom.center;
    prevRoom.doors.push({ to: id, pos: [pc[0] + w.dir[0] * 6, 0, pc[2] + w.dir[1] * 6] });
    ids.push(id);
  });
  wingOut.push({ id: w.id, label: w.label, color: w.color, owner: w.owner, origin: rooms.find((x) => x.id === ids[0]).center, rooms: ids });
}

const mem: [string, string, string, string, number, string][] = [
  // id, title, type, room, freshness, excerpt
  ["people/ada-chen", "Ada Chen", "person", "room-people-0", 0.85, "Board observer from Lumen Ventures. At the Q3 board meeting she asked for a hardware gross-margin plan by year end."],
  ["people/raj-patel", "Raj Patel", "person", "room-people-0", 0.62, "VP Finance. Owns the Q4 budget and signs purchase orders over $25k."],
  ["people/signatories", "Authorized Signatories", "policy", "room-people-0", 0.7, "Contracts over $30k need the CEO (Mara Okafor) or COO (Dev Lindqvist) to sign."],
  ["people/org-chart", "Org Chart", "reference", "room-people-0", 0.55, "Acme Robotics, 48 people. Teams: Finance (Raj Patel), Legal (Tomas Reyes), Eng (Priya Nand), People (Lena Vogt)."],
  ["companies/gripworks", "Gripworks", "company", "room-people-0", 0.78, "Supplier of soft robotic grippers. Proposed a 12-month supply agreement at $40k."],
  ["legal/gripworks-msa", "Gripworks MSA", "contract", "room-legal-0", 0.9, "Master services agreement draft v3. Net-45 payment, 12-month term, liability cap 1x fees. Redlines resolved Sep 20."],
  ["legal/approvals", "Legal Approvals Log", "log", "room-legal-0", 0.8, "Gripworks MSA v3 approved by Tomas Reyes on Sep 22, pending budget confirmation."],
  ["finance/board-2026-q3", "Q3 Board Meeting Notes", "meeting", "room-finance-0", 0.66, "Committed to Ada Chen: a hardware gross-margin plan by Dec 15 and monthly burn updates."],
  ["finance/budget-2026-q4", "Q4 2026 Budget", "budget", "room-finance-1", 0.74, "Supplier line: $55k allocated, $15k committed. Gripworks ($40k) fits within the line."],
  ["eng/soc2-renewal", "SOC 2 Renewal", "project", "room-eng-0", 0.5, "SOC 2 Type II renewal window opens Nov 1. Auditor: Brightline. Evidence collection not started."],
  ["eng/security-policy", "Security Policy", "policy", "room-eng-0", 0.15, "Information security policy, last reviewed March. Lists controls but names no compliance owner."],
  ["eng/soc2-owner", "SOC 2 Owner", "role", "room-eng-0", 0.1, ""],
];

// pedestals on a ring of radius 3.5 around the room center, sorted by id
const byRoom = new Map<string, typeof mem>();
for (const m of [...mem].sort((a, b) => a[0].localeCompare(b[0]))) {
  if (!byRoom.has(m[3])) byRoom.set(m[3], []);
  byRoom.get(m[3])!.push(m);
}
const memories: any[] = [];
for (const [roomId, list] of byRoom) {
  const c = rooms.find((x) => x.id === roomId).center;
  list.forEach((m, i) => {
    const a = (i / list.length) * Math.PI * 2 + Math.PI / 4;
    memories.push({
      id: m[0], title: m[1], type: m[2], room: roomId,
      pos: [r(c[0] + Math.cos(a) * 3.5), 1.1, r(c[2] + Math.sin(a) * 3.5)],
      freshness: m[4], excerpt: m[5], path: `${m[0]}.md`,
    });
  });
}
memories.sort((a, b) => a.id.localeCompare(b.id));

const links = [
  ["companies/gripworks", "legal/gripworks-msa", "contract"],
  ["legal/gripworks-msa", "legal/approvals", "approved_in"],
  ["legal/gripworks-msa", "finance/budget-2026-q4", "funded_by"],
  ["legal/approvals", "people/signatories", "requires"],
  ["finance/board-2026-q3", "people/ada-chen", "attended"],
  ["finance/budget-2026-q4", "people/raj-patel", "owned_by"],
  ["eng/soc2-renewal", "eng/security-policy", "governed_by"],
  ["eng/soc2-renewal", "eng/soc2-owner", "owned_by"],
  ["eng/soc2-owner", "people/org-chart", "listed_in"],
  ["people/org-chart", "people/raj-patel", "lists"],
].map(([from, to, kind]) => ({ from, to, kind }));

const palace = {
  version: 1,
  generatedAt: "2026-09-27T13:30:00Z",
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
    { id: "contract-signoff", label: "Contract sign-off", stations: ["companies/gripworks", "legal/gripworks-msa", "finance/budget-2026-q4", "legal/approvals", "people/signatories"] },
    { id: "board-promises", label: "Board promises", stations: ["finance/board-2026-q3", "people/ada-chen", "people/org-chart"] },
    { id: "soc2-owner", label: "SOC 2 ownership", stations: ["eng/soc2-renewal", "eng/security-policy", "people/org-chart", "eng/soc2-owner"] },
  ],
};
writeFileSync("fixtures/palace.json", JSON.stringify(palace, null, 2) + "\n");

// Canned single-agent trace for the retrieval walk
const trace = {
  question: "Can we sign the Gripworks contract this week?",
  hops: [
    { step: 1, memoryId: "companies/gripworks", reason: "keyword match: Gripworks", score: 0.93 },
    { step: 2, memoryId: "legal/gripworks-msa", reason: "graph link: contract", score: 0.88 },
    { step: 3, memoryId: "finance/budget-2026-q4", reason: "graph link: funded_by", score: 0.76 },
    { step: 4, memoryId: "legal/approvals", reason: "graph link: approved_in", score: 0.71 },
    { step: 5, memoryId: "people/signatories", reason: "graph link: requires", score: 0.66 },
  ],
  answerMemoryIds: ["legal/approvals", "finance/budget-2026-q4", "people/signatories"],
  answer: "Yes, if Mara Okafor or Dev Lindqvist signs. Legal approved MSA v3 on Sep 22 and the $40k fits the $55k Q4 supplier line.",
};
writeFileSync("fixtures/traces/demo-1.json", JSON.stringify(trace, null, 2) + "\n");

// Canned multiplayer replay: one handoff, one claim wait, one gap, one stale, three answers
const ev: any[] = [
  { t: 0, agent: "legal", type: "task", text: "Can we sign the Gripworks contract this week?" },
  { t: 0, agent: "finance", type: "task", text: "What did we promise Ada in the last board meeting?" },
  { t: 0, agent: "eng", type: "task", text: "Who owns the SOC 2 renewal?" },
  { t: 0.3, agent: "legal", type: "route", routeId: "contract-signoff", stations: palace.routes[0].stations, source: "fallback" },
  { t: 0.3, agent: "finance", type: "route", routeId: "board-promises", stations: palace.routes[1].stations, source: "fallback" },
  { t: 0.3, agent: "eng", type: "route", routeId: "soc2-owner", stations: palace.routes[2].stations, source: "fallback" },
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
];
writeFileSync("fixtures/replays/demo-1.jsonl", ev.map((e) => JSON.stringify(e)).join("\n") + "\n");
console.log(`palace: ${rooms.length} rooms, ${memories.length} memories; replay: ${ev.length} events`);
