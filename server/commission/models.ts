// Which model backs each department agent's handoff replies ("own your intelligence").
//
//   RIVER_TEAMS=legal            teams whose replies come from the company's own River checkpoint (default: none)
//   RIVER_SERVE_URL=http://localhost:8794    server/train/serve.py (uv run --project server/train --extra river python -m server.train.serve)
//   RIVER_TIMEOUT_MS=8000        then fall back to Claude
//   RIVER_REQUIRE_GROUNDED=1     fall back to Claude when the specialist's reply fails the claim-level quote check (0 = accept)
//
// Every reply is labelled with the model that actually wrote it, e.g. "[Legal specialist (River SFT, Qwen3.5-9B)] ...",
// "[Claude claude-sonnet-5] ..." or "[Claude claude-sonnet-5 · River fallback: timeout] ...". The reply event has
// no source field yet (proposal in docs/NOTES-river-serve.md), so the label rides at the start of `answer`.
//
//   bun server/commission/models.ts legal     # prints teamModel(legal) and one live reply
import { claude, MODEL } from "./claude";

export type TeamModel = { team: string; kind: "river" | "claude"; model: string; label: string; url?: string };
export type ReplyPage = { task?: string; question: string; pageId: string; title?: string; verdict?: string; content?: string };
export type TeamAnswer = { text: string; source: "river" | "claude" | "none"; label: string; latencyMs: number; grounded?: boolean; fallback?: string };

const RIVER_URL = () => (process.env.RIVER_SERVE_URL ?? "http://localhost:8794").replace(/\/$/, "");
const RIVER_TIMEOUT_MS = () => Number(process.env.RIVER_TIMEOUT_MS ?? 8000);
const REQUIRE_GROUNDED = () => (process.env.RIVER_REQUIRE_GROUNDED ?? "1") !== "0";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function riverTeams(): Set<string> {
  return new Set((process.env.RIVER_TEAMS ?? "").split(",").map((t) => t.trim().toLowerCase()).filter((t) => t && t !== "off" && t !== "none"));
}

// Which model backs `team`'s replies. River only where RIVER_TEAMS opts in; Claude everywhere else.
// The River label is a default; serve.py's /reply returns the checkpoint's own label, which wins.
export function teamModel(team: string): TeamModel {
  if (riverTeams().has(team.toLowerCase()))
    return { team, kind: "river", model: "Qwen/Qwen3.5-9B", label: `${cap(team)} specialist (River SFT, Qwen3.5-9B)`, url: RIVER_URL() };
  return { team, kind: "claude", model: MODEL, label: `Claude ${MODEL}` };
}

type RiverReply = { answer?: string; grounded?: boolean; label?: string; error?: string; latency_ms?: number };

async function askRiver(team: string, page: ReplyPage): Promise<{ ok: true; text: string; label: string; grounded: boolean } | { ok: false; reason: string }> {
  const m = teamModel(team);
  try {
    const res = await fetch(`${m.url}/reply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ team, ...page }),
      signal: AbortSignal.timeout(RIVER_TIMEOUT_MS()),
    });
    const j = (await res.json().catch(() => ({}))) as RiverReply;
    if (!res.ok || !j.answer) return { ok: false, reason: j.error ? `error ${res.status}` : `http ${res.status}` };
    if (REQUIRE_GROUNDED() && j.grounded === false) return { ok: false, reason: "reply not grounded in quotes" };
    return { ok: true, text: j.answer, label: j.label ?? m.label, grounded: j.grounded !== false };
  } catch (e) {
    const name = (e as Error).name;
    return { ok: false, reason: name === "TimeoutError" || name === "AbortError" ? `timeout ${RIVER_TIMEOUT_MS() / 1000}s` : "serve.py unreachable" };
  }
}

// One team reply with its honest source. `system`/`user` are the orchestrator's Claude prompts (used as is for
// Claude and for the fallback); `page` is what serve.py needs to build its own strict quote-only prompt.
export async function teamAnswer(team: string, system: string, user: string, page: ReplyPage): Promise<TeamAnswer> {
  const t0 = Date.now();
  let fallback: string | undefined;
  if (teamModel(team).kind === "river") {
    const r = await askRiver(team, page);
    if (r.ok) return { text: r.text, source: "river", label: r.label, latencyMs: Date.now() - t0, grounded: r.grounded };
    fallback = r.reason;
    console.warn(`river ${team}: ${r.reason}; falling back to Claude`);
  }
  const text = await claude(system, user, 220, 30000);
  const label = `Claude ${MODEL}${fallback ? ` · River fallback: ${fallback}` : ""}`;
  return { text: text ?? "", source: text ? "claude" : "none", label, latencyMs: Date.now() - t0, fallback };
}

// Drop-in for `claude(system, user, 220, 30000)` in quest.ts teamReply: same null-on-failure contract,
// text prefixed with its source label.
export async function teamComplete(team: string, system: string, user: string, page: ReplyPage): Promise<string | null> {
  const a = await teamAnswer(team, system, user, page);
  return a.text ? `[${a.label}] ${a.text}` : null;
}

if (import.meta.main) {
  const team = process.argv[2] ?? "legal";
  console.log(JSON.stringify(teamModel(team)));
  const content = "Master services agreement draft v3. Net-45 payment, 12-month term, liability cap 1x fees. Redlines resolved Sep 20. Contract value $40k.";
  const question = "What are the payment terms of the Gripworks MSA?";
  const a = await teamAnswer(
    team,
    `You are the ${cap(team)} team agent at Acme Robotics. Answer ONLY from the page text below. 1-3 short sentences, no preamble.`,
    `Their question: ${question}\n\nPage legal/gripworks-msa ("Gripworks MSA", verdict verified):\n${content}`,
    { question, pageId: "legal/gripworks-msa", title: "Gripworks MSA", verdict: "verified", content },
  );
  console.log(JSON.stringify(a));
}
