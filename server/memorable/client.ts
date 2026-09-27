// Memorable client: ingest successful runs, recall a stored workflow for a new task.
//
// What Memorable exposes (docs: https://www.memorable.sh/doc/api, /doc/cli; see NOTES-memorable.md):
//   - HTTP: POST /v1/extract (trace -> procedure draft), POST /v1/embed (query vector). There is NO HTTP
//     recall/search endpoint: the service parses, the store lives on the caller's side.
//   - CLI (`npm i -g memorable-cli`): `ingest -` calls /v1/extract AND stores the procedure in the local
//     store (~/.memorable/procedures.jsonl); `recall "<task>"` matches exact -> lexical -> semantic
//     (embedding via /v1/embed only on a miss); `show <slug>` prints the stored steps.
// So: ingest = CLI when installed (stored + recallable), else direct HTTP /v1/extract (the service keeps
// the workflow for the dashboard, nothing local to recall). Recall = CLI only, 3 s budget.
import type { Palace } from "../schema";
import { parseRecall, stationsFromShow, type MemorableTrace, type RecallHit, type ShowMapping } from "./trace";

export const MEMORABLE_URL = process.env.MEMORABLE_API_URL ?? "https://memorable-extraction-api.memorable.workers.dev";
export const RECALL_TIMEOUT_MS = 3000;
const BIN = process.env.MEMORABLE_BIN ?? "memorable";

export type Exec = (args: string[], opts: { timeoutMs: number; stdin?: string }) => { code: number | null; stdout: string; stderr: string };

export const spawnExec: Exec = (args, { timeoutMs, stdin }) => {
  const { FORCE_COLOR: _drop, ...env } = process.env;
  const p = Bun.spawnSync([BIN, ...args], {
    timeout: Math.max(1, Math.round(timeoutMs)),
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...env, NO_COLOR: "1" },
  });
  return { code: p.exitCode, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
};

export type AsyncExec = (args: string[], opts: { timeoutMs: number; stdin?: string }) => Promise<{ code: number | null; stdout: string; stderr: string }>;

// Non-blocking variant for ingest: the bridge calls recordRoute while it is streaming /events.
export const spawnAsync: AsyncExec = async (args, { timeoutMs, stdin }) => {
  const { FORCE_COLOR: _drop, ...env } = process.env;
  const p = Bun.spawn([BIN, ...args], { stdin: stdin === undefined ? "ignore" : "pipe", stdout: "pipe", stderr: "pipe", env: { ...env, NO_COLOR: "1" } });
  if (stdin !== undefined && p.stdin && typeof p.stdin !== "number") {
    p.stdin.write(stdin);
    await p.stdin.end();
  }
  const timer = setTimeout(() => p.kill(), timeoutMs);
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  clearTimeout(timer);
  return { code, stdout, stderr };
};

export function disabled(): boolean {
  return process.env.MEMORABLE_DISABLE === "1";
}

export function cliAvailable(): boolean {
  return !disabled() && !!Bun.which(BIN);
}

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/mk_[A-Za-z0-9_-]+/g, "mk_***");

// --- recall ------------------------------------------------------------------------------------

export type Recalled = RecallHit & ShowMapping & { ms: number };
export type RecallMiss = { miss: string; ms: number; hit?: RecallHit };

// Semantic hits below this are "nearest neighbour", not "same task" (calibrated in NOTES-memorable.md).
export const MIN_SCORE = Number(process.env.MEMORABLE_MIN_SCORE ?? 0.5);

/**
 * Ask Memorable for a stored workflow matching `task`, mapped back to palace station ids.
 * `memorable recall --single` -> best slug, then `memorable show <slug>` -> its steps. Both calls share
 * one timeout budget (3 s). A miss says why: CLI missing, timeout, no match, weak match, < 2 stations.
 */
