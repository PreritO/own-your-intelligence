"""Real verification for the loci protocol: a relevance judge for visits and claim-level grounding
for answers. Stdlib only (the protocol service has no dependencies), so Claude is called over raw HTTP.

    relevance(memoryId, title, body, question)  -> does this page answer the question?
        claude-haiku-4-5 (fast). support = answers | partial | silent | contradicts, plus an exact
        quote from the page as evidence. A quote that is not on the page downgrades the result.
    claims(text, sources)                       -> is every claim in an answer on a verified page?
        claude-sonnet-5. Splits the answer into atomic claims and maps each to a verbatim quote from a
        station the agent (or a handoff reply it received) verified in this run.

The model can only make a verdict *stricter*: loci.py combines the relevance result with the rules
judge (blank fields, silent pages, freshness) and keeps the worse of the two.

Modes (MP_JUDGE, or Judge(mode=...)):
  auto    cache, else Claude with a deadline (2.5 s visit / 10 s answer), else rules. The default.
          A call that misses its deadline keeps running in the background and fills the cache, so the
          next visit of the same page + question is instant.
  cache   cache only, never the network (tests, replays). Misses fall back to rules.
  record  cache, else Claude with no deadline, written to the cache (records test fixtures).
  rules   never call Claude: the offline regex judge and citation-only grounding.

Cache: one JSON file per (kind, model, prompt version, memoryId, content hash, question) under
server/protocol/.cache/ (self-gitignored). Tests ship recorded responses in tests/recorded/.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
DEFAULT_CACHE = HERE / ".cache"

JUDGE_MODEL = "claude-haiku-4-5-20251001"
GROUND_MODEL = "claude-sonnet-5"
JUDGE_TIMEOUT = 2.5
GROUND_TIMEOUT = 10.0
PROMPT_VERSION = "v5"  # bump when a prompt or schema changes: old cache entries stop matching

SUPPORT = ("answers", "partial", "silent", "contradicts")
CLAIM_STATUS = ("supported", "unsupported", "gap")

# Transport: (model, system, user, schema, max_tokens, timeout) -> parsed JSON object | None
Transport = Callable[[str, str, str, dict, int, float], "dict | None"]


# ---------------------------------------------------------------- quotes


def _norm(s: str) -> str:
    """Normalise page text and quotes the same way before a substring check: wiki links render to
    their titles, emphasis markers and smart punctuation go, whitespace collapses, case folds."""
    s = re.sub(r"\[\[([^\]|]+)\|([^\]]+)\]\]", r"\2", s)
    s = re.sub(r"\[\[([^\]]+)\]\]", r"\1", s)
    s = s.replace("**", "").replace("__", "").replace("`", "")
    s = s.translate(str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", " ": " "}))
    return " ".join(s.split()).casefold()


def quote_on_page(quote: str, body: str) -> bool:
    """True when `quote` is a verbatim span of `body` (after _norm). An elided quote ("A ... B") must
    have every part on the page, in order. Needs at least 3 letters/digits: "yes" can't support much."""
    q = (quote or "").strip().strip('"\'').strip()
    q = re.sub(r"(?:\.\.\.|…)$", "", q).strip()
    if len(re.findall(r"[0-9A-Za-z]", q)) < 3:
        return False
    page = _norm(body)
    pos = 0
    for part in re.split(r"\s*(?:\.\.\.|…)\s*", q):
        part = _norm(part)
        if not part:
            continue
        i = page.find(part, pos)
        if i < 0:
            return False
        pos = i + len(part)
    return True


# ---------------------------------------------------------------- Claude over HTTP


def load_api_key() -> str | None:
    """ANTHROPIC_API_KEY from the environment, else from the repo's .env (bun loads it for the TS
    servers; `uv run` does not). Never logged."""
    key = os.environ.get("ANTHROPIC_API_KEY")
    if key:
        return key.strip()
    env = REPO / ".env"
    try:
        for line in env.read_text("utf8").splitlines():
            k, _, v = line.partition("=")
            if k.strip().removeprefix("export ").strip() == "ANTHROPIC_API_KEY" and v.strip():
                return v.strip().strip("'\"")
    except OSError:
        pass
    return None


