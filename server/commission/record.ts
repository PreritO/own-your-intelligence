// Record live commissioned quests as replay fixtures (fixtures/replays/quest-<id>.jsonl).
//
//   PROTOCOL_URL=http://localhost:8890 bun server/commission/record.ts security-questionnaire [more ids...]
//   bun server/commission/record.ts --all                   # every quest in fixtures/quests.json
//   bun server/commission/record.ts --from <run> <questId>  # re-cut a finished protocol run log
//
// Runs each quest live through the protocol service (Claude planner, team replies and writer; Gym via the
// server.train.quest CLI), then cuts the fixture from the service's own run log
// (server/protocol/runs/<run>.jsonl, the clean source; see commission-lessons), rebased to t=0 and with
// run = "quest-<id>". Every line is checked against the frozen PalaceEvent schema and the quest must show
// the full lifecycle, or the fixture is not written.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PalaceEvent } from "../schema";
import { findQuest, loadQuests, startQuest, type QuestDef } from "./quest";

const ROOT = join(dirname(import.meta.path), "..", "..");
const RUNS = process.env.MP_RUNS_DIR ?? join(ROOT, "server", "protocol", "runs");
const OUT = join(ROOT, "fixtures", "replays");

type Ev = PalaceEvent & Record<string, any>;

export function check(events: Ev[], agent: string): string[] {
  const mine = events.filter((e) => e.agent === agent);
  const has = (f: (e: Ev) => boolean) => events.some(f);
  const miss: string[] = [];
  if (!has((e) => e.type === "spawn" && e.agent === agent)) miss.push("spawn");
  if (!mine.some((e) => e.type === "phase" && e.phase === "plan" && (e.subtasks?.length ?? 0) > 0)) miss.push("plan with subtasks");
  if (!mine.some((e) => e.type === "phase" && e.phase === "explore")) miss.push("explore");
  if (!mine.some((e) => e.type === "handoff")) miss.push("handoff");
  if (!has((e) => e.type === "reply")) miss.push("reply");
  if (!mine.some((e) => e.type === "phase" && e.phase === "gym")) miss.push("gym");
  if (!mine.some((e) => e.type === "train_step")) miss.push("train_step");
  if (!mine.some((e) => e.type === "phase" && e.phase === "execute")) miss.push("execute");
  if (!mine.some((e) => e.type === "route" && e.source === "learned")) miss.push("learned route");
  if (!mine.some((e) => e.type === "artifact")) miss.push("artifact");
  const ans = [...mine].reverse().find((e) => e.type === "answer");
  if (!ans || ans.blocked) miss.push("unblocked answer");
  if (!mine.some((e) => e.type === "phase" && e.phase === "done")) miss.push("done");
  return miss;
}

export function cut(run: string, questId: string): { events: Ev[]; file: string } {
  const src = join(RUNS, `${run}.jsonl`);
  if (!existsSync(src)) throw new Error(`no protocol run log ${src}`);
  const raw = readFileSync(src, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const t0 = raw.length ? raw[0].t : 0;
  let last = 0;
  const events = raw.map((o) => {
    const t = Math.max(last, Math.round((o.t - t0) * 100) / 100);
    last = t;
    return PalaceEvent.parse({ ...o, t, run: `quest-${questId}` }) as Ev;
  });
  return { events, file: join(OUT, `quest-${questId}.jsonl`) };
}

function summary(events: Ev[], agent: string, q: QuestDef) {
  const ans = [...events].reverse().find((e) => e.agent === agent && e.type === "answer") as Ev | undefined;
  const gaps = [...new Set(events.filter((e) => e.type === "visit" && e.verdict === "gap").map((e) => e.memoryId))];
  const stale = [...new Set(events.filter((e) => e.type === "visit" && e.verdict === "stale").map((e) => e.memoryId))];
  const teams = [...new Set(events.filter((e) => e.type === "handoff").map((e) => e.toAgent))];
  const expected = q.expectedGaps ?? [];
  return {
    quest: q.id,
    seconds: events.at(-1)?.t,
    events: events.length,
    handoffsTo: teams,
    gaps,
    stale,
    expectedGaps: expected,
    expectedGapsStated: expected.filter((g) => ans?.text.includes(g) || ans?.gaps?.includes(g)),
    answer: ans?.text,
  };
}

async function recordOne(q: QuestDef, fromRun?: string) {
  let agent: string;
  let run: string;
  if (fromRun) {
    run = fromRun;
    agent = /^(quest-\d+)/.exec(fromRun)?.[1] ?? "";
  } else {
    const t0 = Date.now();
    const { info, done } = await startQuest(q.prompt, {}, q);
    console.log(`▶ ${q.id}: ${info.agent} ${info.run}`);
    await done;
    agent = info.agent;
    run = info.run;
    console.log(`■ ${q.id} finished in ${Math.round((Date.now() - t0) / 1000)} s`);
  }
  const { events, file } = cut(run, q.id);
  const miss = check(events, agent);
  const s = summary(events, agent, q);
  console.log(JSON.stringify(s, null, 2));
  if (miss.length) {
    console.error(`✗ ${q.id}: not written, missing ${miss.join(", ")} (run log server/protocol/runs/${run}.jsonl)`);
    return false;
  }
  writeFileSync(file, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  console.log(`✓ wrote ${file.replace(ROOT + "/", "")} (${events.length} events, ${s.seconds} s)`);
  return true;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const fi = args.indexOf("--from");
  if (fi >= 0) {
    const q = findQuest(args[fi + 2] ?? "");
    if (!q) throw new Error("usage: --from <run> <questId>");
    process.exit((await recordOne(q, args[fi + 1])) ? 0 : 1);
  }
  const ids = args.includes("--all") ? loadQuests().map((q) => q.id) : args;
  if (!ids.length) throw new Error(`usage: record.ts <questId...> | --all; known: ${loadQuests().map((q) => q.id).join(", ")}`);
  let ok = 0;
  for (const id of ids) {
    const q = findQuest(id);
    if (!q) {
      console.error(`unknown quest ${id}`);
      continue;
    }
    if (await recordOne(q).catch((e) => (console.error(`✗ ${id}: ${(e as Error).message}`), false))) ok++;
  }
  console.log(`${ok}/${ids.length} recorded`);
}
