// GBrain (Markdown directory) -> graph -> layout -> palace.json
//
//   bun server/export.ts [out.json] [--brain dir] [--routes file] [--replays dir] [--now ISO]
//
// Reads the brain's Markdown pages directly (the same files `gbrain import` ingests),
// so it needs no gbrain install and never touches a personal brain. Deterministic:
// sorted ids, no randomness, and "now" defaults to the newest page date in the brain,
// so the same input produces byte-identical output.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import { layout, type WingId } from "./layout";
import { Palace, type Agent, type Link, type Memory, type Route } from "./schema";

export const DEFAULT_BRAIN = "fixtures/seed-brain";
const DAY = 86_400_000;
const FRESH_DAYS = 180;

export interface Page {
  id: string; // slug = path without .md
  path: string; // relative to brain dir, posix
  title: string;
  type: string;
  wing: WingId;
  room: string | null; // optional `room:` frontmatter (room label / cluster)
  date: string | null; // ISO date/time used for freshness
  body: string; // markdown body without frontmatter
  text: string; // plain text (links resolved to titles)
  excerpt: string;
  links: Link[];
}

export interface Brain {
  dir: string;
  pages: Page[];
  byId: Map<string, Page>;
  links: Link[];
  warnings: string[];
}

// ---------- parsing ----------

function walk(dir: string, root = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".") || name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, root));
    else if (name.endsWith(".md") && !/^(readme|index|_)/i.test(name)) out.push(relative(root, full).split(sep).join("/"));
  }
  return out;
}

function splitFrontmatter(src: string): { fm: Record<string, unknown>; body: string } {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { fm: {}, body: src };
  let fm: Record<string, unknown> = {};
  try {
    const parsed = Bun.YAML.parse(m[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) fm = parsed as Record<string, unknown>;
  } catch {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
      if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
    }
  }
  return { fm, body: src.slice(m[0].length) };
}

const str = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : typeof v === "string" || typeof v === "number" ? String(v).trim() || null : null;

function teamToWing(team: string | null, id: string): WingId {
  const t = (team ?? "").toLowerCase();
  if (t === "finance" || t === "legal") return t;
  if (t === "eng" || t === "engineering") return "eng";
  if (t) return "people"; // people / shared / anything else
  // No team frontmatter: spec says shared People wing. Pages filed under a team
  // directory without frontmatter still go to that team (seed-author slip guard).
  const top = id.split("/")[0];
  return top === "finance" || top === "legal" || top === "eng" ? top : "people";
}

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^\w\s/-]/g, "").trim().replace(/[\s_]+/g, "-");
const snake = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

function toIsoDate(v: string | null): string | null {
  if (!v) return null;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Last commit date per file under dir (one git call). Empty if not a git repo. */
function gitDates(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const top = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { cwd: dir });
    if (top.exitCode !== 0) return out;
    const root = top.stdout.toString().trim();
    const log = Bun.spawnSync(["git", "log", "--format=@%cI", "--name-only", "--", "."], { cwd: dir });
    if (log.exitCode !== 0) return out;
    let date = "";
    for (const line of log.stdout.toString().split("\n")) {
      if (line.startsWith("@")) date = line.slice(1);
      else if (line.trim()) {
        const rel = relative(dir, join(root, line.trim())).split(sep).join("/");
        if (!out.has(rel)) out.set(rel, date); // newest first
      }
    }
  } catch { /* no git */ }
  return out;
}

const WIKI = /\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;
const MDLINK = /\[([^\]]+)\]\(([^)\s]+?)\)/g;
const SKIP_FM = new Set(["title", "type", "team", "updated", "date", "created", "tags", "aliases", "room"]);

