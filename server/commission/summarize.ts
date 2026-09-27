// bun server/commission/summarize.ts <replay.jsonl>  - one-screen summary of a quest replay.
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) throw new Error("usage: bun server/commission/summarize.ts <replay.jsonl>");
const ev = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const count: Record<string, number> = {};
for (const e of ev) count[e.type] = (count[e.type] ?? 0) + 1;
console.log(`${ev.length} events over ${ev.at(-1)?.t}s`, JSON.stringify(count));
let phase = "";
const hops: Record<string, number> = {};
for (const e of ev) {
  if (e.type === "phase") phase = e.phase;
  if (e.agent.startsWith("quest-") && ["visit", "handoff", "claim"].includes(e.type)) hops[phase] = (hops[phase] ?? 0) + 1;
  if (["spawn", "phase", "route", "artifact", "answer"].includes(e.type)) {
    const { t, type, run: _r, ...rest } = e;
    if (rest.memory) rest.memory = { ...rest.memory, excerpt: rest.memory.excerpt.slice(0, 60) + "…" };
    console.log(String(t).padStart(6), type.padEnd(8), JSON.stringify(rest).slice(0, 420));
  }
}
console.log("quest claim/visit/handoff per phase:", JSON.stringify(hops));
