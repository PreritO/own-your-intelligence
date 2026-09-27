// Real-world doc dump -> plain text sources. No LLM here: format detection and cleanup only.
//   .md / .markdown  Markdown, Notion export (32-hex id in the name) or Google Docs export (escapes, {#anchors})
//   .txt             plain text
//   .pdf             `pdftotext -layout` if installed, else skipped with a warning
//   .docx            `textutil -convert txt` (macOS), else skipped with a warning
//   .json            a Slack channel export (auto-detected), same as --slack
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, posix, relative, sep } from "node:path";

export type Format = "markdown" | "notion" | "gdocs" | "text" | "pdf" | "docx" | "slack";

export interface Source {
  path: string; // relative to the import root (posix), or the slack file name
  format: Format;
  title: string; // from the file name / H1 / frontmatter
  text: string; // cleaned text handed to the model
  mtime: string; // YYYY-MM-DD, file modification date (fallback for `updated:`)
  fmDate?: string; // YYYY-MM-DD from Markdown frontmatter (date/updated), if any
  refs: string[]; // other source paths this doc links to (Notion/Markdown relative links)
  parent?: string; // Notion: the parent page's source path (sub-page folder)
}

export interface SlackMessage { i: number; date: string; user: string; text: string; thread?: number }
export interface SlackSource extends Source { format: "slack"; channel: string; messages: SlackMessage[] }

export interface Skipped { path: string; reason: string }

const NOTION_ID = /\s+[0-9a-f]{32}(?=(\.md)?$)/i;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function which(bin: string): boolean {
  try {
    return Bun.spawnSync(["/usr/bin/which", bin]).exitCode === 0;
  } catch {
    return false;
  }
}

function run(cmd: string[]): string | null {
  const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe", timeout: 60_000 });
  return r.exitCode === 0 ? r.stdout.toString() : null;
}

function walk(dir: string, root = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".") || name === "node_modules" || name === "__MACOSX") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, root));
    else out.push(relative(root, full).split(sep).join("/"));
  }
  return out;
}

/** Strip YAML frontmatter; return its title/date if present. */
export function frontmatter(src: string): { body: string; title?: string; date?: string } {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { body: src };
  let fm: Record<string, unknown> = {};
  try {
    const p = Bun.YAML.parse(m[1]);
    if (p && typeof p === "object") fm = p as Record<string, unknown>;
  } catch { /* keep going without it */ }
  const s = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "string" || typeof v === "number" ? String(v) : undefined);
  const date = s(fm.updated) ?? s(fm.date) ?? s(fm.last_edited);
  return { body: src.slice(m[0].length), title: s(fm.title), date: date && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : undefined };
}

