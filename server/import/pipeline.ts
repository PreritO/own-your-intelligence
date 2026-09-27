// Doc dump -> GBrain pages. Deterministic around the model calls: same sources + same cached
// responses -> byte-identical brain directory.
import { collect, readSlack, slackTranscript, type Skipped, type SlackSource, type Source } from "./extract";
import { pool, type LlmOptions } from "./llm";
import {
  filterSlack, planDoc, planLinks, planRooms,
  type CatalogRow, type Department, type DocPlan, type PlannedEntity, type PlannedPage,
} from "./plan";

export interface ImportOptions {
  dir?: string;
  slack: string[];
  llm: LlmOptions;
  concurrency: number;
  log: (m: string) => void;
}

export interface OutLink { to: string; kind: string }
export interface OutPage {
  slug: string;
  title: string;
  type: string;
  department: Department;
  room: string;
  updated: string;
  source: string; // source path(s), comma separated
  summary: string;
  ownerLine: string | null; // "Owner: X." | "Owner: not recorded." | null
  body: string;
  links: OutLink[];
  gaps: string[];
}

export interface Gap { page: string; kind: "owner" | "stated"; text: string }
export interface ImportResult {
  pages: OutPage[];
  gaps: Gap[];
  warnings: string[];
  skipped: Skipped[];
  sources: { path: string; format: string; pages: string[] }[];
  slack: { channel: string; path: string; messages: number; kept: { i: number; why: string; user: string; date: string }[] }[];
}

// ---------- helpers ----------

