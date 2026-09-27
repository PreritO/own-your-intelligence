// Optional: load the imported pages into an ISOLATED gbrain (never ~/.gbrain).
// Same incantation as fixtures/seed-gbrain.sh (seed-lessons): GBRAIN_HOME=<dir> puts config and the
// PGLite db under <dir>/.gbrain; DATABASE_URL overrides are dropped; auto_link off; typed links via
// `gbrain call add_link` because `gbrain link --type` is ignored in v0.42. Every call has a hard timeout.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { OutPage } from "./pipeline";

const hashFile = (f: string) => (existsSync(f) ? createHash("sha256").update(readFileSync(f)).digest("hex") : "absent");

export function assertIsolated(dir: string): string {
  const abs = resolve(dir);
  const home = homedir();
  const personal = join(home, ".gbrain");
  if (abs === home || abs === personal || abs.startsWith(personal + sep)) throw new Error(`refusing --gbrain ${dir}: that is the personal brain`);
  return abs;
}

export function loadIntoGbrain(dir: string, brainDir: string, pages: OutPage[], log: (m: string) => void): { ok: boolean; links: number; failed: number } {
  const home = assertIsolated(dir);
  mkdirSync(home, { recursive: true });
  const env: Record<string, string> = { ...(process.env as Record<string, string>), GBRAIN_HOME: home };
  delete env.DATABASE_URL;
  delete env.GBRAIN_DATABASE_URL;
  const personalCfg = join(homedir(), ".gbrain", "config.json");
  const before = hashFile(personalCfg);

  const gb = (args: string[], timeout = 120_000) => {
    const r = Bun.spawnSync(["gbrain", ...args], { env, stdout: "pipe", stderr: "pipe", timeout, killSignal: "SIGKILL" });
    return { ok: r.exitCode === 0, out: r.stdout.toString() + r.stderr.toString() };
  };
  if (Bun.spawnSync(["/usr/bin/which", "gbrain"]).exitCode !== 0) {
    log("! gbrain not installed; skipped --gbrain (the Markdown brain dir is still complete)");
    return { ok: false, links: 0, failed: 0 };
  }
  if (!existsSync(join(home, ".gbrain", "config.json"))) {
    const init = gb(["init", "--pglite", "--non-interactive", "--no-embedding"]);
    if (!init.ok) throw new Error(`gbrain init failed: ${init.out.slice(0, 400)}`);
  }
  gb(["config", "set", "auto_link", "false", "--force"]);
  const imp = gb(["import", resolve(brainDir), "--no-embed"], 600_000);
  if (!imp.ok) throw new Error(`gbrain import failed: ${imp.out.slice(0, 400)}`);
  let links = 0, failed = 0;
  for (const p of pages) for (const l of p.links) {
    const r = gb(["call", "add_link", JSON.stringify({ from: p.slug, to: l.to, link_type: l.kind })], 30_000);
    r.ok ? links++ : failed++;
  }
  if (hashFile(personalCfg) !== before) log(`! ~/.gbrain/config.json changed during the import; check GBRAIN_HOME isolation`);
  log(`✓ gbrain (GBRAIN_HOME=${home}): imported ${pages.length} pages, ${links} typed links${failed ? `, ${failed} failed` : ""}`);
  return { ok: true, links, failed };
}
