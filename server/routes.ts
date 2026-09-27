// Learned routes (loci protocol step 1): Memorable lookup -> explore -> hand-authored fallback.
//
//   bun server/routes.ts pick "Can we sign the Gripworks contract this week?"
//   bun server/routes.ts record "<task>" <station> <station> ...
//   bun server/routes.ts list
//
// Also imported by server/bridge.ts (GET /route?task=..., POST /route/record).
//
// Lookup order:
//   1. learned  - a) Memorable recall (server/memorable/client.ts: `memorable recall` + `show`, 3 s
//                    budget) mapped back to palace station ids. routeId `memorable-<original id>`.
//                 b) the local cache fixtures/learned-routes.json ([{routeId, task, stations, uses}]),
//                    used when Memorable is missing, slow, or has no confident match. routeId `local-<id>`.
//   2. fallback - a hand-authored route in palace.json.routes that matches the task.
//   3. explore  - no route matches: rank the palace's memories against the task and walk the top few.
// After a successful run, recordRoute() writes the station path to learned-routes.json (canonical id,
// no prefix) and ingests the run into Memorable as a procedure (CLI `ingest -`, else HTTP /v1/extract).
// MEMORABLE_DISABLE=1 turns Memorable off (local cache only).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Palace, type PalaceEvent, type Route } from "./schema";
import { ingest, recallVerbose } from "./memorable/client";
import { pathToTrace, runToTrace } from "./memorable/trace";

export type RouteSource = "learned" | "explore" | "fallback";
// `via` and `note` say where a learned route came from; the /events route event only carries routeId,
// so the routeId prefix (memorable- / local-) is the honest label there.
export type PickedRoute = { routeId: string; stations: string[]; source: RouteSource; score: number; label?: string; via?: "memorable" | "local"; note?: string };
export type LearnedRoute = { routeId: string; task: string; stations: string[]; uses: number };

const PALACE_PATH = process.env.PALACE_PATH ?? "fixtures/palace.json";
const LEARNED_PATH = process.env.LEARNED_ROUTES_PATH ?? "fixtures/learned-routes.json";
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

const SOURCE_PREFIX = /^(memorable|local)-/;
/** `memorable-contract-signoff` / `local-contract-signoff` -> `contract-signoff`. */
export const canonicalRouteId = (id: string) => id.replace(SOURCE_PREFIX, "");

// Why the last Memorable lookup missed (shown in the local route's note and the demo script).
export let lastMemorableMiss = "";

// 1a. Memorable: the real store. Recall matches exact -> lexical -> semantic, so a reworded task lands.
export function memorableLookup(task: string, palace: Palace): PickedRoute | null {
  const r = recallVerbose(task, palace);
  lastMemorableMiss = "miss" in r ? r.miss : "";
  if ("miss" in r) return null;
  const id = canonicalRouteId(r.routeId ?? r.slug.replace(/^procedures\/[0-9a-f]+-/, ""));
  return {
    routeId: `memorable-${id}`,
    stations: r.stations,
    source: "learned",
    score: r.score,
    label: r.title,
    via: "memorable",
    note: `Memorable ${r.slug} [${r.tier} ${r.score}] in ${r.ms} ms`,
  };
}

// 1b. Local cache: token overlap against recorded task texts.
export function localLookup(task: string, palace: Palace): PickedRoute | null {
  const memIds = new Set(palace.memories.map((m) => m.id));
  const t = tokens(task);
  let best: PickedRoute | null = null;
  for (const lr of loadLearned()) {
    if (!lr.stations.length || !lr.stations.every((s) => memIds.has(s))) continue;
    const score = jaccard(t, tokens(lr.task)) + Math.min(lr.uses, 10) * 0.001; // reuse breaks ties
    if (score >= LEARNED_MIN && (!best || score > best.score))
      best = { routeId: `local-${canonicalRouteId(lr.routeId)}`, stations: lr.stations, source: "learned", score, via: "local", note: `local cache ${LEARNED_PATH} (jaccard ${score.toFixed(2)})` };
  }
  return best;
}

function learnedLookup(task: string, palace: Palace): PickedRoute | null {
  const hit = memorableLookup(task, palace);
  if (hit) return hit;
  const local = localLookup(task, palace);
  if (local && lastMemorableMiss) local.note += `; Memorable: ${lastMemorableMiss}`;
  return local;
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

// Record a successful path. Same routeId (or same station list) bumps `uses`. The local cache always
// gets it; Memorable gets it as a procedure (best effort, never throws). Pass the run's events to send
// real per-station verdicts and handoffs; without them the stations go as visits with unknown outcome.
export async function recordRoute(task: string, stations: string[], routeId?: string, opts: { events?: PalaceEvent[]; palace?: Palace } = {}): Promise<LearnedRoute> {
  const all = loadLearned();
  const key = stations.join(">");
  const id = routeId && canonicalRouteId(routeId);
  let entry = all.find((r) => (id && r.routeId === id) || r.stations.join(">") === key);
  if (entry) {
    entry.uses += 1;
    entry.stations = stations;
  } else {
    entry = { routeId: id ?? `learned-${slug(task)}`, task, stations, uses: 1 };
    all.push(entry);
  }
  writeFileSync(LEARNED_PATH, JSON.stringify(all, null, 2) + "\n");
  try {
    const palace = opts.palace ?? loadPalace();
    const session = `mind-palace-${entry.routeId}-${Date.now()}`;
    const fromRun = opts.events && runToTrace(opts.events, palace, session, { task, stations, routeId: entry.routeId });
    const trace = fromRun || pathToTrace(task, stations, palace, entry.routeId, session);
    const r = await ingest(trace);
    if (process.env.MEMORABLE_VERBOSE === "1" || (!r.ok && r.via !== "none")) console.log(`  memorable ${r.via}: ${r.stored ? "stored" : r.ok ? "sent" : "failed"} ${r.detail.split("\n")[0]}`);
  } catch {}
  return entry;
}

function slug(s: string) {
  return tokens(s).slice(0, 4).join("-") || "task";
}

// --- CLI --------------------------------------------------------------------------------------

if (import.meta.main) {
  const [cmd, task, ...rest] = process.argv.slice(2);
  if (cmd === "pick" && task) {
    const picked = pickRoute(task);
    console.log(JSON.stringify(picked, null, 2));
    if (picked.via !== "memorable" && lastMemorableMiss) console.error(`(Memorable: ${lastMemorableMiss})`);
  }
  else if (cmd === "record" && task && rest.length) console.log(JSON.stringify(await recordRoute(task, rest), null, 2));
  else if (cmd === "list") console.log(JSON.stringify(loadLearned(), null, 2));
  else {
    console.error('usage: bun server/routes.ts pick "<task>" | record "<task>" <station...> | list');
    process.exit(1);
  }
}
