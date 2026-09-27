// OWNED BY: flow. Headless check of the flow model on every replay: `bun web/src/flow/check.ts`.
// Prints each flow's steps and scorecard and asserts the facts the demo relies on.
import { readdirSync } from "node:fs";
import { Palace, PalaceEvent } from "../../../server/schema";
import { buildFlows, runsFor, type Flow, type Segment } from "./model";

const root = new URL("../../../", import.meta.url).pathname;
const palace = Palace.parse(await Bun.file(root + "fixtures/palace.json").json());
const load = async (p: string): Promise<Segment> => ({
  archived: false,
  events: (await Bun.file(p).text()).split("\n").filter(Boolean).map((l) => PalaceEvent.parse(JSON.parse(l))),
});

const files = [
  ...readdirSync(root + "fixtures/replays").filter((f) => f.endsWith(".jsonl")).map((f) => root + "fixtures/replays/" + f),
  ...readdirSync(root + "web/src/flow/samples").filter((f) => f.endsWith(".jsonl")).map((f) => root + "web/src/flow/samples/" + f),
];
const byName: Record<string, Flow[]> = {};
const mark = (b: boolean | null) => (b === null ? "-" : b ? "ok" : "NO");
for (const file of files) {
  const name = file.split("/").pop()!.replace(".jsonl", "");
  const flows = buildFlows([await load(file)], palace);
  byName[name] = flows;
  console.log(`\n=== ${name}`);
  for (const f of flows) {
    console.log(`  [${f.label}] ${f.task}${f.subtasks ? `  (${f.subtasks.length} subtasks)` : ""}${f.phases.length ? `  phases: ${f.phases.map((p) => p.phase).join(">")}` : ""}`);
    for (const a of f.attempts) {
      const s = a.score;
      console.log(`    run ${a.n + 1} ${a.source ?? "-"}: useful ${s.useful}/${s.hops} cited ${s.cited} wasted ${s.wasted} calls ${s.toolCalls} handoffs ${s.handoffs} gaps ${mark(s.gapsStated)} own ${mark(s.ownership)} grounded ${mark(s.grounded)} flags ${s.redFlags} ${s.duration.toFixed(1)}s${a.answerInherited ? " (judged vs final answer)" : ""}`);
      for (const st of [...a.steps, ...a.ghosts])
        console.log(`      ${st.order || "·"} ${st.memoryId.padEnd(32)} ${st.kind.padEnd(7)} ${(st.ghost ?? st.status).padEnd(15)}${st.handoff ? ` -> ${st.handoff.toAgent}` : ""}${st.flags.length ? "  !! " + st.flags.join("; ") : ""}`);
    }
  }
}

// Comparison across two replays (as when ?demo=contract-run2 loads contract-run1 as an archive).
const r1 = (await load(root + "fixtures/replays/contract-run1.jsonl"));
const r2 = (await load(root + "fixtures/replays/contract-run2.jsonl"));
const both = buildFlows([{ ...r1, archived: true }, r2], palace);
const cur = both.find((f) => !f.archived && f.task)!;
const runs = runsFor(cur, both);
console.log(`\ncompare: ${runs.map((r) => `${r.attempt.source} ${r.attempt.score.hops} hops / ${r.attempt.score.toolCalls} calls`).join("  ->  ")}`);

const assert = (c: unknown, msg: string) => { if (!c) { console.error("FAIL", msg); process.exitCode = 1; } else console.log("ok  ", msg); };
console.log();
assert(runs.length === 2 && runs[0].attempt.source === "explore" && runs[1].attempt.source === "learned", "contract run1 vs run2 pair up");
assert(runs[0].attempt.score.hops === 9 && runs[1].attempt.score.hops === 5, "9 hops -> 5 hops");
const demo = byName["demo-1"];
assert(demo.length === 3, "demo-1 has 3 flows");
const eng = demo.find((f) => f.agent === "eng")!.attempts[0];
assert(eng.score.gapsStated === true && eng.steps.find((s) => s.memoryId === "eng/soc2-owner")?.status === "gap", "eng gap stated");
const legal = demo.find((f) => f.agent === "legal")!.attempts[0];
assert(legal.steps.some((s) => s.kind === "handoff" && s.handoff?.reply && s.cited), "legal handoff to finance cited");
assert(legal.score.grounded === true && legal.score.ownership === true, "legal grounded + ownership");
const fin = demo.find((f) => f.agent === "finance")!.attempts[0];
assert(!fin.steps.some((s) => s.memoryId === "finance/budget-2026-q4"), "finance's helper visit not in its own flow");
const quest = byName["quest-sample"][0];
assert(quest.attempts.length === 2 && runsFor(quest, byName["quest-sample"]).length === 2, "quest explore + execute attempts");
assert(quest.attempts[0].answerInherited && quest.attempts[0].score.wasted > 0, "quest explore judged vs final answer");
const bad = byName["flow-bad"][0].attempts[0];
assert(bad.score.grounded === false && bad.score.ownership === false && bad.score.gapsStated === false, "bad run flags all three");
