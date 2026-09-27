// Ask server: POST /ask {question} -> Trace, GET /palace -> palace.json. Port 8787, CORS open.
//
//   bun server/ask.ts            (env: PALACE, BRAIN_DIR, ANTHROPIC_API_KEY, ASK_PORT, MP_GBRAIN_HOME)
//
// Retrieval: ranked pages (gbrain query on a project-local brain if one exists, else a
// local keyword ranker over the same Markdown) + one-hop link expansion. Every hop's
// `reason` says which of the two produced it. The answer is written only from the
// retrieved pages (Claude if ANTHROPIC_API_KEY is set, else a template). Any error ->
// the closest canned trace from fixtures/traces/.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_BRAIN, plain, readBrain, type Page } from "./export";
import { PORTS, Palace, Trace, type Link } from "./schema";

const PALACE_PATH = process.env.PALACE ?? "fixtures/palace.json";
const BRAIN_DIR = process.env.BRAIN_DIR ?? DEFAULT_BRAIN;
const TRACES_DIR = process.env.TRACES_DIR ?? "fixtures/traces";
const PORT = Number(process.env.ASK_PORT ?? PORTS.ask);
const MODEL = process.env.ASK_MODEL ?? "claude-sonnet-5";
const BUDGET_MS = 8000;
const MAX_HOPS = 6;

type Hop = Trace["hops"][number];
interface Doc { id: string; title: string; type: string; text: string; excerpt: string }

// ---------- corpus ----------

function loadCorpus() {
  const palace = Palace.parse(JSON.parse(readFileSync(PALACE_PATH, "utf8")));
  const inPalace = new Set(palace.memories.map((m) => m.id));
  const docs = new Map<string, Doc>();
  let links: Link[] = palace.links;
  if (existsSync(BRAIN_DIR)) {
    const brain = readBrain(BRAIN_DIR);
    for (const p of brain.pages) if (inPalace.has(p.id)) docs.set(p.id, toDoc(p));
    links = brain.links.filter((l) => inPalace.has(l.from) && inPalace.has(l.to));
  }
  // Pages only in palace.json (no brain on disk) still answer from their excerpt.
  for (const m of palace.memories) if (!docs.has(m.id)) docs.set(m.id, { id: m.id, title: m.title, type: m.type, text: m.excerpt, excerpt: m.excerpt });
  return { palace, docs, links };
}
const toDoc = (p: Page): Doc => ({ id: p.id, title: p.title, type: p.type, text: p.text || plain(p.body), excerpt: p.excerpt });

// ---------- ranking ----------

const STOP = new Set(("a an and are as at be by can could did do does for from had has have how i if in is it its " +
  "last me my next of on or our should so that the their them this to us was we were what when where which who " +
  "whom why will with would you your week today now there any about tell know").split(" "));

const stem = (w: string) => w.replace(/(ies)$/, "y").replace(/(ing|ers|er|ed|es|s)$/, "").slice(0, 8) || w;
export const terms = (s: string) =>
  [...new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w)).map(stem))];

function matches(qt: string, docTerms: Set<string>): boolean {
  if (docTerms.has(qt)) return true;
  if (qt.length < 4) return false;
  for (const d of docTerms) if (d.length >= 4 && (d.startsWith(qt) || qt.startsWith(d))) return true;
  return false;
}

interface Ranked { id: string; score: number; hits: string[] }