export const kebab = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "") || "page";

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[*_`|]/g, " ").replace(/\s+/g, " ").trim();
const dirOf = (d: Department) => (d === "shared" ? "people" : d);
const validDay = (s: string | null | undefined) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && s >= "2000-01-01" && s <= "2100-01-01";
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Numeric facts on a page that don't appear in the source (a cheap "verbatim" tripwire). */
export function unsourcedNumbers(pageText: string, sourceText: string): string[] {
  const src = sourceText.replace(/,/g, "");
  const out = new Set<string>();
  for (const m of pageText.matchAll(/\$?\d[\d,]*(?:\.\d+)?%?/g)) {
    const tok = m[0].replace(/,/g, "").replace(/\.$/, "");
    const bare = tok.replace(/^\$/, "").replace(/%$/, "");
    if (bare.length < 2 && !tok.startsWith("$")) continue; // list numbers, single digits
    if (!src.includes(tok) && !src.includes(bare)) out.add(m[0]);
  }
  return [...out];
}

function cleanBody(body: string, title: string): string {
  const lines = body.replace(/\r\n/g, "\n").replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b ?? a).split("\n");
  const out = lines.filter((l, i) => {
    if (/^\s*(\*\*)?owner(\*\*)?\s*:/i.test(l)) return false; // owner is rendered in the lead paragraph
    if (/^#{1,6}\s+links\s*$/i.test(l)) return false; // "## Links" is ours
    if (i < 3 && /^#\s+/.test(l) && norm(l.replace(/^#\s+/, "")) === norm(title)) return false; // duplicate H1
    return true;
  });
  return out.join("\n").replace(/^#\s+/gm, "## ").replace(/\n{3,}/g, "\n\n").trim();
}

function firstNameMap(names: string[]): Map<string, string> {
  const byFirst = new Map<string, string[]>();
  for (const n of names) {
    const parts = n.split(/\s+/);
    if (parts.length < 2) continue;
    const f = parts[0].toLowerCase();
    byFirst.set(f, [...(byFirst.get(f) ?? []), n]);
  }
  const out = new Map<string, string>();
  for (const [f, list] of byFirst) if (new Set(list).size === 1) out.set(f, list[0]);
  return out;
}

const companyKey = (s: string) => norm(s).replace(/&/g, "and").replace(/\b(inc|llc|llp|ltd|corp|co|gmbh)\b\.?/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// ---------- pipeline ----------

export async function runImport(opts: ImportOptions): Promise<ImportResult> {
  const { llm, log } = opts;
  const warnings: string[] = [];
  const skipped: Skipped[] = [];
  const warn = (m: string) => { warnings.push(m); log(`! ${m}`); };

  // 1. Collect sources.
  let docs: Source[] = [];
  const slackFiles = [...opts.slack];
  if (opts.dir) {
    const c = collect(opts.dir, skipped, warn);
    docs = c.sources;
    slackFiles.push(...c.slackFiles);
  }
  for (const s of skipped) warn(`skipped ${s.path}: ${s.reason}`);

  // 2. Slack: keep decision/owner messages only, then treat the survivors as one doc per channel.
  const slackReport: ImportResult["slack"] = [];
  const slackSources = [...new Set(slackFiles)].sort().map((f) => readSlack(f, opts.dir));
  await pool(slackSources, opts.concurrency, async (s: SlackSource) => {
    const keep = await filterSlack(s, llm);
    const kept = keep.map((k) => ({ ...k, msg: s.messages.find((m) => m.i === k.i)! }));
    slackReport.push({
      channel: s.channel, path: s.path, messages: s.messages.length,
      kept: kept.map((k) => ({ i: k.i, why: k.why, user: k.msg.user, date: k.msg.date })),
    });
    log(`  slack #${s.channel}: kept ${kept.length}/${s.messages.length} messages (decisions/owners)`);
    if (!kept.length) return;
    // Only the kept messages reach the page: no thread roots or neighbours, so discussion can't leak in as fact.
    const lines = kept.map((k) => `- ${k.msg.date}, ${k.msg.user}${k.msg.thread ? ` (in thread [${k.msg.thread}])` : ""}: ${k.msg.text}`);
    docs.push({
      ...s, format: "slack", mtime: kept.at(-1)!.msg.date,
      text: `Slack channel #${s.channel}: messages that state a decision or an owner (all other messages were dropped).\n\n${lines.join("\n")}`,
    });
  });
  slackReport.sort((a, b) => cmp(a.path, b.path));
  docs.sort((a, b) => cmp(a.path, b.path));
  if (!docs.length) throw new Error("nothing to import");

  // 3. Plan each doc.
  log(`planning ${docs.length} docs with ${llm.model}${llm.offline ? " (offline cache)" : ""}`);
  const plans: DocPlan[] = await pool(docs, opts.concurrency, async (d) => {
    const p = await planDoc(d, llm);
    log(`  ${d.path} -> ${p.pages.length} page(s)`);
    return p;
  });

  // 4. Pages with unique slugs.
  const pages: OutPage[] = [];
  const bySource = new Map<string, OutPage[]>();
  const used = new Set<string>();
  const uniq = (base: string) => {
    let s = base;
    for (let n = 2; used.has(s); n++) s = `${base}-${n}`;
    used.add(s);
    return s;
  };
  const sourceText = new Map<string, string>();
  const ownerPerson = new Map<string, string>(); // slug -> person name
  docs.forEach((d, di) => {
    const plan = plans[di];
    sourceText.set(d.path, d.text);
    const updated = validDay(plan.doc_date) ? plan.doc_date! : d.fmDate && validDay(d.fmDate) ? d.fmDate : d.mtime;
    const list: OutPage[] = [];
    for (const p of plan.pages as PlannedPage[]) {
      const title = p.title.trim() || d.title;
      const slug = uniq(`${dirOf(p.department)}/${kebab(p.key || title)}`);
      const owner = p.owner?.trim() || null;
      const ownerLine = owner ? `Owner: ${owner.replace(/\.$/, "")}.` : p.is_policy_or_process ? "Owner: not recorded." : null;
      const page: OutPage = {
        slug, title, type: (p.type.trim().toLowerCase().split(/\s+/)[0] || "page").replace(/[^a-z0-9-]/g, ""),
        department: p.department, room: p.room.trim() || "General", updated, source: d.path,
        summary: p.summary.trim().replace(/\s+/g, " "), ownerLine, body: cleanBody(p.body, title), links: [], gaps: p.gaps.map((g) => g.trim()).filter(Boolean),
      };
      if (owner && p.owner_person?.trim()) ownerPerson.set(slug, p.owner_person.trim());
      const missing = unsourcedNumbers(`${page.summary}\n${page.body}`, d.text);
      if (missing.length) warn(`${slug}: numbers not found verbatim in ${d.path}: ${missing.slice(0, 6).join(", ")}`);
      list.push(page);
      pages.push(page);
    }
    bySource.set(d.path, list);
  });

  // 5. Entity pages (people/, companies/) from verified quotes.
  interface Ent { name: string; kind: "person" | "company"; roles: string[]; quotes: { source: string; quote: string }[] }
  const ents = new Map<string, Ent>();
  const rawEnts: { e: PlannedEntity; source: string }[] = [];
  docs.forEach((d, di) => { for (const e of plans[di].entities) rawEnts.push({ e, source: d.path }); });
  const fullNames = firstNameMap(rawEnts.filter((r) => r.e.kind === "person").map((r) => r.e.name.trim()));
  for (const { e, source } of rawEnts) {
    let name = e.name.trim().replace(/\s+/g, " ");
    if (e.kind === "person" && !name.includes(" ")) {
      const full = fullNames.get(name.toLowerCase());
      if (!full) continue; // first name only and ambiguous/unknown: no page
      name = full;
    }
    const key = e.kind === "person" ? `p:${norm(name)}` : `c:${companyKey(name)}`;
    const ent = ents.get(key) ?? { name, kind: e.kind, roles: [], quotes: [] };
    if (e.role?.trim()) ent.roles.push(e.role.trim());
    const q = e.quote.trim();
    if (q && norm(sourceText.get(source)!).includes(norm(q))) ent.quotes.push({ source, quote: q });
    else if (q) warnings.push(`entity ${name}: quote not found verbatim in ${source}, dropped`);
    ents.set(key, ent);
  }
  // Owners that are people always get a page, even if the model didn't list them as an entity.
  for (const person of new Set(ownerPerson.values())) {
    const full = person.includes(" ") ? person : fullNames.get(person.toLowerCase());
    if (full && !ents.has(`p:${norm(full)}`)) ents.set(`p:${norm(full)}`, { name: full, kind: "person", roles: [], quotes: [] });
  }
  const entitySlug = new Map<string, string>(); // norm(name) -> slug
  const entPages: OutPage[] = [];
  for (const [key, e] of [...ents].sort((a, b) => cmp(a[0], b[0]))) {
    const owns = e.kind === "person" ? [...ownerPerson].filter(([, who]) => resolvePerson(who, fullNames) === e.name).map(([s]) => s) : [];
    if (!e.roles.length && !e.quotes.length && !owns.length) continue;
    const role = mostCommon(e.roles);
    const srcs = [...new Set([...e.quotes.map((q) => q.source), ...owns.map((s) => pages.find((p) => p.slug === s)!.source)])].sort();
    const slug = uniq(`${e.kind === "person" ? "people" : "companies"}/${kebab(e.name)}`);
    entitySlug.set(key, slug);
    const mentions = e.quotes
      .filter((q, i, a) => a.findIndex((x) => norm(x.quote) === norm(q.quote)) === i)
      .map((q) => `- "${q.quote.replace(/\s+/g, " ")}" (${pageQuoting(bySource.get(q.source) ?? [], q.quote, e.name)?.title ?? q.source})`);
    const updated = srcs.map((s) => bySource.get(s)?.[0]?.updated).filter(Boolean).sort().at(-1) ?? pages.map((p) => p.updated).sort().at(-1)!;
    const page: OutPage = {
      slug, title: e.name, type: e.kind, department: "shared", room: e.kind === "person" ? "People" : "Companies",
      updated, source: srcs.join(", "),
      summary: role ? `${e.name}: ${role}.`.replace(/\.\.$/, ".") : `${e.name}, named in ${srcs.length} imported document${srcs.length === 1 ? "" : "s"}.`,
      ownerLine: null,
      body: mentions.length ? `## Mentions\n${mentions.join("\n")}` : "",
      links: [], gaps: [],
    };
    entPages.push(page);
    // person -> pages they own; person/company -> the page carrying each quote
    for (const s of owns) page.links.push({ to: s, kind: "owns" });
    for (const q of e.quotes) {
      const target = pageQuoting(bySource.get(q.source) ?? [], q.quote, e.name);
      if (target && !page.links.some((l) => l.to === target.slug)) page.links.push({ to: target.slug, kind: "mentioned_in" });
    }
  }
  pages.push(...entPages);
  const personSlug = (who: string) => {
    const full = resolvePerson(who, fullNames);
    return full ? entitySlug.get(`p:${norm(full)}`) : undefined;
  };

  // 6. Links: owner (deterministic) > model > structure (Notion parent, doc refs, split sections) > mentions.
  const catalog: CatalogRow[] = pages.map((p) => ({ slug: p.slug, title: p.title, type: p.type, department: p.department, summary: p.summary }));
  const slugs = new Set(pages.map((p) => p.slug));
  const batches: { name: string; pages: OutPage[] }[] = docs.map((d) => ({ name: d.path, pages: bySource.get(d.path) ?? [] }));
  for (let i = 0; i < entPages.length; i += 12) batches.push({ name: `entities-${i / 12 + 1}`, pages: entPages.slice(i, i + 12) });
  log(`linking ${pages.length} pages in ${batches.length} batches`);
  const modelLinks = await pool(batches.filter((b) => b.pages.length), opts.concurrency, (b) =>
    planLinks(b.name, catalog, b.pages.map((p) => ({ slug: p.slug, title: p.title, body: render(p, false) })), llm));
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  const add = (from: string, to: string, kind: string) => {
    const p = bySlug.get(from);
    if (!p || !slugs.has(to) || to === from) return false;
    const k = kind.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "mentions";
    if (!p.links.some((l) => l.to === to)) p.links.push({ to, kind: k });
    return true;
  };
  for (const [slug, who] of ownerPerson) {
    const ps = personSlug(who);
    if (ps) add(slug, ps, "owned_by");
  }
  let dropped = 0;
  for (const l of modelLinks.flat()) if (!add(l.from.trim(), l.to.trim(), l.kind)) dropped++;
  if (dropped) warnings.push(`${dropped} model link(s) dropped (unknown slug or self-link)`);
  for (const d of docs) {
    const mine = bySource.get(d.path) ?? [];
    if (!mine.length) continue;
    if (d.parent && bySource.get(d.parent)?.length) add(mine[0].slug, bySource.get(d.parent)![0].slug, "part_of");
    for (const r of d.refs) if (bySource.get(r)?.length) add(mine[0].slug, bySource.get(r)![0].slug, "references");
    for (const p of mine.slice(1)) add(p.slug, mine[0].slug, "part_of");
  }
  for (const e of entPages) for (const l of e.links) if (l.kind === "mentioned_in") add(l.to, e.slug, "mentions");

  // 7. Rooms: merge synonyms per department so each wing has a few well-named rooms.
  const groups = new Map<string, { department: string; room: string; titles: string[] }>();
  for (const p of pages) {
    if (p.type === "person" || p.type === "company") continue;
    const k = `${dirOf(p.department)}\u0000${p.room}`;
    const g = groups.get(k) ?? { department: dirOf(p.department), room: p.room, titles: [] };
    g.titles.push(p.title);
    groups.set(k, g);
  }
  const roomRows = await planRooms([...groups.values()].sort((a, b) => cmp(a.department, b.department) || cmp(a.room, b.room)), llm);
  const roomMap = new Map(roomRows.map((r) => [`${r.department}\u0000${r.from}`, r.to.trim()]));
  for (const p of pages) {
    const to = roomMap.get(`${dirOf(p.department)}\u0000${p.room}`);
    if (to) p.room = to;
  }

  // 8. Gaps and report.
  const gaps: Gap[] = [];
  for (const p of pages) {
    if (p.ownerLine === "Owner: not recorded.") gaps.push({ page: p.slug, kind: "owner", text: `${p.title}: no owner recorded` });
    for (const g of p.gaps) gaps.push({ page: p.slug, kind: "stated", text: g });
  }
  pages.sort((a, b) => cmp(a.slug, b.slug));
  for (const p of pages) p.links.sort((a, b) => cmp(a.kind, b.kind) || cmp(a.to, b.to));
  gaps.sort((a, b) => cmp(a.page, b.page) || cmp(a.kind, b.kind) || cmp(a.text, b.text));
  return {
    pages, gaps, warnings, skipped,
    sources: docs.map((d) => ({ path: d.path, format: d.format, pages: (bySource.get(d.path) ?? []).map((p) => p.slug) })),
    slack: slackReport,
  };
}

