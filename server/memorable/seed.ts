// Seed Memorable with the good recorded runs, so recall has workflows to find.
//
//   bun server/memorable/seed.ts                 # the default good runs below
//   bun server/memorable/seed.ts --dry           # print the traces, send nothing
//   bun server/memorable/seed.ts fixtures/replays/quest-onboarding-qm.jsonl ...
//
// Each run becomes one Memorable procedure (task text, department sequence, ordered stations with titles
// and verdicts), stored in the machine's Memorable store (~/.memorable) and on the service's dashboard.
// It does not touch fixtures/learned-routes.json (seed owns it). Re-running is safe: identical steps
// refresh the stored revision in place.
import { readFileSync } from "node:fs";
import { PalaceEvent } from "../schema";
import { loadPalace } from "../routes";
import { ingest } from "./client";
import { runToTrace } from "./trace";

export const GOOD_RUNS = [
  "fixtures/replays/quest-security-questionnaire.jsonl",
  "fixtures/replays/quest-onboarding.jsonl",
  "fixtures/replays/contract-run2.jsonl",
];

export function readRun(path: string): PalaceEvent[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => PalaceEvent.parse(JSON.parse(l)));
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const files = args.filter((a) => !a.startsWith("--"));
  const palace = loadPalace();
  for (const f of files.length ? files : GOOD_RUNS) {
    const trace = runToTrace(readRun(f), palace);
    if (!trace) {
      console.log(`skip ${f}: no successful run in it`);
      continue;
    }
    console.log(`\n== ${f}\n   task: ${trace.task_description}\n   ${trace.tool_calls.map((c) => c.input.command).join("\n   ")}`);
    if (dry) continue;
    const r = await ingest(trace);
    console.log(`-> ${r.via} ${r.stored ? "STORED" : r.ok ? "sent (not stored)" : "FAILED"}\n${r.detail.replace(/^/gm, "   ")}`);
  }
}