function keywordRank(question: string, docs: Map<string, Doc>): Ranked[] {
  const q = terms(question);
  if (!q.length) return [];
  const index = [...docs.values()].map((d) => ({
    id: d.id,
    title: new Set(terms(`${d.title} ${d.type} ${d.id.replace(/[/-]/g, " ")}`)),
    body: new Set(terms(d.text)),
  }));
  const idf = new Map(q.map((t) => {
    const df = index.filter((x) => matches(t, x.title) || matches(t, x.body)).length;
    return [t, Math.log(1 + index.length / (1 + df))];
  }));
  const max = q.reduce((s, t) => s + 3 * idf.get(t)!, 0) || 1;
  return index
    .map((x) => {
      let s = 0;
      const hits: string[] = [];
      for (const t of q) {
        const w = matches(t, x.title) ? 3 : matches(t, x.body) ? 1 : 0;
        if (w) { s += w * idf.get(t)!; hits.push(t); }
      }
      return { id: x.id, score: Math.min(1, s / max * 1.6), hits };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
}

/** gbrain hybrid query, only against a project-local brain. Never the default ~/.gbrain. */
async function gbrainRank(question: string, docs: Map<string, Doc>, ms: number): Promise<Ranked[] | null> {
  if (process.env.MP_GBRAIN === "0") return null;
  const home = process.env.MP_GBRAIN_HOME ?? (existsSync(".gbrain/config.json") ? process.cwd() : null);
  if (!home) return null;
  const proc = Bun.spawn(["gbrain", "call", "query", JSON.stringify({ query: question, limit: 10, expand: false })], {
    env: { ...process.env, GBRAIN_HOME: resolve(home) }, stdout: "pipe", stderr: "ignore", stdin: "ignore",
  });
  // gbrain query can hang (e.g. waiting on an embedding provider); SIGKILL + race so we never block.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string>((_, rej) => {
    timer = setTimeout(() => { proc.kill(9); rej(new Error("gbrain timeout")); }, ms);
  });
  try {
    const out = await Promise.race([new Response(proc.stdout).text(), timeout]);
    const rows = JSON.parse(out) as { slug: string; score: number }[];
    const seen = new Set<string>();
    const ranked = rows.filter((r) => docs.has(r.slug) && !seen.has(r.slug) && seen.add(r.slug));
    if (!ranked.length) return null;
    const top = ranked[0].score || 1;
    return ranked.map((r) => ({ id: r.slug, score: Math.max(0.05, Math.min(1, r.score / top)), hits: [] }));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- trace ----------

const r2 = (n: number) => Math.round(n * 100) / 100;

export function buildHops(question: string, ranked: Ranked[], source: "gbrain" | "keyword", docs: Map<string, Doc>, links: Link[]): Hop[] {
  if (!ranked.length) return [];
  const best = ranked[0].score;
  const seeds = ranked.filter((r) => r.score >= best * 0.35).slice(0, 3);
  const q = terms(question);
  const rel = (id: string) => {
    const d = docs.get(id)!;
    const t = new Set(terms(`${d.title} ${d.text}`));
    return q.filter((x) => matches(x, t)).length / Math.max(1, q.length);
  };
  const hops: Hop[] = [];
  const used = new Set<string>();
  const push = (memoryId: string, reason: string, score: number) => {
    if (used.has(memoryId) || hops.length >= MAX_HOPS) return;
    used.add(memoryId);
    hops.push({ step: hops.length + 1, memoryId, reason, score: r2(score) });
  };
  seeds.forEach((s, i) => {
    const why = source === "gbrain" ? `gbrain query: ranked result #${ranked.indexOf(s) + 1}`
      : `keyword match: ${s.hits.join(", ")}`;
    push(s.id, i === 0 ? why : `${why} (ranked #${ranked.indexOf(s) + 1})`, s.score);
    // One-hop expansion from this seed: outgoing and incoming typed links, most relevant first.
    const title = docs.get(s.id)!.title;
    const nbrs = links
      .filter((l) => l.from === s.id || l.to === s.id)
      .map((l) => {
        const out = l.from === s.id;
        const id = out ? l.to : l.from;
        const r = rel(id);
        const reason = out ? `graph link: ${l.kind} (from ${title})` : `graph backlink: ${l.kind} (to ${title})`;
        return { id, r, reason, typed: l.kind !== "mentions", score: s.score * (0.55 + 0.35 * r) };
      })
      // Relevant neighbours, or typed outgoing edges (a route's next station); never a bare mention.
      .filter((n) => !used.has(n.id) && (n.r > 0 || (n.typed && n.reason.startsWith("graph link"))))
      .sort((a, b) => b.r - a.r || b.score - a.score || (a.id < b.id ? -1 : 1));
    for (const n of nbrs.slice(0, i === 0 ? 2 : 1)) push(n.id, n.reason, n.score);
  });
  return hops;
}

const GAP = /\b(none recorded|not recorded|no owner|unassigned|tbd|unknown|to be determined)\b/i;
const isGap = (d: Doc) => !d.text.trim() || GAP.test(d.text);
const firstSentence = (s: string) => (/^(.+?[.!?])(\s|$)/.exec(s)?.[1] ?? s).slice(0, 180);

function templateAnswer(hops: Hop[], docs: Map<string, Doc>) {
  const ranked = [...hops].sort((a, b) => b.score - a.score);
  const cite = ranked.filter((h) => !isGap(docs.get(h.memoryId)!)).slice(0, 3).map((h) => h.memoryId);
  const gaps = hops.filter((h) => isGap(docs.get(h.memoryId)!)).map((h) => docs.get(h.memoryId)!.title);
  const parts = cite.map((id) => `${docs.get(id)!.title}: ${firstSentence(docs.get(id)!.text)}`);
  let answer = parts.length ? `From the brain — ${parts.join(" ")}` : "No retrieved page answers this.";
  if (gaps.length) answer += ` Gap: ${gaps.join(", ")} has nothing recorded, so this part is unanswered.`;
  return { answer, answerMemoryIds: cite };
}

async function claudeAnswer(question: string, hops: Hop[], docs: Map<string, Doc>, ms: number) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const pages = hops.map((h) => {
    const d = docs.get(h.memoryId)!;
    return `<page id="${d.id}" title="${d.title}">\n${d.text.slice(0, 1500) || "(empty page)"}\n</page>`;
  }).join("\n");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        thinking: { type: "disabled" }, // single short grounded answer; keeps us inside the 8 s budget
        system: "You answer questions about the company Acme Robotics using ONLY the retrieved brain pages given. " +
          "Never use outside knowledge and never guess. If a page is empty or says nothing is recorded, state that gap plainly. " +
          'Reply with only a JSON object: {"answer": "<1-3 plain sentences>", "citations": ["<page id>", ...]} citing the page ids you used.',
        messages: [{ role: "user", content: `${pages}\n\nQuestion: ${question}` }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const body = (await res.json()) as { stop_reason?: string; content: { type: string; text?: string }[] };
    if (body.stop_reason === "refusal") return null;
    const text = body.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const ids = new Set(hops.map((h) => h.memoryId));
    const cites = (Array.isArray(json.citations) ? json.citations : []).filter((c: unknown) => typeof c === "string" && ids.has(c));
    if (typeof json.answer !== "string" || !json.answer.trim()) return null;
    return { answer: json.answer.trim(), answerMemoryIds: [...new Set<string>(cites)] };
  } catch (e) {
    console.warn(`  claude answer failed (${(e as Error).message}); using template`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function ask(question: string): Promise<{ trace: Trace; source: string }> {
  const t0 = Date.now();
  const { docs, links } = loadCorpus();
  const g = await gbrainRank(question, docs, 2000);
  const ranked = g ?? keywordRank(question, docs);
  const hops = buildHops(question, ranked, g ? "gbrain" : "keyword", docs, links);
  if (!hops.length) throw new Error("no pages matched");
  const left = BUDGET_MS - (Date.now() - t0) - 500;
  const llm = left > 1000 ? await claudeAnswer(question, hops, docs, left) : null;
  const { answer, answerMemoryIds } = llm ?? templateAnswer(hops, docs);
  const trace = Trace.parse({ question, hops, answerMemoryIds, answer });
  return { trace, source: `${g ? "gbrain" : "keyword"}+${llm ? "claude" : "template"}` };
}

// ---------- canned fallback ----------

export function cannedTrace(question: string): Trace {
  const files = existsSync(TRACES_DIR) ? readdirSync(TRACES_DIR).filter((f) => f.endsWith(".json")).sort() : [];
  const q = new Set(terms(question));
  let best: Trace | null = null;
  let bestScore = -1;
  for (const f of files) {
    try {
      const t = Trace.parse(JSON.parse(readFileSync(join(TRACES_DIR, f), "utf8")));
      const score = terms(t.question).filter((x) => q.has(x)).length;
      if (score > bestScore) { best = t; bestScore = score; }
    } catch { /* skip bad fixture */ }
  }
  if (!best) throw new Error(`no canned traces in ${TRACES_DIR}`);
  return best;
}

// ---------- http ----------

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS, ...extra } });

if (import.meta.main) {
  Bun.serve({
    port: PORT,
    idleTimeout: 30,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
      if (req.method === "GET" && url.pathname === "/palace") {
        if (!existsSync(PALACE_PATH)) return json({ error: `${PALACE_PATH} missing` }, 404);
        return new Response(Bun.file(PALACE_PATH), { headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS } });
      }
      if (req.method === "GET" && url.pathname === "/health") return json({ ok: true, palace: PALACE_PATH, brain: BRAIN_DIR, model: MODEL });
      if (req.method === "POST" && url.pathname === "/ask") {
        const t0 = Date.now();
        let question = "";
        try {
          const body = (await req.json()) as { question?: unknown };
          question = typeof body.question === "string" ? body.question.trim() : "";
        } catch { /* fall through */ }
        if (!question) return json({ error: "body must be {\"question\": string}" }, 400);
        try {
          if (url.searchParams.has("canned")) throw new Error("canned requested");
          const { trace, source } = await ask(question);
          console.log(`ask ${Date.now() - t0}ms [${source}] ${question} -> ${trace.hops.map((h) => h.memoryId).join(" > ")}`);
          return json(trace, 200, { "x-trace-source": source });
        } catch (e) {
          try {
            const trace = cannedTrace(question);
            console.warn(`ask ${Date.now() - t0}ms [canned: ${(e as Error).message}] ${question}`);
            return json(trace, 200, { "x-trace-source": "canned" });
          } catch (e2) {
            return json({ error: (e2 as Error).message }, 500);
          }
        }
      }
      return json({ error: "not found" }, 404);
    },
  });
  console.log(`ask server on http://localhost:${PORT}  (POST /ask, GET /palace)  palace=${PALACE_PATH} brain=${BRAIN_DIR}`);
}