function mostCommon(xs: string[]): string | null {
  if (!xs.length) return null;
  const c = new Map<string, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || cmp(a[0], b[0]))[0][0];
}

function resolvePerson(who: string, fullNames: Map<string, string>): string | null {
  const n = who.replace(/\s*\(.*\)\s*$/, "").replace(/,.*$/, "").trim();
  if (n.includes(" ")) return n;
  return fullNames.get(n.toLowerCase()) ?? null;
}

/** The page of a (possibly split) source that carries the quote; else one naming the entity; else the first. */
function pageQuoting(list: OutPage[], quote: string, name: string): OutPage | undefined {
  const text = (p: OutPage) => norm(`${p.summary} ${p.ownerLine ?? ""} ${p.body}`);
  const q = norm(quote);
  const first = name.split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  return list.find((p) => text(p).includes(q))
    ?? list.find((p) => text(p).includes(norm(name)))
    ?? (first ? list.find((p) => new RegExp(`\\b${first}\\b`).test(text(p))) : undefined)
    ?? list[0];
}

// ---------- rendering ----------

const YAML_PLAIN = /^[A-Za-z0-9][A-Za-z0-9 ._/()'-]*$/;
const yamlStr = (s: string) => (YAML_PLAIN.test(s) && !/:\s|\s#/.test(s) ? s : JSON.stringify(s));

/** GBrain page: frontmatter like fixtures/seed-brain, lead paragraph with the Owner line, body, typed ## Links. */
export function render(p: OutPage, withFrontmatter = true): string {
  const fm = [
    "---",
    `title: ${yamlStr(p.title)}`,
    `type: ${p.type}`,
    ...(p.department === "people" || p.department === "shared" ? [] : [`team: ${p.department}`]),
    `room: ${yamlStr(p.room)}`,
    `updated: ${p.updated}`,
    `source: ${yamlStr(p.source)}`,
    "---",
  ];
  // server/ask.ts reads gaps from a page's first 240 characters: keep the Owner line inside them.
  const lead = (p.summary.length > 180 ? [p.ownerLine, p.summary] : [p.summary, p.ownerLine]).filter(Boolean).join(" ");
  const parts = [lead];
  if (p.body) parts.push(p.body);
  if (p.links.length) parts.push(["## Links", ...p.links.map((l) => `- ${l.kind}: [[${l.to}]]`)].join("\n"));
  return `${withFrontmatter ? fm.join("\n") + "\n" : ""}${parts.join("\n\n")}\n`;
}