export function recallVerbose(task: string, palace: Palace, opts: { exec?: Exec; timeoutMs?: number; minScore?: number } = {}): Recalled | RecallMiss {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const exec = opts.exec ?? spawnExec;
  if (!opts.exec && !cliAvailable()) return { miss: disabled() ? "MEMORABLE_DISABLE=1" : "memorable CLI not installed", ms: 0 };
  const budget = opts.timeoutMs ?? RECALL_TIMEOUT_MS;
  const left = () => Math.max(1, budget - (performance.now() - t0));
  try {
    const r = exec(["recall", task, "--single"], { timeoutMs: left() });
    if (performance.now() - t0 >= budget) return { miss: `timeout (${budget} ms)`, ms: ms() };
    if (r.code !== 0) return { miss: `recall exited ${r.code}: ${strip(r.stderr).trim().split("\n").pop()}`, ms: ms() };
    const hit = parseRecall(r.stdout)[0];
    if (!hit) return { miss: "no matching procedures", ms: ms() };
    if (hit.score < (opts.minScore ?? MIN_SCORE)) return { miss: `weak match ${hit.score} < ${opts.minScore ?? MIN_SCORE}`, ms: ms(), hit };
    const s = exec(["show", hit.slug], { timeoutMs: left() });
    if (performance.now() - t0 >= budget) return { miss: `timeout (${budget} ms)`, ms: ms(), hit };
    if (s.code !== 0) return { miss: `show exited ${s.code}`, ms: ms(), hit };
    const mapped = stationsFromShow(strip(s.stdout), palace);
    if (mapped.stations.length < 2) return { miss: `procedure names ${mapped.stations.length} palace station(s)`, ms: ms(), hit };
    return { ...hit, ...mapped, ms: ms() };
  } catch (e) {
    return { miss: `error: ${(e as Error).message}`, ms: ms() };
  }
}

export function recall(task: string, palace: Palace, opts: Parameters<typeof recallVerbose>[2] = {}): Recalled | null {
  const r = recallVerbose(task, palace, opts);
  return "miss" in r ? null : r;
}

// --- ingest ------------------------------------------------------------------------------------

export type Ingested = { via: "cli" | "http" | "none"; ok: boolean; stored: boolean; detail: string; response?: unknown };

/** Store a successful run as a Memorable procedure. CLI first (stored locally for recall), else HTTP. */
export async function ingest(trace: MemorableTrace, opts: { exec?: AsyncExec; fetchImpl?: typeof fetch } = {}): Promise<Ingested> {
  if (disabled()) return { via: "none", ok: false, stored: false, detail: "MEMORABLE_DISABLE=1" };
  if (opts.exec || cliAvailable()) {
    const r = await (opts.exec ?? spawnAsync)(["ingest", "-"], { timeoutMs: 20000, stdin: JSON.stringify(trace) });
    const out = strip(r.stdout + r.stderr).split("\n").filter((l) => l.trim() && !/NO_COLOR|trace-warnings/.test(l)).join("\n").trim();
    // A refusal ("not stored: the service did not admit this workflow (single_verb, prefilter)") exits 1.
    const stored = r.code === 0 && /procedures\//.test(out) && !/not stored/i.test(out);
    return { via: "cli", ok: r.code === 0, stored, detail: out };
  }
  return extractHttp(trace, opts.fetchImpl);
}

/** POST /v1/extract directly. The service keeps the workflow (dashboard); nothing is stored locally. */
export async function extractHttp(trace: MemorableTrace, fetchImpl: typeof fetch = fetch): Promise<Ingested> {
  const key = process.env.MEMORABLE_API_KEY;
  if (!key) return { via: "none", ok: false, stored: false, detail: "no MEMORABLE_API_KEY" };
  try {
    const res = await fetchImpl(`${MEMORABLE_URL}/v1/extract`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(trace),
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json().catch(() => ({}))) as { draft?: { title?: string; steps?: unknown[] }; judge?: { admitted?: boolean; reason?: string }; refused?: string; error?: string; request_id?: string };
    const admitted = body.judge?.admitted !== false && !body.refused;
    const detail = res.ok
      ? `extract ${res.status}: "${body.draft?.title ?? "?"}" ${body.draft?.steps?.length ?? 0} steps, judge ${admitted ? "admitted" : `refused (${body.judge?.reason ?? body.refused})`}, request ${body.request_id}`
      : `extract ${res.status}: ${body.error ?? "error"} (request ${body.request_id})`;
    return { via: "http", ok: res.ok, stored: false, detail, response: body };
  } catch (e) {
    return { via: "http", ok: false, stored: false, detail: `extract failed: ${(e as Error).message}` };
  }
}
