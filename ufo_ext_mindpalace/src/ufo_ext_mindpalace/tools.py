"""The loci tools as plain functions: (palace agent id, args) -> JSON-able dict. No ufo imports.

`manifest.py` wraps each in a UFO ToolDef; tests and the scripted walker call them directly.
Each is a translation to one protocol-service call (plus the per-team GBrain scope, which is a
read-only view of palace.json filtered to the rooms the team may enter).
"""

from __future__ import annotations

import os
import re

from ufo_ext_mindpalace.client import ProtocolClient

TOOL_NAMES = (
    "loci_route",
    "loci_claim",
    "loci_visit",
    "loci_handoff",
    "loci_await_reply",
    "loci_inbox",
    "loci_reply",
    "loci_answer",
    "gbrain_stations",
    "loose_ends",
    "loose_end_resolve",
)

PALACE_AGENTS = ("legal", "finance", "eng")


def palace_agent(ufo_agent_name: str | None) -> str:
    """Map a UFO agent name to its palace agent (the team scope). `mindpalace-legal` -> `legal`."""
    name = (ufo_agent_name or "").lower()
    mapping = dict(p.split("=", 1) for p in os.environ.get("MP_AGENT_MAP", "").split(",") if "=" in p)
    if name in mapping:
        return mapping[name]
    for a in PALACE_AGENTS:
        if name == a or name.endswith("-" + a) or name.startswith(a + "-"):
            return a
    return os.environ.get("MP_DEFAULT_AGENT", "legal")


def _words(s: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", s.lower()) if len(w) > 2}


def pick_route(palace: dict, task: str) -> dict | None:
    """Fallback route choice: best word overlap between the task and a route's label + station slugs.
    (Learned routes come from Memorable via server/routes.ts; this is only the fallback.)"""
    best, score = None, 0
    tw = _words(task)
    for r in palace.get("routes", []):
        rw = _words(r["label"] + " " + r["id"] + " " + " ".join(r["stations"]))
        s = len(tw & rw)
        if s > score:
            best, score = r, s
    return best


def loci_route(c: ProtocolClient, agent: str, task: str, route_id: str | None = None) -> dict:
    c.task(agent, task)
    if not route_id:
        r = pick_route(c.palace(), task)
        if r is None:
            return {"ok": False, "error": "no route matches this task; name one with routeId"}
        route_id = r["id"]
    return c.route(agent, route_id, source="fallback")


def loci_claim(c: ProtocolClient, agent: str, memory_id: str) -> dict:
    return c.claim(agent, memory_id)


def loci_visit(c: ProtocolClient, agent: str, memory_id: str, question: str | None = None) -> dict:
    r = c.visit(agent, memory_id, question)
    if r.get("refused"):
        r["next"] = f"You may not enter this room. Call loci_handoff(memoryId={memory_id!r}, question=...) to ask {r.get('handoffTo')}."
    elif r.get("wait"):
        r["next"] = f"{r.get('heldBy')} holds this station. Retry loci_visit shortly, or continue and come back."
    elif r.get("verdict") == "gap":
        r["next"] = "State this gap in your answer. Never fill it in."
    return r


def loci_handoff(c: ProtocolClient, agent: str, memory_id: str, question: str, to_agent: str | None = None) -> dict:
    return c.handoff(agent, memory_id, question, to_agent)


def loci_await_reply(c: ProtocolClient, agent: str, handoff_id: str, timeout: float = 30.0) -> dict:
    return c.await_reply(handoff_id, timeout=timeout)


def loci_inbox(c: ProtocolClient, agent: str) -> dict:
    return {"ok": True, "handoffs": c.inbox(agent)}


def loci_reply(c: ProtocolClient, agent: str, handoff_id: str, answer: str) -> dict:
    return c.reply(agent, handoff_id, answer)


def loci_answer(c: ProtocolClient, agent: str, text: str, citations: list[str]) -> dict:
    return c.answer(agent, text, citations)


def gbrain_stations(c: ProtocolClient, agent: str) -> dict:
    """GBrain connector, scoped per team: the pages this team may read directly (own + shared rooms)
    and the ones it must ask the owner about. Page bodies are only read through loci_visit."""
    palace = c.palace()
    team = next((a["team"] for a in palace.get("agents", []) if a["id"] == agent), agent)
    rooms = {r["id"]: r for r in palace.get("rooms", [])}
    mine, others = [], []
    for m in palace.get("memories", []):
        owner = rooms.get(m["room"], {}).get("owner", "shared")
        row = {"memoryId": m["id"], "title": m["title"], "room": m["room"], "owner": owner}
        (mine if owner in ("shared", team) else others).append(row)
    return {"ok": True, "agent": agent, "team": team, "readable": mine, "askOwner": others}


def loose_ends(c: ProtocolClient, agent: str, status: str | None = "open") -> dict:
    return {"ok": True, "looseEnds": c.loose_ends(status)}


def loose_end_resolve(c: ProtocolClient, agent: str, memory_id: str, content: str, by: str = "human") -> dict:
    """A human's answer to a Loose End: write the page back, then the owning agent re-verifies it."""
    from ufo_ext_mindpalace.loose_ends import resolve

    return resolve(c, memory_id, content, by)


_ARG = {"memoryId": "memory_id", "handoffId": "handoff_id", "toAgent": "to_agent", "routeId": "route_id"}
DISPATCH = {name: globals()[name] for name in TOOL_NAMES}


def call(c: ProtocolClient, agent: str, name: str, args: dict) -> dict:
    """Run one loci tool by its wire name with camelCase args (as a model would send them)."""
    kwargs = {_ARG.get(k, k): v for k, v in args.items() if v is not None}
    return DISPATCH[name](c, agent, **kwargs)