/** Parse every page, then resolve links against the full id set. */
export function readBrain(dir: string): Brain {
  const warnings: string[] = [];
  if (!existsSync(dir)) throw new Error(`brain directory not found: ${dir}`);
  const files = walk(dir);
  const git = gitDates(dir);

  type Raw = { id: string; path: string; fm: Record<string, unknown>; body: string };
  const raws: Raw[] = files.map((path) => {
    const { fm, body } = splitFrontmatter(readFileSync(join(dir, path), "utf8"));
    return { id: path.replace(/\.md$/, ""), path, fm, body };
  });

  const ids = new Set(raws.map((r) => r.id));
  const titles = new Map<string, string>(); // lower title -> id
  const bases = new Map<string, string | null>(); // basename -> id (null if ambiguous)
  const titleOf = new Map<string, string>();
  for (const r of raws) {
    const h1 = /^#\s+(.+)$/m.exec(r.body)?.[1]?.trim();
    const title = str(r.fm.title) ?? h1 ?? r.id.split("/").pop()!;
    titleOf.set(r.id, title);
    titles.set(title.toLowerCase(), r.id);
    const b = r.id.split("/").pop()!;
    bases.set(b, bases.has(b) ? null : r.id);
  }

  const resolve = (target: string, fromId: string): string | null => {
    let t = decodeURIComponent(target.trim()).replace(/\.md$/, "").replace(/^\/+/, "");
    if (/^[a-z]+:\/\//i.test(t)) return null;
    if (ids.has(t)) return t;
    const rel = posix.normalize(posix.join(posix.dirname(fromId), t));
    if (ids.has(rel)) return rel;
    if (titles.has(t.toLowerCase())) return titles.get(t.toLowerCase())!;
    const s = slugify(t);
    if (ids.has(s)) return s;
    const b = bases.get(s.split("/").pop()!);
    return b ?? null;
  };

  const pages: Page[] = [];
  for (const r of raws) {
    const links: { to: string; kind: string }[] = [];
    const add = (target: string, kind: string) => {
      const to = resolve(target, r.id);
      if (!to) return warnings.push(`${r.id}: unresolved link [[${target}]]`);
      if (to !== r.id) links.push({ to, kind: kind || "mentions" });
    };

    // Frontmatter: links: [{to, type}] | ["kind: slug"] | ["slug"]; any other key holding [[wikilinks]].
    for (const [key, val] of Object.entries(r.fm)) {
      if (SKIP_FM.has(key)) continue;
      const items = Array.isArray(val) ? val : [val];
      for (const it of items) {
        if (key === "links" || key === "related") {
          if (it && typeof it === "object") {
            const o = it as Record<string, unknown>;
            const to = str(o.to) ?? str(o.target) ?? str(o.slug) ?? str(o.page);
            if (to) add(to.replace(/^\[\[|\]\]$/g, ""), snake(str(o.type) ?? str(o.kind) ?? str(o.rel) ?? "mentions"));
            continue;
          }
          const s = str(it);
          if (!s) continue;
          const kv = /^([A-Za-z][\w -]*?)\s*::?\s*(.+)$/.exec(s);
          const target = (kv && !kv[2].includes("/") && !kv[1].includes("/") ? s : kv?.[2] ?? s).replace(/^\[\[|\]\]$/g, "");
          add(target.split("|")[0], kv ? snake(kv[1]) : key === "related" ? "related" : "mentions");
          continue;
        }
        const s = str(it);
        if (s) for (const m of s.matchAll(WIKI)) add(m[1], snake(key));
      }
    }

    // Body, line by line. A leading "label:" / "label::" / "- label:" types every link on the line.
    for (const line of r.body.split(/\r?\n/)) {
      const lead = /^\s*(?:[-*+]\s+|\d+\.\s+)?(?:\*\*|__)?([A-Za-z][A-Za-z0-9 _-]{0,40}?)(?:\*\*|__)?\s*::?(?:\*\*|__)?\s+/.exec(line);
      const lineKind = lead && lead[1].split(/\s+/).length <= 4 ? snake(lead[1]) : "";
      // "- funded_by: [[a]], [[b]]" types every link; in prose ("Counterparty: [[a]]. Scope: [[b]]")
      // the label only types the first link, the rest stay plain mentions.
      const rest = lead ? line.slice(lead[0].length) : "";
      const listOnly = !!lead && rest.replace(WIKI, "").replace(/[\s,;&]|and/g, "") === "";
      let first = true;
      for (const m of line.matchAll(WIKI)) {
        let target = m[1];
        let kind = listOnly || first ? lineKind : "";
        first = false;
        const typed = /^([a-z][a-z0-9_-]*)::?(.+)$/i.exec(target); // [[kind::slug]] / [[kind:slug]]
        if (typed && !ids.has(target) && resolve(typed[2], r.id)) {
          kind = snake(typed[1]);
          target = typed[2];
        }
        add(target, kind);
      }
      for (const m of line.matchAll(MDLINK)) {
        if (/^[a-z]+:/i.test(m[2]) || m[2].startsWith("#")) continue;
        const to = resolve(m[2], r.id);
        if (to && to !== r.id) links.push({ to, kind: lineKind || "mentions" });
      }
    }

    // One link per (from, to): prefer a typed kind over "mentions"; else first seen.
    const best = new Map<string, string>();
    for (const l of links) {
      const cur = best.get(l.to);
      if (!cur || (cur === "mentions" && l.kind !== "mentions")) best.set(l.to, l.kind);
    }

    const text = plain(r.body, (t) => {
      const to = resolve(t, r.id);
      return to ? titleOf.get(to)! : t;
    });
    const date = toIsoDate(str(r.fm.updated) ?? str(r.fm.date)) ?? git.get(r.path) ?? null;
    pages.push({
      id: r.id, path: r.path, title: titleOf.get(r.id)!,
      type: str(r.fm.type)?.toLowerCase() ?? "page",
      wing: teamToWing(str(r.fm.team), r.id),
      room: str(r.fm.room),
      date, body: r.body, text, excerpt: excerptOf(text),
      links: [...best].map(([to, kind]) => ({ from: r.id, to, kind })).sort((a, b) => cmp(a.to, b.to)),
    });
  }
  pages.sort((a, b) => cmp(a.id, b.id));
  const links = pages.flatMap((p) => p.links);
  return { dir, pages, byId: new Map(pages.map((p) => [p.id, p])), links, warnings };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Markdown -> readable plain text. Headings dropped, links become their display text. */
export function plain(md: string, titleFor: (target: string) => string = (t) => t): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .split(/\r?\n/)
    .filter((l) => !/^\s*#{1,6}\s/.test(l) && !/^\s*(---+|\*\*\*+)\s*$/.test(l) && !/^\s*\|/.test(l)) // no headings, rules, tables
    .join("\n")
    .replace(WIKI, (_, t, label) => label ?? titleFor(t))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(MDLINK, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/::/g, ":")
    .replace(/\s+/g, " ")
    .trim();
}

function excerptOf(text: string): string {
  if (text.length <= 200) return text;
  const cut = text.slice(0, 200);
  const sp = cut.lastIndexOf(" ");
  return (sp > 140 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, "") + "…";
}

// ---------- demo constraints (replays, routes) ----------

/** Rooms each replayed memory must sit in, from the agent's last `move` before it claims/visits. */
export function replayPins(dir: string, known: Map<string, Page>, warnings: string[]) {
  const pins = new Map<string, string>();
  const minRooms: Partial<Record<WingId, number>> = {};
  const referenced = new Set<string>();
  if (!existsSync(dir)) return { pins, minRooms, referenced };
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort()) {
    const at = new Map<string, string>(); // agent -> current room
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      let e: any;
      try { e = JSON.parse(line); } catch { continue; }
      if (e.type === "move" && typeof e.to === "string") {
        at.set(e.agent, e.to);
        const m = /^room-([a-z]+)-(\d+)$/.exec(e.to);
        if (m) minRooms[m[1] as WingId] = Math.max(minRooms[m[1] as WingId] ?? 0, Number(m[2]) + 1);
      }
      if (typeof e.memoryId === "string") referenced.add(e.memoryId);
      if ((e.type === "claim" || e.type === "visit") && typeof e.memoryId === "string") {
        const room = at.get(e.agent);
        const page = known.get(e.memoryId);
        if (!room || !page || !room.startsWith(`room-${page.wing}-`)) continue;
        const prev = pins.get(e.memoryId);
        if (!prev) pins.set(e.memoryId, room);
        else if (prev !== room) warnings.push(`${f}: ${e.memoryId} replayed in ${room}, already pinned to ${prev}`);
      }
    }
  }
  return { pins, minRooms, referenced };
}

