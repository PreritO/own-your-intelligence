// One-time machine setup for Memorable (the learned-route store).
//
//   bun server/memorable/setup.ts
//
// Needs the CLI on PATH (`npm i -g memorable-cli`, no sudo with a Homebrew node) and MEMORABLE_API_KEY
// in .env (Bun loads it). Signs the CLI in with that key without a browser (`login --paste`), picks the
// default local backend (~/.memorable/procedures.jsonl) and grants write consent. Idempotent.
// Never prints the key.
const key = process.env.MEMORABLE_API_KEY;
if (!Bun.which("memorable")) {
  console.error("memorable CLI not on PATH. Install it: npm i -g memorable-cli");
  process.exit(1);
}
if (!key) {
  console.error("MEMORABLE_API_KEY is not set (.env).");
  process.exit(1);
}

const redact = (s: string) => s.replace(/mk_[A-Za-z0-9_-]+/g, "mk_***");
function run(args: string[], stdin?: string) {
  const p = Bun.spawnSync(["memorable", ...args], { stdin: stdin ? new TextEncoder().encode(stdin) : undefined, stdout: "pipe", stderr: "pipe" });
  const out = redact(p.stdout.toString() + p.stderr.toString()).trim();
  console.log(`$ memorable ${args.join(" ")}  (exit ${p.exitCode})\n${out}\n`);
  return p.exitCode === 0;
}

run(["login", "--paste"], key + "\n");
run(["init"]);
run(["enable", "--yes"]);
run(["status"]);
