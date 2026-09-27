"""Serve a team's River checkpoint as that department agent's handoff-reply model ("own your intelligence").

    python -m server.train.serve                          # HTTP on :8794 (RIVER_SERVE_PORT)
    python -m server.train.serve ask --page legal/gripworks-msa --question "What are the payment terms?"
    python -m server.train.serve bench [--models river,claude,base] [--show 3]
    python -m server.train.serve sft --steps 30          # optional: reply-format SFT round for Legal

HTTP
  GET  /health  -> {ok, teams: {legal: {checkpoint, base_model, label}}}
  POST /reply   {team, question, pageId, title?, content?, verdict?, task?}
             -> {answer, grounded, claims, label, model, checkpoint, latency_ms}
                  `content` defaults to the seed-brain page for `pageId`.

The model gets a strict prompt: answer only from the page text below, and put every fact in a
verbatim quote. Qwen3.5 is served with thinking off (chat_template_kwargs enable_thinking=False),
as it was trained. `ground()` checks the reply claim by claim against the page (the same check the
eval scores), and the reply carries `grounded` so the caller (server/commission/models.ts) can fall
back to Claude when the specialist didn't quote the page.

Never prints the River or Anthropic key: common.load_dotenv() only fills os.environ.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable

from .common import FIXTURES, OUT, ROOT, load_checkpoints, load_dotenv, river_client, save_checkpoint

PORT = int(os.environ.get("RIVER_SERVE_PORT", "8794"))
BRAIN = FIXTURES / "seed-brain"
SCOREBOARD = FIXTURES / "gym-scoreboard.json"
QWEN = "Qwen/Qwen3.5-9B"
CLAUDE_MODEL = os.environ.get("COMMISSION_MODEL", "claude-sonnet-5")

# The Legal SFT checkpoint River produced in the training workspace (NOTES-training.md). server/train/out
# is gitignored, so the path is pinned here; out/checkpoints.json or RIVER_CHECKPOINT_<TEAM> override it.
DEFAULT_CHECKPOINTS: dict[str, dict[str, str]] = {
    "legal": {
        "key": "sft-legal",
        "inference_path": "river://6932ec36-6bda-43e0-b9a9-4f576919f06a/sampler_weights/sft-legal",
        "base_model": QWEN,
        "label": "Legal specialist (River SFT, Qwen3.5-9B)",
    },
}
GEN = {"max_tokens": 220, "temperature": 0.0, "chat_template_kwargs": {"enable_thinking": False}}


def checkpoint_for(team: str) -> dict[str, str] | None:
    info = dict(DEFAULT_CHECKPOINTS.get(team, {}))
    key = os.environ.get(f"RIVER_CHECKPOINT_KEY_{team.upper()}")  # e.g. sft-legal-reply (a checkpoints.json key)
    saved = load_checkpoints().get(key or info.get("key", f"sft-{team}"), {})
    if saved.get("inference_path"):
        info.update({"key": key or info.get("key", ""), "inference_path": saved["inference_path"], "base_model": saved.get("base_model", QWEN)})
        info.setdefault("label", f"{team.title()} specialist (River SFT, {info['base_model'].split('/')[-1]})")
    if os.environ.get(f"RIVER_CHECKPOINT_{team.upper()}"):
        info["inference_path"] = os.environ[f"RIVER_CHECKPOINT_{team.upper()}"]
        info.setdefault("base_model", QWEN)
        info.setdefault("label", f"{team.title()} specialist (River, {info['base_model'].split('/')[-1]})")
    return info if info.get("inference_path") else None


# ---------------------------------------------------------------- pages


def strip_frontmatter(text: str) -> tuple[dict[str, str], str]:
    meta: dict[str, str] = {}
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            for line in text[3:end].splitlines():
                if ":" in line:
                    k, v = line.split(":", 1)
                    meta[k.strip()] = v.strip().strip("'\"")
            text = text[end + 4 :]
    return meta, text.strip()


def read_page(page_id: str) -> tuple[str, str]:
    """-> (title, body without frontmatter and the ## Links block)."""
    p = BRAIN / f"{page_id}.md"
    if not p.exists():
        raise FileNotFoundError(page_id)
    meta, body = strip_frontmatter(p.read_text("utf8"))
    return meta.get("title", page_id), body.split("\n## Links")[0].strip()


def plain(text: str) -> str:
    """Page/quote text normalised for verbatim matching: wiki links -> titles, no markdown, one space."""
    text = re.sub(r"\[\[[^\]|]+\|([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)
    text = text.replace("’", "'").replace("‘", "'").replace("–", "-").replace("—", "-")
    text = re.sub(r"[*_`#>|]", " ", text)
    text = re.sub(r"-{3,}", " ", text)
    return re.sub(r"\s+", " ", text).strip().lower()


# ---------------------------------------------------------------- prompt


SYSTEM = (
    "You are the {team_label} team agent at Acme Robotics. Another agent handed you a question about a page in your room. "
    "Answer ONLY from the page text below. Rules:\n"
    "1. Every sentence must contain a word-for-word quote from the page in double quotes, copied exactly.\n"
    "2. Do not add facts, numbers, names or advice that are not in the quoted page text.\n"
    "3. If the page does not answer the question, reply exactly: The page doesn't say.\n"
    "4. At most 2 short sentences. No preamble."
)
STALE = "\n5. The page is stale (low freshness): add a final sentence saying it needs a refresh before anyone relies on it."
# The example is deliberately about a page that doesn't exist, so it can't leak an answer into the eval.
EXAMPLE = 'Format example (for an unrelated page): The lease runs "36 months from May 2025" and "rent is due on the 1st".'


def build_messages(team: str, question: str, page_id: str, title: str, content: str, verdict: str = "verified", task: str | None = None) -> list[dict]:
    system = SYSTEM.format(team_label=team.title()) + (STALE if verdict == "stale" else "") + "\n" + EXAMPLE
    user = (f"Their task: {task}\n" if task else "") + f"Their question: {question}\n\nPage {page_id} (\"{title}\", verdict {verdict}):\n{content[:3000]}"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


# ---------------------------------------------------------------- grounding (claim level)

QUOTE_RE = re.compile(r"[\"“”]([^\"“”]{3,}?)[\"“”]")
META_RE = re.compile(r"\b(stale|refresh|freshness|doesn'?t say|does not say|not recorded|isn'?t recorded|is a gap)\b", re.I)


def split_claims(reply: str) -> list[str]:
    reply = re.sub(r"^\s*\[[^\]]{0,80}\]\s*", "", reply.strip())  # a leading [source label]
    # split on sentence ends that are outside quotes
    out, buf, inq = [], "", False
    for i, ch in enumerate(reply):
        buf += ch
        if ch in "\"“”":
            inq = not inq
        nxt = reply[i + 1] if i + 1 < len(reply) else " "
        closes_sentence = ch in "\"“”" and i > 0 and reply[i - 1] in ".!?" and nxt.isspace()
        if not inq and (closes_sentence or (ch in ".!?\n" and (nxt.isspace() or nxt in "\"“”"))):
            if buf.strip(" \n.-"):
                out.append(buf.strip())
            buf = ""
    if buf.strip(" \n.-"):
        out.append(buf.strip())
    return out


def quote_in_page(quote: str, page_plain: str) -> bool:
    parts = [plain(p).strip(" .,;:") for p in re.split(r"\.\.\.|…", quote)]
    parts = [p for p in parts if p]
    return bool(parts) and all(p in page_plain for p in parts)


def ground(reply: str, page: str) -> dict:
    """Claim-level grounding, mirroring the answer.claims contract in server/schema.ts: each sentence is a
    claim; it is `supported` when it carries at least one double-quoted span (>= 2 words) that appears
    verbatim in the page and no quoted span that doesn't; `gap` when it is a meta sentence (page stale /
    silent); `unsupported` otherwise. grounded = no unsupported claims and at least one supported one."""
    page_plain = plain(page)
    claims = []
    for c in split_claims(reply):
        quotes = [q for q in QUOTE_RE.findall(c) if len(q.split()) >= 2 or re.search(r"\d", q)]
        ok = [q for q in quotes if quote_in_page(q, page_plain)]
        if quotes and len(ok) == len(quotes):
            claims.append({"text": c, "status": "supported", "quote": ok[0]})
        elif META_RE.search(c) and not ok:  # a protocol note (page stale / silent), not a claim about the page
            claims.append({"text": c, "status": "gap"})
        else:
            bad = next((q for q in quotes if q not in ok), None)
            claims.append({"text": c, "status": "unsupported", **({"quote": bad} if bad else {})})
    supported = sum(c["status"] == "supported" for c in claims)
    unsupported = sum(c["status"] == "unsupported" for c in claims)
    return {"grounded": supported > 0 and unsupported == 0, "claims": claims, "supported": supported, "unsupported": unsupported}


# ---------------------------------------------------------------- model calls


def _content(result: Any) -> str:
    body = getattr(result, "response_json", result)
    if isinstance(body, (bytes, str)):
        try:
            body = json.loads(body)
        except json.JSONDecodeError:
            return str(body)
    try:
        return (body["choices"][0]["message"]["content"] or "").strip()
    except (KeyError, IndexError, TypeError):
        return str(body)


_client = None


def _river():
    global _client
    if _client is None:
        _client = river_client()
    return _client


def call_checkpoint(messages: list[dict], path: str, base: str = QWEN, timeout: float = 30.0) -> str:
    return _content(_river().chat_complete_from_checkpoint(messages, checkpoint_path=path, base_model=base, timeout=timeout, **GEN))


def call_base(messages: list[dict], base: str = QWEN, timeout: float = 30.0) -> str:
    return _content(_river().chat_complete(messages, base_model=base, timeout=timeout, **GEN))


def call_claude(messages: list[dict], model: str = CLAUDE_MODEL, timeout: float = 45.0) -> str:
    load_dotenv()
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY missing")
    body = {"model": model, "max_tokens": GEN["max_tokens"], "system": messages[0]["content"], "messages": messages[1:]}
    last: Exception | None = None
    for _ in range(3):
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=json.dumps(body).encode(),
            headers={"content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                j = json.loads(r.read())
            return "".join(c.get("text", "") for c in j.get("content", []) if c.get("type") == "text").strip()
        except Exception as e:  # 429/5xx: retry once or twice
            last = e
            time.sleep(2)
    raise RuntimeError(f"claude call failed: {last}")


def reply(team: str, question: str, page_id: str, title: str | None = None, content: str | None = None, verdict: str = "verified", task: str | None = None) -> dict:
    ck = checkpoint_for(team)
    if not ck:
        raise LookupError(f"no River checkpoint for team {team}")
    if content is None or title is None:
        t, body = read_page(page_id)
        title, content = title or t, content if content is not None else body
    msgs = build_messages(team, question, page_id, title, content, verdict, task)
    t0 = time.time()
    answer = call_checkpoint(msgs, ck["inference_path"], ck.get("base_model", QWEN))
    g = ground(answer, content)
    return {
        "answer": answer,
        "grounded": g["grounded"],
        "claims": g["claims"],
        "label": ck["label"],
        "model": ck.get("base_model", QWEN),
        "checkpoint": ck["inference_path"],
        "latency_ms": round((time.time() - t0) * 1000),
    }


# ---------------------------------------------------------------- HTTP


class Handler(BaseHTTPRequestHandler):
    def _json(self, code: int, obj: Any) -> None:
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("access-control-allow-origin", "*")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?")[0] == "/health":
            teams = {t: {k: v for k, v in (checkpoint_for(t) or {}).items() if k != "key"} for t in DEFAULT_CHECKPOINTS}
            return self._json(200, {"ok": True, "teams": teams})
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?")[0] != "/reply":
            return self._json(404, {"error": "not found"})
        try:
            b = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
            res = reply(b["team"], b["question"], b["pageId"], b.get("title"), b.get("content"), b.get("verdict", "verified"), b.get("task"))
            sys.stderr.write(f"reply {b['team']} {b['pageId']} {res['latency_ms']}ms grounded={res['grounded']}\n")
            self._json(200, res)
        except (KeyError, json.JSONDecodeError) as e:
            self._json(400, {"error": f"bad request: {e}"})
        except LookupError as e:
            self._json(404, {"error": str(e)})
        except Exception as e:  # River error: the caller falls back to Claude
            self._json(502, {"error": f"{type(e).__name__}: {e}"[:300]})

    def log_message(self, *_: Any) -> None:
        pass


def serve(port: int) -> None:
    load_dotenv()
    teams = {t: (checkpoint_for(t) or {}).get("inference_path") for t in DEFAULT_CHECKPOINTS}
    print(f"river-serve on :{port} teams={teams}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


# ---------------------------------------------------------------- eval: specialist vs Claude vs base

# 20 held-out Legal handoff questions over the seed brain. None of them is in any SFT dataset (the
# sft-legal checkpoint was trained on route plans; the optional reply-SFT round below excludes these
# questions). `facts`: every group must match (any alternative), case-insensitive, on the reply.
EVAL_SET: list[dict] = [
    {"page": "legal/approvals", "q": "Who approved Gripworks MSA v3, and on what date?", "expected": "Tomas Reyes, Sep 22.", "facts": [["tomas reyes"], ["sep 22", "september 22"]]},
    {"page": "legal/approvals", "q": "When did Legal approve the Harbor Cloud DPA, and what is attached?", "expected": "Approved Jul 14 with SCCs attached.", "facts": [["jul 14", "july 14"], ["scc", "standard contractual"]]},
    {"page": "legal/axis-logistics-msa", "q": "Is the 2026 rate card attached to the signed Axis Logistics MSA?", "expected": "No, it was never attached to the signed copy.", "facts": [["never attached", "not attached", "was never", "isn't attached", "is not attached"]]},
    {"page": "legal/board-consents", "q": "What did the Aug 14 board consent reconfirm?", "expected": "Signature authority: contracts over $30k need the CEO or COO.", "facts": [["30k", "30,000"], ["ceo"], ["coo"]]},
    {"page": "legal/contract-playbook", "q": "Which governing law does the contract playbook set for vendor contracts?", "expected": "Delaware law.", "facts": [["delaware"]]},
    {"page": "legal/export-controls", "q": "What export classification do the arm and controller ship under?", "expected": "EAR99.", "facts": [["ear99"]]},
    {"page": "legal/export-controls", "q": "Do we need an export license to ship the arm to EU customers?", "expected": "No license needed for US and EU customers.", "facts": [["no license", "not need", "don't need", "do not need", "not required", "no export license"]]},
    {"page": "legal/ferro-castings-po-terms", "q": "What are the payment terms in the Ferro Castings PO terms?", "expected": "Net-30.", "facts": [["net-30", "net 30"]]},
    {"page": "legal/ferro-castings-po-terms", "q": "What happens to scrap above the threshold on Ferro Castings POs?", "expected": "Scrap over 4% is credited back.", "facts": [["4%", "4 percent"], ["credit"]]},
    {"page": "legal/gripworks-msa", "q": "What is the contract value of the Gripworks MSA?", "expected": "$40k.", "facts": [["40k", "40,000", "40 k"]]},
    {"page": "legal/gripworks-msa", "q": "Are any deviations from the contract playbook left in Gripworks MSA v3?", "expected": "None remaining after v3.", "facts": [["none"]]},
    {"page": "legal/harbor-cloud-dpa", "q": "What data does the Harbor Cloud DPA cover?", "expected": "Fleet telemetry and customer dashboard data.", "facts": [["telemetry"], ["dashboard"]]},
    {"page": "legal/ip-assignment", "q": "When must a new contractor sign the invention assignment agreement?", "expected": "On day one.", "facts": [["day one", "day 1", "first day"]]},
    {"page": "legal/nda-template", "q": "What is the term of our mutual NDA template?", "expected": "Two years.", "facts": [["two-year", "two year", "2-year", "2 year"]]},
    {"page": "legal/patent-soft-wrist", "q": "When is the non-provisional filing for the soft wrist patent due?", "expected": "March 2027.", "facts": [["march 2027"]]},
    {"page": "legal/privacy-policy", "q": "How long is fleet telemetry retained under the privacy policy?", "expected": "13 months.", "facts": [["13 months", "thirteen months"]]},
    {"page": "legal/series-a-docs", "q": "Who led the Series A and how much did it raise?", "expected": "$12M led by Lumen Ventures.", "facts": [["lumen"], ["12m", "12 million", "$12 m"]]},
    {"page": "legal/trademark-acme", "q": "Which Acme trademark is still pending, and where?", "expected": "GRIPPER V2, pending in the US.", "facts": [["gripper v2"], ["pending"], ["us"]]},
    {"page": "legal/vendor-onboarding", "q": "What is the second step when onboarding a new supplier?", "expected": "Vendor risk review (security questionnaire in Vendor Risk Reviews).", "facts": [["risk review", "security questionnaire"]]},
    {"page": "legal/voltcell-supply-agreement", "q": "What does the Voltcell agreement cost per year, and when is the price reviewed?", "expected": "$180k per year, price review each April.", "facts": [["180k", "180,000"], ["april"]]},
]
EVAL_QUESTIONS = {r["q"] for r in EVAL_SET}


def palace_verdict(page_id: str) -> str:
    """Same thresholds as server/protocol/loci.py judge(): stale when freshness < 0.3."""
    try:
        p = json.loads((FIXTURES / "palace.json").read_text())
        m = next(m for m in p["memories"] if m["id"] == page_id)
        return "stale" if m.get("freshness", 1.0) < 0.3 else "verified"
    except (OSError, StopIteration, ValueError):
        return "verified"


def correct(reply: str, facts: list[list[str]]) -> bool:
    r = plain(reply).replace("$", "")
    return all(any(alt.replace("$", "") in r for alt in group) for group in facts)


def run_eval(models: list[str], show: int = 0, write: bool = True) -> list[dict]:
    load_dotenv()
    ck = checkpoint_for("legal")
    runners: dict[str, tuple[str, Callable[[list[dict]], str]]] = {}
    if "river" in models and ck:
        runners["river"] = (ck["label"], lambda m: call_checkpoint(m, ck["inference_path"], ck.get("base_model", QWEN)))
    for extra in [m for m in models if m.startswith("river:")]:  # river:<checkpoints.json key>
        key = extra.split(":", 1)[1]
        info = load_checkpoints().get(key, {})
        if info.get("inference_path"):
            runners[extra] = (f"Legal specialist (River {key}, {info.get('base_model', QWEN).split('/')[-1]})", lambda m, p=info["inference_path"], b=info.get("base_model", QWEN): call_checkpoint(m, p, b))
    if "claude" in models:
        runners["claude"] = (f"Claude ({CLAUDE_MODEL})", call_claude)
    if "base" in models:
        runners["base"] = ("Base Qwen3.5-9B (River, no fine-tune)", call_base)

    results = []
    for name, (label, fn) in runners.items():
        rows = []
        for i, item in enumerate(EVAL_SET):
            title, body = read_page(item["page"])
            msgs = build_messages("legal", item["q"], item["page"], title, body, palace_verdict(item["page"]))
            t0 = time.time()
            try:
                text = fn(msgs)
            except Exception as e:
                text = f"error: {type(e).__name__}: {e}"[:200]
            ms = (time.time() - t0) * 1000
            g = ground(text, body)
            ok = correct(text, item["facts"])
            # extractive: every non-meta claim is quoted OR copied verbatim without quote marks (a looser, secondary view)
            ext = bool(g["claims"]) and all(c["status"] != "unsupported" or quote_in_page(c["text"].rstrip("."), plain(body)) for c in g["claims"])
            rows.append({"grounded": g["grounded"], "extractive": ext, "correct": ok, "ms": ms, "reply": text})
            if i < show or (show < 0 and not (g["grounded"] and ok)):
                print(f"--- {name} #{i} {item['page']}: {item['q']}\n    {text[:300]!r}\n    grounded={g['grounded']} correct={ok} ({round(ms)} ms)", flush=True)
        n = len(rows)
        lat = sorted(r["ms"] for r in rows)
        res = {
            "team": "legal",
            "model": label,
            "key": name,
            "n": n,
            "grounded": round(sum(r["grounded"] for r in rows) / n, 3),
            "correct": round(sum(r["correct"] for r in rows) / n, 3),
            "both": round(sum(r["grounded"] and r["correct"] for r in rows) / n, 3),
            "extractive": round(sum(r["extractive"] for r in rows) / n, 3),
            "latency_ms": round(lat[n // 2]),
            "latency_ms_mean": round(sum(lat) / n),
        }
        results.append(res)
        print(json.dumps(res), flush=True)
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / f"serve-eval-{name.replace(':', '-')}.json").write_text(json.dumps({"summary": res, "rows": rows}, indent=2))

    print(f"\nLegal handoff replies, {len(EVAL_SET)} held-out questions (grounded = every claim quoted verbatim from the page)\n")
    print(f"{'model':48} {'n':>3} {'grounded':>9} {'correct':>8} {'both':>6} {'extract':>8} {'p50 ms':>7}")
    for r in results:
        print(f"{r['model']:48} {r['n']:>3} {100 * r['grounded']:>8.0f}% {100 * r['correct']:>7.0f}% {100 * r['both']:>5.0f}% {100 * r['extractive']:>7.0f}% {r['latency_ms']:>7}")
    if write and results:
        prev = json.loads(SCOREBOARD.read_text()) if SCOREBOARD.exists() else {}
        rows = [r for r in prev.get("rows", []) if not (r.get("team") == "legal" and r.get("key") in {x["key"] for x in results})]
        rows += [{k: r[k] for k in ("team", "model", "key", "n", "grounded", "correct", "latency_ms")} for r in results]
        SCOREBOARD.write_text(json.dumps({
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "task": "legal handoff replies",
            "metric": "grounded = every claim carries a verbatim quote from the page; correct = expected facts present; latency_ms = p50",
            "rows": rows,
        }, indent=2) + "\n")
        print(f"wrote {SCOREBOARD.relative_to(ROOT)}")
    return results


# ---------------------------------------------------------------- optional: reply-format SFT round


def _replay_handoffs(team: str) -> list[dict]:
    """(question, page) pairs from fixtures/replays/*.jsonl: handoffs addressed to `team` (security questionnaire,
    onboarding quests) and, from the contract runs, the team's own task asked of each of its own pages it visited."""
    out, seen = [], set()

    def add(page: str, q: str, src: str) -> None:
        if (page, q) not in seen:
            seen.add((page, q))
            out.append({"page": page, "q": q, "source": src})

    for p in sorted((FIXTURES / "replays").glob("*.jsonl")):
        task: dict[str, str] = {}
        for line in p.read_text().splitlines():
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if e.get("type") == "handoff" and e.get("toAgent") == team:
                add(e["memoryId"], e["question"], p.stem)
            elif e.get("type") == "task":
                task[e["agent"]] = e["text"]
            elif e.get("type") == "visit" and e.get("agent") == team and e["memoryId"].startswith(f"{team}/") and task.get(team) and e.get("verdict") != "gap":
                add(e["memoryId"], task[team], p.stem)
    return out


def _synthetic_questions(page_id: str, title: str) -> list[str]:
    return [f'For "a cross-team request": what does {title} say?', f"What are the key facts on the {title} page?"]


def build_reply_sft(team: str = "legal") -> list[dict]:
    """Targets are Claude replies under the same strict prompt that pass ground() (distilled, verified).
    Rows: the team's replayed handoffs + two generic questions per page of every *other* department (format
    transfer). The 20 EVAL_SET questions are excluded, and no generic row uses a page of `team`."""
    items = [i for i in _replay_handoffs(team) if (BRAIN / f"{i['page']}.md").exists()]
    for p in sorted(BRAIN.glob("*/*.md")):
        pid = f"{p.parent.name}/{p.stem}"
        if p.parent.name == team:  # keep the eval pages out of the generic rows (replayed handoffs are real runs and stay)
            continue
        title, _ = read_page(pid)
        items += [{"page": pid, "q": q, "source": "generic"} for q in _synthetic_questions(pid, title)]
    items = [i for i in items if i["q"] not in EVAL_QUESTIONS]
    rows = []
    for i, it in enumerate(items):
        title, body = read_page(it["page"])
        msgs = build_messages(it["page"].split("/")[0] if it["source"] == "generic" else team, it["q"], it["page"], title, body, palace_verdict(it["page"]))
        try:
            target = call_claude(msgs)
        except Exception as e:
            print(f"skip {it['page']}: {e}", file=sys.stderr)
            continue
        if ground(target, body)["grounded"]:
            rows.append({"id": f"reply-{i}", "source": it["source"], "page": it["page"], "messages": msgs + [{"role": "assistant", "content": target}]})
    return rows


def reply_sft(steps: int, batch: int, lr: float, rank: int) -> None:
    import random

    import river_client as river  # type: ignore

    from .sft import load_tok, make_datum

    path = OUT / "reply-sft-legal.jsonl"
    if path.exists():
        rows = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]
    else:
        rows = build_reply_sft("legal")
        OUT.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(r) + "\n" for r in rows))
    print(f"reply-SFT rows: {len(rows)} (replays: {sum(r['source'] != 'generic' for r in rows)})", flush=True)
    client = _river()
    tok = load_tok(QWEN)
    data = [make_datum(tok, r) for r in rows]
    data += [make_datum(tok, r) for r in rows if r["source"] != "generic"]  # real runs count twice
    rng = random.Random(0)
    with client.session(project="mind-palace-sft-legal-reply") as session:
        model = session.create_model(base_model=QWEN, lora=river.LoraConfig(rank=rank))
        print(json.dumps({"job": model.model_id, "base": QWEN, "examples": len(data)}), flush=True)
        rec = {"team": "legal", "generation": 2, "recipe": "sft-reply", "jobId": model.model_id, "base_model": QWEN, "status": "training", "steps": steps,
               "trainedOn": f"{len(rows)} grounded Claude replies ({sum(r['source'] != 'generic' for r in rows)} from replays), {steps} steps"}
        (OUT / "ladder").mkdir(parents=True, exist_ok=True)
        (OUT / "ladder" / "legal-gen2.json").write_text(json.dumps(rec, indent=2))
        save_checkpoint("sft-legal-reply", {"team": "legal", "kind": "sft-reply", "base_model": QWEN, "model_id": model.model_id, "status": "training", "steps": steps})
        for _ in range(steps):
            fb = model.forward_backward(rng.sample(data, min(batch, len(data))), loss_fn="cross_entropy")
            model.optim_step(lr=lr, grad_clip_norm=1.0)
            print(json.dumps({"step": model.step, "loss": round(fb.metrics["loss"], 4)}), flush=True)
        inf = model.save_weights("sft-legal-reply", mode="inference")
        trn = model.save_weights("sft-legal-reply-train", mode="training")
        rec.update(status="done", inference_path=inf.path, training_path=trn.path, savedAt=time.strftime("%H:%M:%S"))
        (OUT / "ladder" / "legal-gen2.json").write_text(json.dumps(rec, indent=2))
        save_checkpoint("sft-legal-reply", {"team": "legal", "kind": "sft-reply", "base_model": QWEN, "model_id": model.model_id, "inference_path": inf.path, "steps": steps, "savedAt": time.strftime("%H:%M:%S")})
        print(json.dumps({"saved": inf.path}), flush=True)


# ---------------------------------------------------------------- CLI


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd")
    s = sub.add_parser("serve")
    s.add_argument("--port", type=int, default=PORT)
    a1 = sub.add_parser("ask")
    a1.add_argument("--team", default="legal")
    a1.add_argument("--page", required=True)
    a1.add_argument("--question", required=True)
    e = sub.add_parser("bench")
    e.add_argument("--models", default="river,claude,base", help="comma list: river, claude, base, river:<checkpoints.json key>")
    e.add_argument("--show", type=int, default=0, help="print the first N replies (-1: every miss)")
    e.add_argument("--no-write", action="store_true")
    t = sub.add_parser("sft")
    t.add_argument("--steps", type=int, default=30)
    t.add_argument("--batch", type=int, default=16)
    t.add_argument("--lr", type=float, default=2e-4)
    t.add_argument("--rank", type=int, default=16)
    a = ap.parse_args()
    if a.cmd == "ask":
        print(json.dumps(reply(a.team, a.question, a.page), indent=2))
    elif a.cmd == "bench":
        run_eval([m.strip() for m in a.models.split(",") if m.strip()], a.show, not a.no_write)
    elif a.cmd == "sft":
        reply_sft(a.steps, a.batch, a.lr, a.rank)
    else:
        serve(getattr(a, "port", PORT))


if __name__ == "__main__":
    main()