export const AGENTS: Agent[] = [
  { id: "legal", label: "Legal agent", team: "legal", color: "#bb9af7", home: "room-legal-0" },
  { id: "finance", label: "Finance agent", team: "finance", color: "#e0af68", home: "room-finance-0" },
  { id: "eng", label: "Eng agent", team: "eng", color: "#9ece6a", home: "room-eng-0" },
];

/** Hand-authored fallbacks (loci protocol step 1: only used when nothing was learned). */
export const FALLBACK_ROUTES: Route[] = [
  { id: "contract-signoff", label: "Contract sign-off", stations: ["companies/gripworks", "legal/gripworks-msa", "finance/budget-2026-q4", "legal/approvals", "people/signatories"] },
  { id: "board-promises", label: "Board promises", stations: ["finance/board-2026-q3", "people/ada-chen", "people/org-chart"] },
  { id: "soc2-owner", label: "SOC 2 ownership", stations: ["eng/soc2-renewal", "eng/security-policy", "people/org-chart", "eng/soc2-owner"] },
];

export function buildRoutes(file: string, known: Map<string, Page>, warnings: string[]): Route[] {
  const learned = new Map<string, { label: string; stations: string[]; uses: number }>();
  if (existsSync(file)) {
    try {
      const rows = JSON.parse(readFileSync(file, "utf8"));
      for (const r of Array.isArray(rows) ? rows : []) {
        const id = r.routeId ?? r.id;
        if (typeof id !== "string" || !Array.isArray(r.stations)) continue;
        const uses = Number(r.uses ?? 0);
        const cur = learned.get(id);
        if (!cur || uses > cur.uses) learned.set(id, { label: String(r.label ?? r.task ?? id), stations: r.stations, uses });
      }
    } catch (e) {
      warnings.push(`${file}: ${(e as Error).message}`);
    }
  }
  const fallbackIds = new Set(FALLBACK_ROUTES.map((r) => r.id));
  const out: Route[] = [];
  const push = (id: string, label: string, stations: string[]) => {
    const ok = stations.filter((s) => known.has(s));
    for (const s of stations) if (!known.has(s)) warnings.push(`route ${id}: station ${s} not in brain, dropped`);
    if (ok.length) out.push({ id, label, stations: ok });
  };
  for (const fb of FALLBACK_ROUTES) {
    const l = learned.get(fb.id);
    push(fb.id, fb.label, l ? l.stations : fb.stations);
  }
  for (const [id, l] of [...learned].sort((a, b) => cmp(a[0], b[0]))) if (!fallbackIds.has(id)) push(id, l.label, l.stations);
  return out;
}

