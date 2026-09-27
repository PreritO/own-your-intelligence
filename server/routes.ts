// Learned routes (loci protocol step 1): Memorable lookup -> explore -> hand-authored fallback.
//
//   bun server/routes.ts pick "Can we sign the Gripworks contract this week?"
//   bun server/routes.ts record "<task>" <station> <station> ...
//   bun server/routes.ts list
//
// Also imported by server/bridge.ts (GET /route?task=..., POST /route/record).
//
// Lookup order:
//   1. learned  - Memorable recall (CLI `memorable`, if installed + logged in), then the local store
//                 fixtures/learned-routes.json ([{routeId, task, stations, uses}]).
//   2. fallback - a hand-authored route in palace.json.routes that matches the task.
//   3. explore  - no route matches: rank the palace's memories against the task and walk the top few.
// After a successful run, recordRoute() writes the station path to learned-routes.json and, when
// MEMORABLE_API_KEY is set, sends the trace to Memorable's POST /v1/extract.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Palace, type Route } from "./schema";

export type RouteSource = "learned" | "explore" | "fallback";
export type PickedRoute = { routeId: string; stations: string[]; source: RouteSource; score: number; label?: string };
export type LearnedRoute = { routeId: string; task: string; stations: string[]; uses: number };

const PALACE_PATH = process.env.PALACE_PATH ?? "fixtures/palace.json";
const LEARNED_PATH = process.env.LEARNED_ROUTES_PATH ?? "fixtures/learned-routes.json";
const MEMORABLE_URL = process.env.MEMORABLE_API_URL ?? "https://memorable-extraction-api.memorable.workers.dev";
const LEARNED_MIN = 0.5; // token overlap needed to reuse a learned route
const FALLBACK_MIN = 1; // matched tokens needed to use a hand-authored route
const EXPLORE_STATIONS = 4;

const STOP = new Set(
  "a an and are as at be by can could did do does for from has have how i in is it its last me my of on or our should the this to was we what when where which who whom why will with would you your week meeting".split(" "),
);

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/soc\s*2/g, "soc2")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w));
}

const overlap = (a: string[], b: Set<string>) => a.filter((w) => b.has(w)).length;
const jaccard = (a: string[], b: string[]) => {
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter((w) => B.has(w)).length;
  return inter / Math.max(1, new Set([...A, ...B]).size);
};

