// "Bring your company": a folder of real-world docs -> GBrain Markdown pages -> palace.json.
//
//   bun server/import/index.ts <dir> --out <brainDir> [--slack export.json]... [--palace out.json]
//       [--gbrain <isolatedDir>] [--cache <dir>] [--offline] [--model id] [--concurrency n]
//
// <dir> may hold .md (plain, Notion export, Google Docs export), .txt, .pdf (pdftotext), .docx
// (textutil) and Slack channel exports (.json). Claude decides department, room, type, title,
// splits, owner and typed links; code keeps slugs, dates, gaps and the output deterministic.
// Responses are cached per request hash in --cache, so `--offline` rebuilds without the API.
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { buildPalace } from "../export";
import { DEFAULT_MODEL, stats, type LlmOptions } from "./llm";
import { render, runImport, type ImportResult } from "./pipeline";
import { loadIntoGbrain } from "./gbrain";

export const REPORT = "_import.json"; // exporter skips `_*` files

export interface CliOptions {
  dir?: string;
  out: string;
  slack: string[];
  palace?: string;
  gbrain?: string;
  llm: LlmOptions;
  concurrency: number;
  quiet?: boolean;
}

/** Remove a previous import's pages; refuse to clobber a directory we didn't write. */
function prepareOut(out: string) {
  if (!existsSync(out)) return mkdirSync(out, { recursive: true });
  const entries = readdirSync(out).filter((n) => !n.startsWith("."));
  if (!entries.length) return;
  if (!existsSync(join(out, REPORT))) throw new Error(`${out} is not empty and has no ${REPORT}; refusing to overwrite it`);
  for (const n of entries) rmSync(join(out, n), { recursive: true, force: true });
}

export async function importCompany(o: CliOptions): Promise<{ result: ImportResult; palaceSummary?: string }> {
  const log = o.quiet ? () => {} : (m: string) => console.log(m);
  const result = await runImport({ dir: o.dir, slack: o.slack, llm: { ...o.llm, log: o.quiet ? undefined : log }, concurrency: o.concurrency, log });

  prepareOut(o.out);
  for (const p of result.pages) {
    const file = join(o.out, `${p.slug}.md`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, render(p));
  }
  const report = {
    model: o.llm.model,
    sources: result.sources,
    skipped: result.skipped,
    slack: result.slack,
    departments: countBy(result.pages.map((p) => (p.department === "shared" ? "people" : p.department))),
    pages: result.pages.length,
    links: result.pages.reduce((n, p) => n + p.links.length, 0),
    gaps: result.gaps,
    warnings: result.warnings,
  };
  writeFileSync(join(o.out, REPORT), JSON.stringify(report, null, 2) + "\n");
  log(`✓ ${result.pages.length} pages, ${report.links} links, ${result.gaps.length} gaps -> ${o.out}`);

  if (o.gbrain) loadIntoGbrain(o.gbrain, o.out, result.pages, log);

  let palaceSummary: string | undefined;
  if (o.palace) {
    // No learned routes or replays belong to an imported company: point both at paths that don't exist.
    const none = join(o.out, ".none");
    const { palace, warnings } = buildPalace({ brain: o.out, routes: join(none, "routes.json"), replays: none });
    const errors = checkPalace(palace);
    if (errors.length) throw new Error(`palace failed checks:\n${errors.join("\n")}`);
    mkdirSync(dirname(resolve(o.palace)), { recursive: true });
    writeFileSync(o.palace, JSON.stringify(palace, null, 2) + "\n");
    const real = warnings.filter((w) => !/^route [\w-]+: station /.test(w)); // Acme fallback routes, expected
    for (const w of real) log(`! export: ${w}`);
    palaceSummary = `${palace.rooms.length} rooms, ${palace.memories.length} memories, ${palace.links.length} links`;
    log(`✓ palace -> ${o.palace}: ${palaceSummary}`);
  }
  return { result, palaceSummary };
}

/** The palace-level checks of server/validate.ts (it also checks Acme's traces/replays, which can't apply here). */
export function checkPalace(palace: ReturnType<typeof buildPalace>["palace"]): string[] {
  const errors: string[] = [];
  const roomIds = new Set(palace.rooms.map((r) => r.id));
  const memIds = new Set(palace.memories.map((m) => m.id));
  for (const w of palace.wings) for (const r of w.rooms) if (!roomIds.has(r)) errors.push(`wing ${w.id}: unknown room ${r}`);
  for (const r of palace.rooms) for (const d of r.doors) if (!roomIds.has(d.to)) errors.push(`room ${r.id}: door to unknown ${d.to}`);
  for (const m of palace.memories) if (!roomIds.has(m.room)) errors.push(`memory ${m.id}: unknown room ${m.room}`);
  for (const l of palace.links) for (const id of [l.from, l.to]) if (!memIds.has(id)) errors.push(`link: unknown memory ${id}`);
  for (const a of palace.agents) if (!roomIds.has(a.home)) errors.push(`agent ${a.id}: unknown home ${a.home}`);
  const per = new Map<string, number>();
  for (const m of palace.memories) per.set(m.room, (per.get(m.room) ?? 0) + 1);
  for (const [r, n] of per) if (n > 12) errors.push(`room ${r}: ${n} memories (max 12)`);
  return errors;
}

function countBy(xs: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of [...xs].sort()) out[x] = (out[x] ?? 0) + 1;
  return out;
}

function parseArgs(argv: string[]): CliOptions {
  const val = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const all = (flag: string) => argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]] : []));
  const valued = new Set(["--out", "--slack", "--palace", "--gbrain", "--cache", "--model", "--concurrency"]);
  const positional = argv.filter((a, i) => !a.startsWith("--") && !valued.has(argv[i - 1]));
  const out = val("--out");
  if (!out || (!positional[0] && !all("--slack").length)) {
    console.error("usage: bun server/import/index.ts <dir> --out <brainDir> [--slack export.json] [--palace out.json] [--gbrain dir] [--cache dir] [--offline] [--model id]");
    process.exit(2);
  }
  return {
    dir: positional[0],
    out,
    slack: all("--slack"),
    palace: val("--palace"),
    gbrain: val("--gbrain"),
    concurrency: Number(val("--concurrency") ?? 4),
    llm: {
      model: val("--model") ?? DEFAULT_MODEL,
      cacheDir: val("--cache") ?? "node_modules/.mp-import-cache",
      offline: argv.includes("--offline"),
    },
  };
}

if (import.meta.main) {
  const t0 = performance.now();
  const opts = parseArgs(process.argv.slice(2));
  try {
    const { result } = await importCompany(opts);
    const s = `${stats.calls} API call(s), ${stats.cached} cached; ${stats.inputTokens} in / ${stats.outputTokens} out tokens`;
    console.log(`  ${s}; ${Math.round(performance.now() - t0)} ms`);
    if (result.gaps.length) {
      console.log("gaps recorded:");
      for (const g of result.gaps) console.log(`  - ${g.page}: ${g.text}`);
    }
    console.log(`next: bun server/export.ts <palace.json> --brain ${relative(process.cwd(), resolve(opts.out)) || "."} --routes none --replays none`);
  } catch (e) {
    console.error(`✗ import failed: ${(e as Error).message}`);
    process.exit(1);
  }
}