/** Google Docs "Download as Markdown": backslash escapes, {#anchor} ids, bold headings, base64 images. */
export function cleanGdocs(md: string): string {
  return md
    .replace(/^\[image\d+\]:\s*<data:[^>]*>\s*$/gm, "") // reference-style base64 images
    .replace(/!\[[^\]]*\]\[image\d+\]/g, "")
    .replace(/!\[[^\]]*\]\(data:[^)]*\)/g, "")
    .replace(/\s*\{#[^}]*\}\s*$/gm, "") // heading anchors
    .replace(/^(#{1,6})\s+\*\*(.+?)\*\*\s*$/gm, "$1 $2") // # **Heading**
    .replace(/\\([\\`*_{}\[\]()#+\-.!|>~<&=])/g, "$1") // escapes
    .replace(/\|\s*:?-{3,}:?\s*(?=\|)/g, "| --- ") // :---- table rules
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Notion export: <aside> callouts, %20-encoded relative links to sibling pages with ids. */
export function cleanNotion(md: string): string {
  return md
    .replace(/<\/?aside>/g, "")
    .replace(/<\/?(details|summary)>/g, "")
    .replace(/\[([^\]]+)\]\(([^)]+?\.md)\)/g, (_, label: string) => label.replace(NOTION_ID, "")) // keep the label
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const isGdocs = (md: string) => /\{#[\w.\-]+\}\s*$/m.test(md) || /^\[image\d+\]:\s*<data:/m.test(md) || (md.match(/\\[-.]/g)?.length ?? 0) >= 3;

/** Relative .md links in a Markdown doc, resolved to import-root paths. */
function mdRefs(md: string, fromPath: string): string[] {
  const out = new Set<string>();
  for (const m of md.matchAll(/\[[^\]]+\]\(([^)\s]+?\.md)\)/g)) {
    if (/^[a-z]+:/i.test(m[1])) continue;
    try {
      out.add(posix.normalize(posix.join(posix.dirname(fromPath), decodeURIComponent(m[1]))));
    } catch { /* bad escape */ }
  }
  return [...out];
}

/** Every importable file under dir. Unknown formats and failed converters land in `skipped`. */
export function collect(dir: string, skipped: Skipped[], warn: (m: string) => void): { sources: Source[]; slackFiles: string[] } {
  const sources: Source[] = [];
  const slackFiles: string[] = [];
  const hasPdf = which("pdftotext");
  const hasTextutil = which("textutil");
  if (!hasPdf) warn("pdftotext not installed: .pdf files will be skipped (brew install poppler)");
  if (!hasTextutil) warn("textutil not available (macOS only): .docx files will be skipped");

  for (const rel of walk(dir)) {
    const full = join(dir, rel);
    const ext = extname(rel).toLowerCase();
    const mtime = isoDay(statSync(full).mtimeMs);
    const stem = basename(rel, extname(rel)).replace(NOTION_ID, "").trim();
    const src = (format: Format, text: string, extra: Partial<Source> = {}): Source =>
      ({ path: rel, format, title: stem, text: text.replace(/\r\n/g, "\n").trim(), mtime, refs: [], ...extra });

    if (ext === ".md" || ext === ".markdown") {
      const raw = readFileSync(full, "utf8");
      const { body, title, date } = frontmatter(raw);
      const notion = NOTION_ID.test(basename(rel, ext));
      const format: Format = notion ? "notion" : isGdocs(body) ? "gdocs" : "markdown";
      const text = format === "notion" ? cleanNotion(body) : format === "gdocs" ? cleanGdocs(body) : body;
      const refs = mdRefs(body, rel);
      // Notion puts a page's sub-pages in a folder named after the page (without the id).
      let parent: string | undefined;
      if (notion) {
        const folder = dirname(rel);
        const sib = walk(dir).find((p) => p !== rel && dirname(p) === dirname(folder) && basename(p, ".md").replace(NOTION_ID, "") === basename(folder));
        if (sib) parent = sib;
      }
      // Title: frontmatter, else a bold-only first line (Google Docs title style), else the first H1, else the file name.
      const boldFirst = /^\s*\*\*([^*\n]+)\*\*\s*$/.exec(text.split("\n").find((l) => l.trim()) ?? "")?.[1];
      const h1 = /^#\s+\**(.+?)\**\s*$/m.exec(text)?.[1];
      sources.push(src(format, text, { title: title ?? boldFirst ?? h1 ?? stem, fmDate: date, refs, parent }));
    } else if (ext === ".txt") {
      sources.push(src("text", readFileSync(full, "utf8")));
    } else if (ext === ".pdf") {
      if (!hasPdf) { skipped.push({ path: rel, reason: "pdftotext not installed" }); continue; }
      const text = run(["pdftotext", "-layout", full, "-"]);
      if (!text?.trim()) { skipped.push({ path: rel, reason: "pdftotext produced no text (scanned PDF?)" }); continue; }
      sources.push(src("pdf", text));
    } else if (ext === ".docx") {
      if (!hasTextutil) { skipped.push({ path: rel, reason: "textutil not available (macOS only)" }); continue; }
      const text = run(["textutil", "-convert", "txt", "-stdout", full]);
      if (!text?.trim()) { skipped.push({ path: rel, reason: "textutil produced no text" }); continue; }
      sources.push(src("docx", text.replace(/^\t•\t/gm, "- ")));
    } else if (ext === ".json" && looksLikeSlack(full)) {
      slackFiles.push(full);
    } else {
      skipped.push({ path: rel, reason: `unsupported format (${ext || "no extension"})` });
    }
  }
  // Keep only refs that point at files we actually imported.
  const have = new Set(sources.map((s) => s.path));
  for (const s of sources) s.refs = s.refs.filter((r) => have.has(r) && r !== s.path);
  return { sources, slackFiles };
}

function looksLikeSlack(file: string): boolean {
  try {
    const j = JSON.parse(readFileSync(file, "utf8"));
    const msgs = Array.isArray(j) ? j : j?.messages;
    return Array.isArray(msgs) && msgs.some((m: any) => m && typeof m.ts === "string" && typeof m.text === "string");
  } catch {
    return false;
  }
}

/**
 * A Slack channel export. Accepts the daily-file shape (an array of messages), an object
 * {channel, users: {id: name} | [{id, real_name}], messages}, or a channel directory of daily files
 * (with users.json one level up, as in a workspace export). Joins/leaves/bot noise are dropped here;
 * the decision/owner filter is the model's job (see plan.ts filterSlack).
 */
export function readSlack(path: string, root?: string): SlackSource {
  let raw: any[] = [];
  let channel = basename(path).replace(/\.json$/, "");
  const users = new Map<string, string>();
  const addUsers = (u: any) => {
    if (Array.isArray(u)) for (const x of u) users.set(x.id, x.real_name ?? x.profile?.real_name ?? x.name ?? x.id);
    else if (u && typeof u === "object") for (const [id, name] of Object.entries(u)) users.set(id, String(name));
  };
  if (statSync(path).isDirectory()) {
    channel = basename(path);
    for (const f of readdirSync(path).filter((f) => f.endsWith(".json")).sort()) raw.push(...JSON.parse(readFileSync(join(path, f), "utf8")));
    const up = join(dirname(path), "users.json");
    if (existsSync(up)) addUsers(JSON.parse(readFileSync(up, "utf8")));
  } else {
    const j = JSON.parse(readFileSync(path, "utf8"));
    if (Array.isArray(j)) raw = j;
    else {
      raw = j.messages ?? [];
      channel = j.channel ?? j.name ?? channel;
      addUsers(j.users);
    }
  }
  const NOISE = new Set(["channel_join", "channel_leave", "channel_topic", "channel_purpose", "bot_message", "pinned_item"]);
  raw = raw.filter((m) => m && typeof m.text === "string" && m.text.trim() && !NOISE.has(m.subtype)).sort((a, b) => Number(a.ts) - Number(b.ts));
  const tsIndex = new Map<string, number>();
  const messages: SlackMessage[] = raw.map((m, i) => {
    tsIndex.set(m.ts, i + 1);
    const user = m.user_profile?.real_name ?? users.get(m.user) ?? m.user ?? "unknown";
    const text = String(m.text)
      .replace(/<@([A-Z0-9]+)>/g, (_, id) => `@${users.get(id) ?? id}`)
      .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
      .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2 ($1)")
      .replace(/<(https?:[^>]+)>/g, "$1");
    return { i: i + 1, date: isoDay(Number(m.ts) * 1000), user, text };
  });
  raw.forEach((m, i) => {
    if (m.thread_ts && m.thread_ts !== m.ts && tsIndex.has(m.thread_ts)) messages[i].thread = tsIndex.get(m.thread_ts);
  });
  const rel = root ? relative(root, path).split(sep).join("/") : basename(path);
  const last = messages.at(-1)?.date ?? isoDay(statSync(path).mtimeMs);
  return {
    path: rel.startsWith("..") ? basename(path) : rel, format: "slack", title: `#${channel}`, channel,
    text: slackTranscript(messages), mtime: last, refs: [], messages,
  };
}

export function slackTranscript(msgs: SlackMessage[]): string {
  return msgs.map((m) => `[${m.i}] ${m.date} ${m.user}${m.thread ? ` (reply in thread [${m.thread}])` : ""}: ${m.text}`).join("\n");
}