export function loadPalace(path = PALACE_PATH): Palace {
  return Palace.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function loadLearned(path = LEARNED_PATH): LearnedRoute[] {
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// --- 1. learned --------------------------------------------------------------------------------

// Memorable recall is CLI-only in its public docs (`memorable recall "<query>"`). We scan its output
// for palace memory ids in order; if it names >= 2 known stations, that's the learned route.
function memorableRecall(task: string, memIds: Set<string>): string[] | null {
  if (process.env.MEMORABLE_DISABLE === "1" || !Bun.which("memorable")) return null;
  try {
    const p = Bun.spawnSync(["memorable", "recall", task], { timeout: 3000, stdout: "pipe", stderr: "ignore" });
    if (p.exitCode !== 0) return null;
    const out = p.stdout.toString();
    const found: { id: string; at: number }[] = [];
    for (const id of memIds) {
      const at = out.indexOf(id);
      if (at >= 0) found.push({ id, at });
    }
    found.sort((a, b) => a.at - b.at);
    return found.length >= 2 ? found.map((f) => f.id) : null;
  } catch {
    return null;
  }
}

function learnedLookup(task: string, palace: Palace): PickedRoute | null {
  const memIds = new Set(palace.memories.map((m) => m.id));
  const recalled = memorableRecall(task, memIds);
  if (recalled) return { routeId: `memorable-${slug(task)}`, stations: recalled, source: "learned", score: 1 };

  const t = tokens(task);
  let best: PickedRoute | null = null;
  for (const lr of loadLearned()) {
    if (!lr.stations.length || !lr.stations.every((s) => memIds.has(s))) continue;
    const score = jaccard(t, tokens(lr.task)) + Math.min(lr.uses, 10) * 0.001; // reuse breaks ties
    if (score >= LEARNED_MIN && (!best || score > best.score))
      best = { routeId: lr.routeId, stations: lr.stations, source: "learned", score };
  }
  return best;
}

// --- 2. fallback ------------------------------------------------------------------------------

function routeVocab(r: Route, palace: Palace): Set<string> {
  const byId = new Map(palace.memories.map((m) => [m.id, m]));
  const words = [r.id, r.label];
  for (const s of r.stations) {
    const m = byId.get(s);
    words.push(s, m?.title ?? "");
  }
  return new Set(tokens(words.join(" ")));
}

function fallbackLookup(task: string, palace: Palace): PickedRoute | null {
  const t = tokens(task);
  let best: PickedRoute | null = null;
  for (const r of palace.routes) {
    // id/label words count double: they name the task type, stations just describe it.
    const head = new Set(tokens(`${r.id} ${r.label}`));
    const headHits = overlap(t, head);
    const score = overlap(t, routeVocab(r, palace)) + headHits;
    if (headHits >= FALLBACK_MIN && (!best || score > best.score))
      best = { routeId: r.id, label: r.label, stations: r.stations, source: "fallback", score };
  }
  return best;
}

// --- 3. explore -------------------------------------------------------------------------------

function explore(task: string, palace: Palace): PickedRoute {
  const t = tokens(task);
  const ranked = palace.memories
    .map((m) => ({ id: m.id, score: overlap(t, new Set(tokens(`${m.id} ${m.title} ${m.excerpt}`))) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, EXPLORE_STATIONS);
  const stations = ranked.length ? ranked.map((x) => x.id) : palace.memories.slice(0, 1).map((m) => m.id);
  return { routeId: `explore-${slug(task)}`, stations, source: "explore", score: ranked[0]?.score ?? 0 };
}

// --- public API -------------------------------------------------------------------------------

export function pickRoute(task: string, palace: Palace = loadPalace()): PickedRoute {
  return learnedLookup(task, palace) ?? fallbackLookup(task, palace) ?? explore(task, palace);
}

// Record a successful path. Same routeId (or same station list) bumps `uses`.
export async function recordRoute(task: string, stations: string[], routeId?: string): Promise<LearnedRoute> {
  const all = loadLearned();
  const key = stations.join(">");
  let entry = all.find((r) => (routeId && r.routeId === routeId) || r.stations.join(">") === key);
  if (entry) {
    entry.uses += 1;
    entry.stations = stations;
  } else {
    entry = { routeId: routeId ?? `learned-${slug(task)}`, task, stations, uses: 1 };
    all.push(entry);
  }
  writeFileSync(LEARNED_PATH, JSON.stringify(all, null, 2) + "\n");
  await memorableExtract(task, stations).catch(() => {});
  return entry;
}

// Best effort: send the run to Memorable so its recall learns it too. Needs MEMORABLE_API_KEY in .env.
async function memorableExtract(task: string, stations: string[]): Promise<void> {
  const key = process.env.MEMORABLE_API_KEY;
  if (!key) return;
  await fetch(`${MEMORABLE_URL}/v1/extract`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      session_id: `mind-palace-${Date.now()}`,
      task_description: task,
      harness: "mind-palace-loci",
      tool_calls: stations.map((memoryId) => ({ name: "visit", input: { memoryId }, result: { ok: true, verdict: "verified" } })),
    }),
    signal: AbortSignal.timeout(4000),
  });
}

function slug(s: string) {
  return tokens(s).slice(0, 4).join("-") || "task";
}

// --- CLI --------------------------------------------------------------------------------------

if (import.meta.main) {
  const [cmd, task, ...rest] = process.argv.slice(2);
  if (cmd === "pick" && task) console.log(JSON.stringify(pickRoute(task), null, 2));
  else if (cmd === "record" && task && rest.length) console.log(JSON.stringify(await recordRoute(task, rest), null, 2));
  else if (cmd === "list") console.log(JSON.stringify(loadLearned(), null, 2));
  else {
    console.error('usage: bun server/routes.ts pick "<task>" | record "<task>" <station...> | list');
    process.exit(1);
  }
}
