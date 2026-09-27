"""Loci protocol core: the one place the rules are enforced.

Harness-neutral and dependency-free. `service.py` wraps this in HTTP on :8790; the QM fork and the
UFO extension only translate tool calls into those HTTP calls.

Rules enforced here (see .claude/skills/loci-protocol):
  - ownership: an agent may only claim/visit stations in rooms its team owns or `shared` rooms;
    anything else is refused and the agent must `handoff` to the owning team's agent.
  - claims: a lease (default 30 s). A second agent gets `wait` (heldBy) until it is released/expires.
  - verdicts: gap (page missing / empty / silent) > stale (freshness < 0.3) > verified.
  - grounding: `answer` citations must be stations this agent verified in this run, or stations a
    handoff reply verified for it. Otherwise the answer is emitted with `blocked: true`.
  - route order: answering before every route station has a verdict is blocked too.

Every accepted call appends one or more PalaceEvent dicts (server/schema.ts) to the run log.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

REPO = Path(__file__).resolve().parents[2]
DEFAULT_PALACE = REPO / "fixtures" / "palace.json"
DEFAULT_BRAIN = REPO / "fixtures" / "seed-brain"
DEFAULT_OVERLAY = Path(__file__).resolve().parent / ".overlay"
DEFAULT_RUNS = Path(__file__).resolve().parent / "runs"

STALE_BELOW = 0.3
LEASE_SECONDS = 30.0

# A page "silent on the question": it exists but only says nobody knows.
SILENT_PATTERNS = [
    r"\bno\s+(?:\w+\s+){0,2}(?:is\s+|has\s+been\s+)?(?:recorded|assigned|named|listed|documented)\b",
    r"\b(?:tbd|tbc|todo|unknown|unassigned|not\s+yet\s+(?:assigned|recorded|decided))\b",
    r"\bnobody\b",
]
# Checked on any page length. Deliberately narrow: pages that merely *mention* someone else's gap
# (a roadmap saying ownership is "TBD") must not become gaps themselves.
FIELD_BLANK = r"^\W*(owner|assignee|approver|signatory|dri)\s*(?::|\|)\s*\(?\s*(?:not recorded|none recorded|none|unknown|tbd|unassigned|n/a)\s*\)?\W*$|\b(owner|assignee|approver|signatory)\s*:\s*(?:not recorded|none recorded|unassigned)\b"
LEAD_SILENT = r"\b(?:not|none|never)\s+(?:yet\s+)?recorded\b|\bno\s+(?:\w+\s+){0,2}(?:is\s+)?(?:recorded|on\s+record)\b"


class ProtocolError(Exception):
    """A refused call. `status` maps to the HTTP status; `payload` goes back to the caller."""

    def __init__(self, status: int, message: str, **payload: Any):
        super().__init__(message)
        self.status = status
        self.payload = {"ok": False, "error": message, **payload}


class RealClock:
    def __call__(self) -> float:
        return time.monotonic()


class SimClock:
    """Deterministic clock for tests and the scripted demo driver."""

    def __init__(self, start: float = 0.0):
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, dt: float) -> None:
        self.now += dt


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


class Brain:
    """Reads GBrain pages: overlay (write-backs) > seed-brain markdown > palace excerpt."""

    def __init__(self, brain_dir: Path | None = None, overlay_dir: Path | None = None):
        self.brain_dir = Path(brain_dir or os.environ.get("MP_BRAIN_DIR", DEFAULT_BRAIN))
        self.overlay_dir = Path(overlay_dir or os.environ.get("MP_OVERLAY_DIR", DEFAULT_OVERLAY))

    def _rel(self, memory: dict) -> str:
        return memory.get("path") or f"{memory['id']}.md"

    def read(self, memory: dict) -> dict:
        """-> {body, source, freshness}. body == "" means the page is empty."""
        rel = self._rel(memory)
        overlay = self.overlay_dir / rel
        if overlay.exists():
            _, body = strip_frontmatter(overlay.read_text("utf8"))
            return {"body": body, "source": "overlay", "freshness": 1.0}
        page = self.brain_dir / rel
        if page.exists():
            meta, body = strip_frontmatter(page.read_text("utf8"))
            fresh = memory.get("freshness", 1.0)
            if "freshness" in meta:
                try:
                    fresh = float(meta["freshness"])
                except ValueError:
                    pass
            return {"body": body, "source": "seed-brain", "freshness": fresh}
        return {"body": (memory.get("excerpt") or "").strip(), "source": "palace-excerpt", "freshness": memory.get("freshness", 1.0)}

    def write_back(self, memory: dict, content: str, by: str) -> Path:
        path = self.overlay_dir / self._rel(memory)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"---\ntitle: {memory.get('title', memory['id'])}\nwritten_by: {by}\n---\n\n{content.strip()}\n", "utf8")
        return path


def judge(page: dict) -> tuple[str, str | None]:
    """Verdict for one page read. gap beats stale beats verified."""
    body = page["body"]
    # Ignore markdown headings when deciding whether a page says anything.
    text = "\n".join(l for l in body.splitlines() if not l.lstrip().startswith("#")).strip()
    if not text:
        return "gap", "page is empty"
    # A role/record page whose key field is blank: "Owner: not recorded", "| Owner | (none recorded) |".
    m = re.search(FIELD_BLANK, text, re.I | re.M)
    if m:
        return "gap", f"no {(m.group(1) or m.group(2)).lower()} recorded"
    # The page's lead paragraph says the thing is not on record.
    lead = next((p for p in re.split(r"\n\s*\n", text) if p.strip()), "")
    m = re.search(LEAD_SILENT, lead, re.I)
    if m:
        return "gap", f"page is silent: \"{m.group(0)}\""
    if len(text) < 240:
        for pat in SILENT_PATTERNS:
            m = re.search(pat, text, re.I)
            if m:
                return "gap", f"page is silent: \"{m.group(0)}\""
    if page["freshness"] < STALE_BELOW:
        return "stale", f"freshness {page['freshness']:.2f} < {STALE_BELOW}"
    return "verified", None


_STOP = set("a an and are as at be by can could did do does for from has have how i in is it its of on or our should the this to was we what when where which who will with would you your new page".split())


def _toks(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if len(w) > 2 and w not in _STOP}


def best_snippet(body: str, question: str, limit: int = 180) -> str:
    """The sentence of a page that best answers `question` (token overlap; ties -> earliest).
    Used as a visit's `evidence` when the harness doesn't say which snippet it used."""
    body = body.split("\n## Links")[0]
    body = re.sub(r"\[\[[^\]|]+\|([^\]]+)\]\]", r"\1", body)  # [[slug|Title]] -> Title
    body = re.sub(r"\[\[([^\]]+)\]\]", r"\1", body)
    text = "\n".join(l for l in body.splitlines() if not l.lstrip().startswith(("#", "---", "|--")))
    parts = [p.strip(" -*|\t") for p in re.split(r"(?<=[.!?])\s+|\n+", text)]
    parts = [p for p in parts if len(p) > 12]
    if not parts:
        return ""
    q = _toks(question)
    best = max(enumerate(parts), key=lambda ip: (len(q & _toks(ip[1])), -ip[0]))[1]
    return best if len(best) <= limit else best[: limit - 1].rstrip() + "…"


# ---------------------------------------------------------------- run state


@dataclass
class Lease:
    agent: str
    expires: float


@dataclass
class Handoff:
    id: str
    from_agent: str
    to_agent: str
    memory_id: str
    question: str
    answer: str | None = None
    verdict: str | None = None


@dataclass
class Run:
    id: str
    t0: float
    events: list[dict] = field(default_factory=list)
    location: dict[str, str] = field(default_factory=dict)  # agent -> room id
    routes: dict[str, list[str]] = field(default_factory=dict)  # agent -> stations
    leases: dict[str, Lease] = field(default_factory=dict)  # memoryId -> lease
    verdicts: dict[tuple[str, str], tuple[str, str | None]] = field(default_factory=dict)  # (agent, mem) -> (verdict, note)
    handoffs: dict[str, Handoff] = field(default_factory=dict)
    answers: dict[str, dict] = field(default_factory=dict)  # agent -> last answer check
    last_t: float = 0.0
    log_path: Path | None = None


class Protocol:
    def __init__(
        self,
        palace_path: Path | str | None = None,
        brain: Brain | None = None,
        clock: Callable[[], float] | None = None,
        runs_dir: Path | str | None = None,
        lease_seconds: float = LEASE_SECONDS,
    ):
        self.palace_path = Path(palace_path or os.environ.get("MP_PALACE", DEFAULT_PALACE))
        self.brain = brain or Brain()
        self.clock = clock or RealClock()
        self.runs_dir = Path(runs_dir) if runs_dir else Path(os.environ.get("MP_RUNS_DIR", DEFAULT_RUNS))
        self.lease_seconds = lease_seconds
        self.lock = threading.RLock()
        self.cond = threading.Condition(self.lock)
        self.runs: dict[str, Run] = {}
        self.current: str | None = None
        self.loose_ends: dict[str, dict] = {}  # memoryId -> loose end
        self.listeners: list[Callable[[dict], None]] = []
        # Commissioned (quest) agents: spawned at runtime, not in palace.json. They have no team, so
        # they may only enter `shared` rooms and must hand off everywhere else.
        self.spawned: dict[str, dict] = {}
        self.load_palace()

    # ---- palace

    def load_palace(self) -> None:
        palace = json.loads(self.palace_path.read_text("utf8"))
        self.palace = palace
        self.rooms = {r["id"]: r for r in palace["rooms"]}
        self.memories = {m["id"]: m for m in palace["memories"]}
        self.agents = {a["id"]: a for a in palace.get("agents", [])}
        self.agents.update(getattr(self, "spawned", {}))
        self.routes = {r["id"]: r for r in palace.get("routes", [])}

    def owner_of(self, memory_id: str) -> str:
        return self.rooms[self.memories[memory_id]["room"]]["owner"]

    def agent_for_team(self, team: str) -> str | None:
        for a in self.agents.values():
            if a.get("team") == team:
                return a["id"]
        return None

    def can_enter(self, agent: str, memory_id: str) -> bool:
        owner = self.owner_of(memory_id)
        return owner == "shared" or self.agents[agent].get("team") == owner

    # ---- runs + events

    def start_run(self, run_id: str | None = None, log: bool = True) -> Run:
        with self.lock:
            self.load_palace()
            rid = run_id or time.strftime("run-%Y%m%d-%H%M%S")
            if run_id is None and rid in self.runs:
                n = 2
                while f"{rid}-{n}" in self.runs:
                    n += 1
                rid = f"{rid}-{n}"
            run = Run(id=rid, t0=self.clock())
            run.location = {a["id"]: a["home"] for a in self.agents.values()}
            if log:
                self.runs_dir.mkdir(parents=True, exist_ok=True)
                run.log_path = self.runs_dir / f"{rid}.jsonl"
                run.log_path.write_text("", "utf8")
            self.runs[rid] = run
            self.current = rid
            return run

    def run(self, run_id: str | None) -> Run:
        with self.lock:
            rid = run_id or self.current
            if rid is None:
                return self.start_run()
            if rid not in self.runs:
                return self.start_run(rid)
            return self.runs[rid]

    def emit(self, run: Run, event: dict) -> dict:
        t = round(max(self.clock() - run.t0, run.last_t), 2)
        run.last_t = t
        ev = {"t": t, **event, "run": run.id}
        run.events.append(ev)
        if run.log_path:
            with run.log_path.open("a", encoding="utf8") as f:
                f.write(json.dumps(ev) + "\n")
        for fn in list(self.listeners):
            try:
                fn(ev)
            except Exception:
                pass
        self.cond.notify_all()
        return ev

    # ---- validation helpers

    def _agent(self, agent: str) -> None:
        if agent not in self.agents:
            raise ProtocolError(400, f"unknown agent {agent!r}", agents=sorted(self.agents))

    def _memory(self, memory_id: str) -> dict:
        if memory_id not in self.memories:
            raise ProtocolError(404, f"unknown station {memory_id!r}: no such page in the palace")
        return self.memories[memory_id]

    def _move_to(self, run: Run, agent: str, memory_id: str) -> None:
        room = self.memories[memory_id]["room"]
        if run.location.get(agent) != room:
            run.location[agent] = room
            self.emit(run, {"agent": agent, "type": "move", "to": room})

    def _refuse(self, run: Run, agent: str, memory_id: str) -> None:
        owner = self.owner_of(memory_id)
        to = self.agent_for_team(owner)
        # The agent walks to the door of the room it may not enter, then stops.
        self._move_to(run, agent, memory_id)
        raise ProtocolError(
            403,
            f"{agent} may not enter {self.memories[memory_id]['room']} (owned by {owner}); send a handoff",
            refused=True,
            owner=owner,
            handoffTo=to,
            memoryId=memory_id,
        )

    def _expire(self, run: Run) -> None:
        now = self.clock()
        for mid in [m for m, l in run.leases.items() if l.expires <= now]:
            del run.leases[mid]

    # ---- tools

    def task(self, agent: str, text: str, run_id: str | None = None) -> dict:
        with self.lock:
            self._agent(agent)
            run = self.run(run_id)
            ev = self.emit(run, {"agent": agent, "type": "task", "text": text})
            return {"ok": True, "event": ev}

    def route(self, agent: str, route_id: str, stations: list[str] | None = None, source: str = "fallback", run_id: str | None = None) -> dict:
        with self.lock:
            self._agent(agent)
            run = self.run(run_id)
            if stations is None:
                if route_id not in self.routes:
                    raise ProtocolError(404, f"unknown route {route_id!r}", routes=sorted(self.routes))
                stations = list(self.routes[route_id]["stations"])
            for s in stations:
                self._memory(s)
            if source not in ("learned", "explore", "fallback"):
                raise ProtocolError(400, "source must be learned | explore | fallback")
            run.routes[agent] = list(stations)
            ev = self.emit(run, {"agent": agent, "type": "route", "routeId": route_id, "stations": stations, "source": source})
            return {"ok": True, "stations": stations, "event": ev}

    def claim(self, agent: str, memory_id: str, run_id: str | None = None, ttl: float | None = None) -> dict:
        with self.lock:
            self._agent(agent)
            self._memory(memory_id)
            run = self.run(run_id)
            if not self.can_enter(agent, memory_id):
                self._refuse(run, agent, memory_id)
            self._move_to(run, agent, memory_id)
            self._expire(run)
            lease = run.leases.get(memory_id)
            if lease and lease.agent != agent:
                self.emit(run, {"agent": agent, "type": "wait", "memoryId": memory_id, "heldBy": lease.agent})
                return {"ok": False, "wait": True, "heldBy": lease.agent, "expiresIn": round(lease.expires - self.clock(), 2)}
            if lease and lease.agent == agent:
                lease.expires = self.clock() + (ttl or self.lease_seconds)
                return {"ok": True, "renewed": True}
            run.leases[memory_id] = Lease(agent, self.clock() + (ttl or self.lease_seconds))
            ev = self.emit(run, {"agent": agent, "type": "claim", "memoryId": memory_id})
            return {"ok": True, "event": ev, "leaseSeconds": ttl or self.lease_seconds}

    def visit(self, agent: str, memory_id: str, run_id: str | None = None, question: str | None = None, subtask: str | None = None, evidence: str | None = None) -> dict:
        with self.lock:
            self._agent(agent)
            memory = self._memory(memory_id)
            run = self.run(run_id)
            if not self.can_enter(agent, memory_id):
                self._refuse(run, agent, memory_id)
            self._expire(run)
            lease = run.leases.get(memory_id)
            if lease is None:
                # Claim before working: the service places the claim if the agent skipped it.
                c = self.claim(agent, memory_id, run.id)
                if not c["ok"]:
                    return c
            elif lease.agent != agent:
                self._move_to(run, agent, memory_id)
                self.emit(run, {"agent": agent, "type": "wait", "memoryId": memory_id, "heldBy": lease.agent})
                return {"ok": False, "wait": True, "heldBy": lease.agent, "expiresIn": round(lease.expires - self.clock(), 2)}
            self._move_to(run, agent, memory_id)

            page = self.brain.read(memory)
            verdict, note = judge(page)
            # Reuse a verdict another agent landed on this station in this run (after a wait).
            other = next(((a, v) for (a, m), v in run.verdicts.items() if m == memory_id and a != agent), None)
            if other and page["source"] != "overlay" and other[1][0] == verdict:
                note = f"reused {other[0]}'s verdict" + (f"; {note}" if note else "")
            run.verdicts[(agent, memory_id)] = (verdict, note)
            run.leases.pop(memory_id, None)  # lease released once the verdict lands
            ev = {"agent": agent, "type": "visit", "memoryId": memory_id, "verdict": verdict}
            if note:
                ev["note"] = note
            # The snippet the agent used: the caller's, else the page sentence that best answers the
            # question. A gap has nothing to use, so it carries no evidence.
            if verdict != "gap":
                ev_text = (evidence or "").strip() or best_snippet(page["body"], question or memory.get("title", ""))
                if ev_text:
                    ev["evidence"] = ev_text
            if subtask:
                ev["subtask"] = subtask
            ev = self.emit(run, ev)
            if verdict == "gap":
                self._open_loose_end(run, agent, memory_id, note, question)
            elif page["source"] == "overlay" and memory_id in self.loose_ends:
                self.loose_ends[memory_id]["status"] = "verified"
            return {
                "ok": True,
                "verdict": verdict,
                "note": note,
                "freshness": page["freshness"],
                "source": page["source"],
                "content": page["body"],
                "title": memory.get("title"),
                "evidence": ev.get("evidence"),
                "event": ev,
            }

    def handoff(self, agent: str, memory_id: str, question: str, to_agent: str | None = None, run_id: str | None = None) -> dict:
        with self.lock:
            self._agent(agent)
            self._memory(memory_id)
            run = self.run(run_id)
            owner = self.owner_of(memory_id)
            to_agent = to_agent or self.agent_for_team(owner)
            if to_agent is None or to_agent not in self.agents:
                raise ProtocolError(400, f"no agent owns {owner}")
            if owner != "shared" and self.agents[to_agent].get("team") != owner:
                raise ProtocolError(403, f"{to_agent} does not own {memory_id} (owner {owner}); hand off to {self.agent_for_team(owner)}")
            if to_agent == agent:
                raise ProtocolError(400, "cannot hand off to yourself; visit the station")
            if not question.strip():
                raise ProtocolError(400, "a handoff needs one specific question")
            hid = f"h{len(run.handoffs) + 1}"
            run.handoffs[hid] = Handoff(hid, agent, to_agent, memory_id, question.strip())
            ev = self.emit(run, {"agent": agent, "type": "handoff", "id": hid, "toAgent": to_agent, "memoryId": memory_id, "question": question.strip()})
            return {"ok": True, "id": hid, "toAgent": to_agent, "event": ev}

    def inbox(self, agent: str, run_id: str | None = None) -> list[dict]:
        with self.lock:
            run = self.run(run_id)
            return [
                {"id": h.id, "from": h.from_agent, "memoryId": h.memory_id, "question": h.question}
                for h in run.handoffs.values()
                if h.to_agent == agent and h.answer is None
            ]

    def handoff_status(self, hid: str, run_id: str | None = None) -> dict:
        with self.lock:
            run = self.run(run_id)
            h = run.handoffs.get(hid)
            if not h:
                raise ProtocolError(404, f"unknown handoff {hid}")
            return {"id": h.id, "from": h.from_agent, "toAgent": h.to_agent, "memoryId": h.memory_id, "question": h.question, "answered": h.answer is not None, "answer": h.answer, "verdict": h.verdict}

    def reply(self, agent: str, hid: str, answer: str, run_id: str | None = None) -> dict:
        with self.lock:
            self._agent(agent)
            run = self.run(run_id)
            h = run.handoffs.get(hid)
            if not h:
                raise ProtocolError(404, f"unknown handoff {hid}")
            if h.to_agent != agent:
                raise ProtocolError(403, f"handoff {hid} is addressed to {h.to_agent}, not {agent}")
            if h.answer is not None:
                raise ProtocolError(409, f"handoff {hid} already answered")
            v = run.verdicts.get((agent, h.memory_id))
            if v is None:
                raise ProtocolError(409, f"visit {h.memory_id} before replying: a reply must be grounded in a verdict from this run")
            h.answer, h.verdict = answer.strip(), v[0]
            # The requester inherits the replier's verdict for grounding its answer.
            run.verdicts.setdefault((h.from_agent, h.memory_id), (v[0], f"via handoff {hid} from {agent}"))
            ev = self.emit(run, {"agent": agent, "type": "reply", "id": hid, "answer": h.answer})
            return {"ok": True, "verdict": v[0], "event": ev}

    def answer(self, agent: str, text: str, citations: list[str], run_id: str | None = None) -> dict:
        with self.lock:
            self._agent(agent)
            run = self.run(run_id)
            reasons: list[str] = []
            mine = {m: v for (a, m), v in run.verdicts.items() if a == agent}
            if not citations:
                reasons.append("no citations")
            for c in citations:
                v = mine.get(c)
                if v is None:
                    reasons.append(f"{c}: not visited in this run")
                elif v[0] != "verified":
                    reasons.append(f"{c}: verdict is {v[0]}, not verified")
            route = run.routes.get(agent, [])
            skipped = [s for s in route if s not in mine]
            if skipped:
                reasons.append("route not finished: " + ", ".join(skipped))
            gaps = sorted({m for m, v in mine.items() if v[0] == "gap"} | {m for m in route if mine.get(m, ("",))[0] == "gap"})
            stale = sorted(m for m, v in mine.items() if v[0] == "stale")
            blocked = bool(reasons)
            ev: dict[str, Any] = {"agent": agent, "type": "answer", "text": text, "citations": list(citations)}
            if gaps:
                ev["gaps"] = gaps
            if stale:
                ev["stale"] = stale
            if blocked:
                ev["blocked"] = True
            ev = self.emit(run, ev)
            res = {"ok": not blocked, "blocked": blocked, "reasons": reasons, "gaps": gaps, "stale": stale, "event": ev}
            run.answers[agent] = res
            return res

    def grounding(self, agent: str, text: str | None = None, run_id: str | None = None) -> dict:
        """Pre-post check for a harness (QM fork): may this agent's message go out?
        ok = its last `answer` in the run passed; annotate = passed but has gaps/stale stations the
        text must state (we append them); block = blocked, or it never answered through the protocol."""
        with self.lock:
            self._agent(agent)
            run = self.run(run_id)
            a = run.answers.get(agent)
            if a is None:
                return {"verdict": "block", "reason": "no answer went through the loci protocol in this run", "run": run.id}
            if a["blocked"]:
                return {"verdict": "block", "reason": "; ".join(a["reasons"]), "run": run.id}
            out = text if text is not None else a["event"]["text"]
            missing = [m for m in a["gaps"] + a["stale"] if m not in out]
            if missing:
                title = lambda m: self.memories[m].get("title", m)  # noqa: E731
                notes = [f"gap: {title(m)} ({m})" for m in a["gaps"] if m in missing] + [f"stale: {title(m)} ({m})" for m in a["stale"] if m in missing]
                return {"verdict": "annotate", "text": out + "\n\n_" + "; ".join(notes) + "_", "run": run.id, "citations": a["event"]["citations"]}
            return {"verdict": "ok", "text": out, "run": run.id, "citations": a["event"]["citations"]}

    # ---- commissioned quests (spawn / move / phase / artifact / train_step)

    def spawn(self, agent: str, label: str, color: str, home: str = "foyer", task: str | None = None, harness: str | None = None, run_id: str | None = None) -> dict:
        """Register a commissioned agent (not in palace.json). It has no team: shared rooms only."""
        with self.lock:
            if agent in self.palace_agent_ids():
                raise ProtocolError(400, f"{agent} is a palace team agent; spawn a new id")
            if home not in self.rooms:
                raise ProtocolError(400, f"unknown home room {home!r}")
            a = {"id": agent, "label": label, "team": None, "color": color, "home": home}
            self.spawned[agent] = a
            self.agents[agent] = a
            run = self.run(run_id)
            run.location[agent] = home
            ev: dict[str, Any] = {"agent": agent, "type": "spawn", "label": label, "color": color, "home": home}
            if task:
                ev["task"] = task
            if harness in ("qm", "ufo", "protocol"):
                ev["harness"] = harness
            return {"ok": True, "event": self.emit(run, ev)}

    def palace_agent_ids(self) -> set[str]:
        return {a["id"] for a in self.palace.get("agents", [])}

    def move(self, agent: str, to: str, run_id: str | None = None) -> dict:
        """Walk to a room. Moving is free (doors are open); claiming/visiting inside is what ownership guards."""
        with self.lock:
            self._agent(agent)
            if to not in self.rooms:
                raise ProtocolError(404, f"unknown room {to!r}")
            run = self.run(run_id)
            if run.location.get(agent) == to:
                return {"ok": True, "moved": False}
            run.location[agent] = to
            return {"ok": True, "moved": True, "event": self.emit(run, {"agent": agent, "type": "move", "to": to})}

    def phase(self, agent: str, phase: str, note: str | None = None, subtasks: list[dict] | None = None, run_id: str | None = None) -> dict:
        with self.lock:
            self._agent(agent)
            if phase not in ("plan", "explore", "gym", "execute", "done"):
                raise ProtocolError(400, "phase must be plan | explore | gym | execute | done")
            run = self.run(run_id)
            ev: dict[str, Any] = {"agent": agent, "type": "phase", "phase": phase}
            if note:
                ev["note"] = note
            if subtasks:
                clean = []
                for st in subtasks:
                    item: dict[str, Any] = {"id": str(st["id"]), "title": str(st["title"])}
                    if st.get("department"):
                        item["department"] = str(st["department"])
                    if st.get("stations"):
                        item["stations"] = [s for s in st["stations"] if s in self.memories]
                    clean.append(item)
                ev["subtasks"] = clean
            return {"ok": True, "event": self.emit(run, ev)}

    def artifact(self, agent: str, memory: dict, run_id: str | None = None) -> dict:
        with self.lock:
            self._agent(agent)
            need = ("id", "title", "type", "room", "pos", "freshness", "excerpt", "path")
            missing = [k for k in need if k not in memory]
            if missing:
                raise ProtocolError(400, f"artifact memory missing {missing}")
            if memory["room"] not in self.rooms:
                raise ProtocolError(400, f"unknown room {memory['room']!r}")
            run = self.run(run_id)
            m = {k: memory[k] for k in need}
            return {"ok": True, "event": self.emit(run, {"agent": agent, "type": "artifact", "memory": m})}

    def train_step(self, agent: str, step: float, reward: float, checkpoint: str | None = None, team: str | None = None, run_id: str | None = None) -> dict:
        with self.lock:
            self._agent(agent)
            run = self.run(run_id)
            ev: dict[str, Any] = {"agent": agent, "type": "train_step", "step": step, "reward": reward}
            if checkpoint:
                ev["checkpoint"] = checkpoint
            if team in ("finance", "legal", "eng", "people"):
                ev["team"] = team
            return {"ok": True, "event": self.emit(run, ev)}

    # ---- Loose Ends loop

    def _open_loose_end(self, run: Run, agent: str, memory_id: str, note: str | None, question: str | None) -> None:
        owner = self.owner_of(memory_id)
        prev = self.loose_ends.get(memory_id)
        if prev and prev["status"] == "open":
            return
        self.loose_ends[memory_id] = {
            "memoryId": memory_id,
            "title": self.memories[memory_id].get("title"),
            "team": owner,
            "foundBy": agent,
            "run": run.id,
            "note": note,
            "question": question or f"{self.memories[memory_id].get('title', memory_id)}: this page is empty or silent. What should it say?",
            "status": "open",
        }

    def list_loose_ends(self, status: str | None = None) -> list[dict]:
        with self.lock:
            return [le for le in self.loose_ends.values() if status in (None, le["status"])]

    def write_back(self, memory_id: str, content: str, by: str) -> dict:
        """A human's reply to a Loose End becomes the page. The next visit re-verifies it."""
        with self.lock:
            memory = self._memory(memory_id)
            if not content.strip():
                raise ProtocolError(400, "write-back needs content")
            path = self.brain.write_back(memory, content, by)
            if memory_id in self.loose_ends:
                self.loose_ends[memory_id]["status"] = "answered"
                self.loose_ends[memory_id]["answeredBy"] = by
            return {"ok": True, "path": str(path), "memoryId": memory_id}

    def state(self, run_id: str | None = None) -> dict:
        with self.lock:
            run = self.run(run_id)
            self._expire(run)
            return {
                "run": run.id,
                "events": len(run.events),
                "location": run.location,
                "routes": run.routes,
                "leases": {m: {"agent": l.agent, "expiresIn": round(l.expires - self.clock(), 2)} for m, l in run.leases.items()},
                "verdicts": [{"agent": a, "memoryId": m, "verdict": v[0], "note": v[1]} for (a, m), v in run.verdicts.items()],
                "handoffs": [self.handoff_status(h, run.id) for h in run.handoffs],
                "looseEnds": self.list_loose_ends(),
            }
