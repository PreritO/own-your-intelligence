// Claude calls with JSON output (structured outputs) and a disk cache, so an import can be
// replayed offline and byte-for-byte. Raw fetch like server/commission/claude.ts: the repo has no
// Anthropic SDK dependency and package.json is integrator-owned (see docs/NOTES-import.md).
// The API key is read from the environment (or the main checkout's .env) and never logged.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const DEFAULT_MODEL = process.env.IMPORT_MODEL ?? "claude-sonnet-5";

export interface LlmOptions {
  model: string;
  cacheDir: string;
  /** true: never call the API; a cache miss is an error (tests, reproducible rebuilds). */
  offline: boolean;
  log?: (msg: string) => void;
}

export interface LlmStats { calls: number; cached: number; inputTokens: number; outputTokens: number }
export const stats: LlmStats = { calls: 0, cached: 0, inputTokens: 0, outputTokens: 0 };

export class CacheMiss extends Error {}
class Fatal extends Error {}

/** Stable JSON (sorted keys) so the cache key doesn't depend on property order. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableStringify((v as any)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export const sha = (s: string) => createHash("sha256").update(s).digest("hex");

let keyCache: string | null | undefined;
/** ANTHROPIC_API_KEY from env; in a git worktree, fall back to the main checkout's .env. */
export function apiKey(): string | null {
  if (keyCache !== undefined) return keyCache;
  keyCache = process.env.ANTHROPIC_API_KEY || null;
  if (!keyCache) {
    try {
      const r = Bun.spawnSync(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"]);
      const common = r.stdout.toString().trim();
      const envFile = common ? join(dirname(common), ".env") : "";
      if (envFile && existsSync(envFile)) {
        const m = /^ANTHROPIC_API_KEY=(.*)$/m.exec(readFileSync(envFile, "utf8"));
        keyCache = m ? m[1].trim().replace(/^["']|["']$/g, "") || null : null;
      }
    } catch { /* no git */ }
  }
  return keyCache;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One Messages API call constrained to `schema` (output_config.format json_schema).
 * `name` only labels the cache file; the key hashes model + system + user + schema.
 */
export async function llmJson<T>(opts: LlmOptions, name: string, system: string, user: string, schema: object, maxTokens = 16000): Promise<T> {
  const req = { model: opts.model, system, user, schema, maxTokens };
  const key = sha(stableStringify(req)).slice(0, 20);
  const file = resolve(opts.cacheDir, `${name.replace(/[^a-z0-9-]+/gi, "-").slice(0, 60)}.${key}.json`);
  if (existsSync(file)) {
    stats.cached++;
    return JSON.parse(readFileSync(file, "utf8")).output as T;
  }
  if (opts.offline) throw new CacheMiss(`no cached LLM response for ${name} (${key}); rerun without --offline to record it`);
  const k = apiKey();
  if (!k) throw new Error("ANTHROPIC_API_KEY not set (env or .env); use --offline with a recorded cache");

  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(2000 * 2 ** attempt);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": k, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: user }],
          output_config: { effort: "medium", format: { type: "json_schema", schema } },
        }),
        signal: AbortSignal.timeout(240_000),
      });
      const body = (await res.json()) as {
        stop_reason?: string; error?: { message?: string };
        content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number };
      };
      if (!res.ok) {
        lastErr = `anthropic ${res.status}: ${body.error?.message ?? "error"}`;
        if (res.status === 429 || res.status >= 500) continue;
        throw new Fatal(lastErr);
      }
      if (body.stop_reason === "refusal") throw new Fatal(`${name}: model declined (refusal)`);
      if (body.stop_reason === "max_tokens") { lastErr = `${name}: output hit max_tokens`; maxTokens = Math.min(maxTokens * 2, 64000); continue; }
      const text = (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
      const output = JSON.parse(text) as T;
      stats.calls++;
      stats.inputTokens += body.usage?.input_tokens ?? 0;
      stats.outputTokens += body.usage?.output_tokens ?? 0;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ name, model: opts.model, key, output }, null, 2) + "\n");
      opts.log?.(`  llm ${name}: ${body.usage?.input_tokens ?? "?"} in / ${body.usage?.output_tokens ?? "?"} out`);
      return output;
    } catch (e) {
      lastErr = (e as Error).message;
      if (e instanceof Fatal) throw e; // bad request / auth / refusal: retrying won't help
    }
  }
  throw new Error(`${name}: ${lastErr}`);
}

/** Run fn over items with at most n in flight; results keep input order. */
export async function pool<I, O>(items: I[], n: number, fn: (item: I, i: number) => Promise<O>): Promise<O[]> {
  const out: O[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
