// bun run validate [palace.json] — schema + referential checks on every fixture.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { Palace, Trace, PalaceEvent } from "./schema";

const errors: string[] = [];
const palacePath = process.argv[2] ?? "fixtures/palace.json";
const palace = Palace.parse(JSON.parse(readFileSync(palacePath, "utf8")));

const roomIds = new Set(palace.rooms.map((r) => r.id));
const memIds = new Set(palace.memories.map((m) => m.id));
const agentIds = new Set(palace.agents.map((a) => a.id));
for (const w of palace.wings) for (const r of w.rooms) if (!roomIds.has(r)) errors.push(`wing ${w.id}: unknown room ${r}`);
for (const r of palace.rooms) for (const d of r.doors) if (!roomIds.has(d.to)) errors.push(`room ${r.id}: door to unknown ${d.to}`);
for (const m of palace.memories) if (!roomIds.has(m.room)) errors.push(`memory ${m.id}: unknown room ${m.room}`);
for (const l of palace.links) for (const id of [l.from, l.to]) if (!memIds.has(id)) errors.push(`link: unknown memory ${id}`);
for (const rt of palace.routes) for (const s of rt.stations) if (!memIds.has(s)) errors.push(`route ${rt.id}: unknown station ${s}`);
for (const a of palace.agents) if (!roomIds.has(a.home)) errors.push(`agent ${a.id}: unknown home ${a.home}`);
const perRoom = new Map<string, number>();
for (const m of palace.memories) perRoom.set(m.room, (perRoom.get(m.room) ?? 0) + 1);
for (const [r, n] of perRoom) if (n > 12) errors.push(`room ${r}: ${n} memories (max 12)`);
if (palace.memories.map((m) => m.id).join() !== palace.memories.map((m) => m.id).sort().join()) errors.push("memories not sorted by id");

let traces = 0, events = 0;
const dir = (d: string) => (existsSync(d) ? readdirSync(d) : []);
for (const f of dir("fixtures/traces").filter((f) => f.endsWith(".json"))) {
  const t = Trace.parse(JSON.parse(readFileSync(`fixtures/traces/${f}`, "utf8")));
  for (const h of t.hops) if (!memIds.has(h.memoryId)) errors.push(`${f}: unknown hop ${h.memoryId}`);
  traces++;
}
for (const f of dir("fixtures/replays").filter((f) => f.endsWith(".jsonl"))) {
  let lastT = 0;
  readFileSync(`fixtures/replays/${f}`, "utf8").split("\n").filter(Boolean).forEach((line, i) => {
    const e = PalaceEvent.safeParse(JSON.parse(line));
    if (!e.success) return errors.push(`${f}:${i + 1}: ${e.error.issues[0]?.message}`);
    const ev = e.data;
    if (ev.t < lastT) errors.push(`${f}:${i + 1}: t goes backwards`);
    lastT = ev.t;
    if (ev.type === "spawn") { agentIds.add(ev.agent); if (!roomIds.has(ev.home)) errors.push(`${f}:${i + 1}: unknown home ${ev.home}`); }
    if (ev.type === "artifact") memIds.add(ev.memory.id);
    if (!agentIds.has(ev.agent)) errors.push(`${f}:${i + 1}: unknown agent ${ev.agent}`);
    if ("memoryId" in ev && !memIds.has(ev.memoryId)) errors.push(`${f}:${i + 1}: unknown memory ${ev.memoryId}`);
    if (ev.type === "move" && !roomIds.has(ev.to)) errors.push(`${f}:${i + 1}: unknown room ${ev.to}`);
    events++;
  });
}

if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join("\n"));
  process.exit(1);
}
console.log(`✓ ${palacePath}: ${palace.rooms.length} rooms, ${palace.memories.length} memories, ${palace.routes.length} routes; ${traces} traces; ${events} replay events`);