// ---------- palace ----------

export interface ExportOptions {
  brain: string;
  routes: string;
  replays: string;
  now?: string;
}

export function buildPalace(opts: ExportOptions) {
  const brain = readBrain(opts.brain);
  const warnings = [...brain.warnings];
  const { pins, minRooms, referenced } = replayPins(opts.replays, brain.byId, warnings);
  for (const id of [...referenced].sort()) if (!brain.byId.has(id)) warnings.push(`replay references ${id}, missing from brain`);

  const lay = layout(brain.pages.map((p) => ({ id: p.id, wing: p.wing, type: p.type, group: p.room ?? undefined })), { pins, minRooms });
  warnings.push(...lay.warnings);

  const dated = brain.pages.map((p) => p.date).filter((d): d is string => !!d).sort();
  const nowIso = toIsoDate(opts.now ?? null) ?? dated.at(-1) ?? "2026-09-27T00:00:00.000Z";
  const now = Date.parse(nowIso);

  const memories: Memory[] = brain.pages.map((p) => {
    const at = lay.placement.get(p.id)!;
    const age = p.date ? Math.max(0, (now - Date.parse(p.date)) / DAY) : FRESH_DAYS / 2;
    return {
      id: p.id, title: p.title, type: p.type, room: at.room, pos: at.pos,
      freshness: Math.round(Math.min(1, Math.max(0, 1 - age / FRESH_DAYS)) * 100) / 100,
      excerpt: p.excerpt, path: p.path,
    };
  });

  const palace = {
    version: 1 as const,
    generatedAt: nowIso.replace(/\.000Z$/, "Z"),
    wings: lay.wings,
    rooms: lay.rooms,
    memories,
    links: [...brain.links].sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to) || cmp(a.kind, b.kind)),
    agents: AGENTS,
    routes: buildRoutes(opts.routes, brain.byId, warnings),
  };
  Palace.parse(palace); // fail loudly before writing anything invalid
  return { palace, brain, warnings };
}

function arg(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

if (import.meta.main) {
  const t0 = performance.now();
  const argv = process.argv.slice(2);
  const flagged = new Set<number>();
  argv.forEach((a, i) => a.startsWith("--") && (flagged.add(i), flagged.add(i + 1)));
  const out = arg(argv, "--out") ?? argv.find((_, i) => !flagged.has(i)) ?? "fixtures/palace.json";
  const opts: ExportOptions = {
    brain: arg(argv, "--brain") ?? process.env.BRAIN_DIR ?? DEFAULT_BRAIN,
    routes: arg(argv, "--routes") ?? "fixtures/learned-routes.json",
    replays: arg(argv, "--replays") ?? "fixtures/replays",
    now: arg(argv, "--now"),
  };
  try {
    const { palace, warnings } = buildPalace(opts);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(palace, null, 2) + "\n");
    for (const w of warnings) console.warn(`! ${w}`);
    const ms = Math.round(performance.now() - t0);
    console.log(`✓ ${opts.brain} -> ${out}: ${palace.wings.length} wings, ${palace.rooms.length} rooms, ${palace.memories.length} memories, ${palace.links.length} links, ${palace.routes.length} routes in ${ms} ms`);
  } catch (e) {
    console.error(`✗ export failed: ${(e as Error).message}`);
    process.exit(1);
  }
}