def http_transport(api_key: str) -> Transport:
    def call(model: str, system: str, user: str, schema: dict, max_tokens: int, timeout: float) -> dict | None:
        body: dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user}],
            "output_config": {"format": {"type": "json_schema", "schema": schema}},
        }
        if "sonnet" in model:
            body["thinking"] = {"type": "disabled"}  # a checker, not a reasoner: keep it inside the deadline
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=json.dumps(body).encode(),
            headers={"content-type": "application/json", "x-api-key": api_key, "anthropic-version": "2023-06-01"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                res = json.loads(r.read())
        except urllib.error.HTTPError as e:
            print(f"judge: {model} HTTP {e.code}", flush=True)
            return None
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
            print(f"judge: {model} failed: {type(e).__name__}", flush=True)
            return None
        if res.get("stop_reason") not in ("end_turn", "stop_sequence"):
            print(f"judge: {model} stop_reason {res.get('stop_reason')}", flush=True)
            return None
        text = "".join(b.get("text", "") for b in res.get("content", []) if b.get("type") == "text")
        try:
            out = json.loads(text)
        except ValueError:
            return None
        return out if isinstance(out, dict) else None

    return call


# ---------------------------------------------------------------- prompts

RELEVANCE_SYSTEM = """You check whether one page of a company wiki answers an agent's question.

Judge the underlying information need, not the literal wording: a question phrased "what does <page> say that matters for <task>?" asks whether the page holds facts the task needs.

support:
- answers: the page directly states what the question asks for. Judge like a practical colleague: "Net-45" answers "what are the payment terms?" even though the page could say more. Don't demand details the question did not ask for.
- partial: the page states some of what was asked, or closely relevant facts, but a part the question explicitly asks for is missing.
- silent: nothing on the page helps answer it. The page is about something else, or it only says the thing is unknown, blank, "not recorded" or "TBD". If the page holds facts the asker would use in the answer (a tracker of board follow-ups for "what did we promise the board?", even without repeating every name in the question), it is partial or answers, not silent.
  silent is a loud verdict: it opens a gap that a human must fill. Use it only when the page clearly holds nothing the asker could use. When in doubt between silent and partial, choose partial.
- contradicts: the page states something that conflicts with a premise of the question (a different amount, date, owner or term).

evidence: for answers, partial and contradicts, copy ONE contiguous span from the page, character for character: the single most relevant sentence or table row (no paraphrase, no skipped words, no joining of separate sentences; under 200 characters). For silent, "".
missing: what the question asks that the page does not say, as a short phrase ("who owns the SOC 2 renewal"). "" when support is answers.
contradiction: for contradicts, one short sentence naming the conflict. Otherwise "".
"""

RELEVANCE_SCHEMA = {
    "type": "object",
    "properties": {
        "evidence": {"type": "string"},
        "support": {"type": "string", "enum": list(SUPPORT)},
        "missing": {"type": "string"},
        "contradiction": {"type": "string"},
    },
    "required": ["evidence", "support", "missing", "contradiction"],
    "additionalProperties": False,
}

CLAIMS_SYSTEM = """You audit an agent's answer against the company wiki pages it verified during this run. The agent may only state facts those pages contain.

Split the answer into atomic factual claims (one fact each; keep the agent's wording where you can). Skip statements about the agent's own process (what it wrote, visited or walked, station counts, run numbers), bare lists of page ids, and pleasantries.

For each claim choose a status:
- supported: a verified page states it. memoryId = that page's id; quote = a span copied character for character from that page (no paraphrase, no ellipsis unless you elide words, under 200 characters) that contains every specific in the claim: names, numbers, amounts, dates, terms. A conclusion ("we can sign") is supported only when a quoted fact directly establishes it; quote that fact.
- gap: the claim says information is missing, unknown, not recorded, silent, stale or out of date ("Gap: no SOC 2 owner is recorded", "the security policy may be stale"). memoryId = the page the gap is about. quote = "" or a verbatim span showing the gap.
- unsupported: no verified page states it, a page contradicts it, it only appears on a gap or stale page, or it adds specifics the quote does not contain. memoryId = "" or the closest page; quote = "".

reason: one short phrase, required for unsupported ("no page names the owner", "page says Net-45, not Net-30"), else "".
Be strict. Paraphrase is fine; invented or changed specifics are not.
"""

CLAIMS_SCHEMA = {
    "type": "object",
    "properties": {
        "claims": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "status": {"type": "string", "enum": list(CLAIM_STATUS)},
                    "memoryId": {"type": "string"},
                    "quote": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["text", "status", "memoryId", "quote", "reason"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["claims"],
    "additionalProperties": False,
}


def _sha(*parts: str) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update(p.encode("utf8"))
        h.update(b"\0")
    return h.hexdigest()


def content_hash(body: str) -> str:
    return _sha(body)[:16]


# ---------------------------------------------------------------- the judge


class Judge:
    def __init__(
        self,
        mode: str | None = None,
        cache_dir: Path | str | None = None,
        transport: Transport | None = None,
        judge_model: str | None = None,
        ground_model: str | None = None,
        judge_timeout: float | None = None,
        ground_timeout: float | None = None,
    ):
        self.mode = (mode or os.environ.get("MP_JUDGE") or "auto").lower()
        if self.mode not in ("auto", "cache", "record", "rules"):
            raise ValueError(f"MP_JUDGE must be auto | cache | record | rules, not {self.mode!r}")
        self.cache_dir = Path(cache_dir or os.environ.get("MP_JUDGE_CACHE") or DEFAULT_CACHE)
        self.judge_model = judge_model or os.environ.get("MP_JUDGE_MODEL") or JUDGE_MODEL
        self.ground_model = ground_model or os.environ.get("MP_GROUND_MODEL") or GROUND_MODEL
        self.judge_timeout = float(judge_timeout or os.environ.get("MP_JUDGE_TIMEOUT") or JUDGE_TIMEOUT)
        self.ground_timeout = float(ground_timeout or os.environ.get("MP_GROUND_TIMEOUT") or GROUND_TIMEOUT)
        self.transport = transport
        if transport is None and self.mode in ("auto", "record"):
            key = load_api_key()
            self.transport = http_transport(key) if key else None
        self._inflight: dict[str, threading.Event] = {}
        self._lock = threading.Lock()

    @property
    def live(self) -> bool:
        return self.mode in ("auto", "record") and self.transport is not None

    @property
    def active(self) -> bool:
        """Could this judge produce an LLM result at all (live, or from a cache)?"""
        return self.mode != "rules"

    # ---- cache

    def _path(self, kind: str, key: str) -> Path:
        return self.cache_dir / kind / f"{key}.json"

    def _get(self, kind: str, key: str) -> dict | None:
        try:
            return json.loads(self._path(kind, key).read_text("utf8"))
        except (OSError, ValueError):
            return None

    def _put(self, kind: str, key: str, record: dict) -> None:
        path = self._path(kind, key)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            if self.cache_dir == DEFAULT_CACHE and not (self.cache_dir / ".gitignore").exists():
                (self.cache_dir / ".gitignore").write_text("*\n", "utf8")
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(record, indent=1, ensure_ascii=False) + "\n", "utf8")
            tmp.replace(path)
        except OSError:
            pass

    def _ask(self, kind: str, key: str, meta: dict, model: str, system: str, user: str, schema: dict, max_tokens: int, deadline: float) -> dict | None:
        """Cached structured call. None -> caller falls back to rules."""
        hit = self._get(kind, key)
        if hit is not None:
            return hit.get("response")
        if not self.live:
            return None
        box: dict[str, Any] = {}
        with self._lock:
            ev = self._inflight.get(key)
            owner = ev is None
            if owner:
                ev = self._inflight[key] = threading.Event()

        def work() -> None:
            try:
                res = self.transport(model, system, user, schema, max_tokens, 60.0)  # type: ignore[misc]
                if res is not None:
                    self._put(kind, key, {**meta, "model": model, "prompt": PROMPT_VERSION, "response": res})
                box["res"] = res
            finally:
                with self._lock:
                    self._inflight.pop(key, None)
                ev.set()

        if owner:
            threading.Thread(target=work, daemon=True).start()
        wait = None if self.mode == "record" else deadline
        if not ev.wait(wait):
            return None  # too slow this time; the call finishes in the background and fills the cache
        if "res" in box:
            return box["res"]
        hit = self._get(kind, key)  # someone else's in-flight call landed
        return hit.get("response") if hit else None

    # ---- relevance (visit)

    def relevance(self, memory_id: str, title: str, body: str, question: str) -> dict | None:
        """-> {support, evidence, missing, contradiction, quoteOk} | None (use the rules judge).
        quoteOk is False when the model's evidence is not a verbatim span of the page."""
        if self.mode == "rules" or not question.strip() or not body.strip():
            return None
        q = " ".join(question.split())
        key = _sha("relevance", self.judge_model, PROMPT_VERSION, memory_id, content_hash(body), q)
        user = f"Question: {q}\n\nPage {memory_id} (\"{title}\"):\n<page>\n{body}\n</page>"
        meta = {"kind": "relevance", "memoryId": memory_id, "contentHash": content_hash(body), "question": q}
        raw = self._ask("relevance", key, meta, self.judge_model, RELEVANCE_SYSTEM, user, RELEVANCE_SCHEMA, 400, self.judge_timeout)
        if not raw or raw.get("support") not in SUPPORT:
            return None
        out = {
            "support": raw["support"],
            "evidence": str(raw.get("evidence") or "").strip(),
            "missing": str(raw.get("missing") or "").strip(),
            "contradiction": str(raw.get("contradiction") or "").strip(),
            "quoteOk": True,
        }
        if out["support"] != "silent" and not quote_on_page(out["evidence"], body):
            out["quoteOk"] = False
        return out

    # ---- claims (answer)

    def claims(self, text: str, sources: dict[str, dict]) -> dict | None:
        """Claim-level grounding. sources: memoryId -> {title, body, verdict, note?} for every station
        this agent has a verdict for in the run (own visits + handoff-inherited). Only `verified`
        sources can support a claim. -> {claims: [...], unsupported: [claim text]} | None (no check)."""
        if self.mode == "rules" or not text.strip():
            return None
        verified = {m: s for m, s in sorted(sources.items()) if s["verdict"] == "verified"}
        others = {m: s for m, s in sorted(sources.items()) if s["verdict"] != "verified"}
        parts = [f"Answer:\n<answer>\n{text.strip()}\n</answer>\n", "Verified stations (the only pages that can support a claim):"]
        for m, s in verified.items():
            parts.append(f"<page id=\"{m}\" title=\"{s.get('title') or m}\">\n{s['body']}\n</page>")
        if not verified:
            parts.append("(none)")
        parts.append("\nStations with a gap or a stale page (they cannot support a claim; a claim may state their gap):")
        parts += [f"- {m} \"{s.get('title') or m}\": {s['verdict']}" + (f" ({s['note']})" if s.get("note") else "") for m, s in others.items()] or ["(none)"]
        user = "\n".join(parts)
        key = _sha("claims", self.ground_model, PROMPT_VERSION, text.strip(), *[f"{m}:{s['verdict']}:{content_hash(s['body'])}" for m, s in sorted(sources.items())])
        meta = {"kind": "claims", "text": text.strip(), "sources": {m: {"verdict": s["verdict"], "contentHash": content_hash(s["body"])} for m, s in sorted(sources.items())}}
        raw = self._ask("claims", key, meta, self.ground_model, CLAIMS_SYSTEM, user, CLAIMS_SCHEMA, 2500, self.ground_timeout)
        if not raw or not isinstance(raw.get("claims"), list):
            return None
        return validate_claims(raw["claims"], sources)


def validate_claims(raw: list, sources: dict[str, dict]) -> dict:
    """The model proposes, the code checks: a `supported` claim needs a verbatim quote from a station
    verified in this run (re-homed if the model named the wrong one); a `gap` claim must be about a
    station the agent walked to. Anything else is `unsupported`."""
    verified = {m: s for m, s in sources.items() if s["verdict"] == "verified"}
    claims: list[dict] = []
    unsupported: list[str] = []
    reasons: dict[str, str] = {}
    for c in raw:
        if not isinstance(c, dict) or not str(c.get("text") or "").strip():
            continue
        text = " ".join(str(c["text"]).split())
        status = c.get("status") if c.get("status") in CLAIM_STATUS else "unsupported"
        mid = str(c.get("memoryId") or "").strip()
        quote = " ".join(str(c.get("quote") or "").split())
        reason = str(c.get("reason") or "").strip()
        out: dict[str, Any] = {"text": text, "status": status}
        if status == "supported":
            home = mid if mid in verified and quote_on_page(quote, verified[mid]["body"]) else next((m for m, s in verified.items() if quote_on_page(quote, s["body"])), None)
            if home:
                out.update(memoryId=home, quote=quote)
            else:
                out["status"] = "unsupported"
                on_other = next((m for m, s in sources.items() if m not in verified and quote_on_page(quote, s["body"])), None)
                if on_other:
                    reason = f"only on {on_other}, which is {sources[on_other]['verdict']}, not verified"
                elif mid and mid not in sources:
                    reason = f"{mid} was not verified in this run"
                else:
                    reason = "the quote is not on any station verified in this run"
        elif status == "gap":
            if mid in sources:
                out["memoryId"] = mid
                if quote and quote_on_page(quote, sources[mid]["body"]):
                    out["quote"] = quote
            else:
                out["status"] = "unsupported"
                reason = f"states a gap about {mid or 'a page'} it never walked to in this run"
        if out["status"] == "unsupported":
            if mid and mid in sources and "memoryId" not in out:
                out["memoryId"] = mid
            unsupported.append(text)
            reasons[text] = reason or "no verified station states it"
        claims.append(out)
    return {"claims": claims, "unsupported": unsupported, "reasons": reasons}
