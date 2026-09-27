"""The scripted loci walker: a deterministic policy over the tool transcript. No ufo imports.

It is what the `mindpalace-walker` UFO model provider runs (a stand-in for a Gym-trained River
specialist, and a way to run a real UFO turn with no model key): given the task and the tool calls
and results so far, return the next tool call or the final text. It follows the loci protocol
literally; the protocol service still enforces it.

    history = [{"name": "loci_route", "input": {...}, "result": {...}}, ...]
    next_action(task, history) -> {"tool": name, "input": {...}} | {"text": "..."}
"""

from __future__ import annotations

import re

QUESTIONS = {"finance/budget-2026-q4": "Is the Gripworks contract within the Q4 budget?"}
MAX_WAITS = 20
MAX_REPLY_POLLS = 4


def first_sentence(text: str, limit: int = 160) -> str:
    text = re.sub(r"^#.*$", "", text or "", flags=re.M)
    text = re.sub(r"\[\[([^\]|]+)\|?([^\]]*)\]\]", lambda m: m.group(2) or m.group(1), text)
    text = " ".join(re.sub(r"[*_`>]", "", text).split())
    m = re.match(r"(.+?[.!?])(\s|$)", text)
    s = m.group(1) if m else text
    return s if len(s) <= limit else s[: limit - 1].rstrip() + "…"


def _for(history: list[dict], name: str, memory_id: str | None = None) -> list[dict]:
    return [h for h in history if h["name"] == name and (memory_id is None or h["input"].get("memoryId") == memory_id)]


def station_state(history: list[dict], mid: str) -> tuple[str, dict | None]:
    """-> (state, info). state: todo | claim-wait | claimed | visit-wait | handoff | awaiting | done | unanswered"""
    visits = _for(history, "loci_visit", mid)
    for v in visits:
        if v["result"].get("verdict"):
            r = v["result"]
            return "done", {"verdict": r["verdict"], "text": first_sentence(r.get("content", "")) if r["verdict"] != "gap" else (r.get("note") or "gap")}
    refused = any(h["result"].get("refused") for h in _for(history, "loci_claim", mid) + visits)
    if refused:
        hs = [h for h in _for(history, "loci_handoff", mid) if h["result"].get("id")]
        if not hs:
            return "handoff", None
        hid = hs[-1]["result"]["id"]
        polls = [h for h in history if h["name"] == "loci_await_reply" and h["input"].get("handoffId") == hid]
        for p in polls:
            if p["result"].get("answered"):
                return "done", {"verdict": p["result"].get("verdict") or "verified", "text": p["result"].get("answer", ""), "via": hid}
        if len(polls) >= MAX_REPLY_POLLS:
            return "unanswered", {"handoffId": hid}
        return "awaiting", {"handoffId": hid}
    claims = _for(history, "loci_claim", mid)
    if len(visits) >= MAX_WAITS:
        return "unanswered", None
    if not claims:
        return "todo", None
    if claims[-1]["result"].get("wait") and len(claims) < MAX_WAITS:
        return "claim-wait", None
    if visits and visits[-1]["result"].get("wait") and len(visits) < MAX_WAITS:
        return "visit-wait", None
    return "claimed", None


def next_action(task: str, history: list[dict], titles: dict[str, str] | None = None) -> dict:
    titles = titles or {}
    routes = _for(history, "loci_route")
    if not routes:
        return {"tool": "loci_route", "input": {"task": task}}
    route = routes[-1]["result"]
    stations = route.get("stations")
    if not stations:
        return {"text": f"Could not pick a route: {route.get('error', 'unknown error')}"}

    found: dict[str, dict] = {}
    for mid in stations:
        state, info = station_state(history, mid)
        if state == "todo" or state == "claim-wait":
            return {"tool": "loci_claim", "input": {"memoryId": mid}}
        if state in ("claimed", "visit-wait"):
            return {"tool": "loci_visit", "input": {"memoryId": mid, "question": task}}
        if state == "handoff":
            q = QUESTIONS.get(mid) or f"{task} What does {titles.get(mid, mid)} say?"
            return {"tool": "loci_handoff", "input": {"memoryId": mid, "question": q}}
        if state == "awaiting":
            return {"tool": "loci_await_reply", "input": {"handoffId": info["handoffId"]}}
        found[mid] = {"verdict": "unverified", "text": "no verdict"} if state == "unanswered" else info

    answers = _for(history, "loci_answer")
    if not answers:
        cites = [m for m in stations if found[m]["verdict"] == "verified"]
        parts = [f"Gap: {titles.get(m, m)} ({found[m]['text']})." for m in stations if found[m]["verdict"] == "gap"]
        parts += [found[m]["text"] for m in cites[-3:] if found[m]["text"]]
        parts += [f"Stale: {titles.get(m, m)} may be out of date." for m in stations if found[m]["verdict"] == "stale"]
        return {"tool": "loci_answer", "input": {"text": " ".join(parts), "citations": cites}}

    # Serve handoffs addressed to me before ending the turn.
    inboxes = _for(history, "loci_inbox")
    if not inboxes:
        return {"tool": "loci_inbox", "input": {}}
    for h in inboxes[-1]["result"].get("handoffs", []):
        if any(r["input"].get("handoffId") == h["id"] for r in _for(history, "loci_reply")):
            continue
        mid = h["memoryId"]
        visits = [v for v in _for(history, "loci_visit", mid) if v["result"].get("verdict")]
        if not visits:
            if not [c for c in _for(history, "loci_claim", mid) if history.index(c) > history.index(inboxes[-1])]:
                return {"tool": "loci_claim", "input": {"memoryId": mid}}
            return {"tool": "loci_visit", "input": {"memoryId": mid, "question": h["question"]}}
        r = visits[-1]["result"]
        ans = first_sentence(r.get("content", "")) if r["verdict"] == "verified" else f"{r['verdict']}: {r.get('note')}"
        return {"tool": "loci_reply", "input": {"handoffId": h["id"], "answer": ans}}

    a = answers[-1]["result"]
    if a.get("blocked"):
        return {"text": "Answer blocked by the protocol service: " + "; ".join(a.get("reasons", []))}
    text = answers[-1]["input"]["text"]
    cites = ", ".join(answers[-1]["input"]["citations"])
    return {"text": f"{text}\n\nCited stations: {cites}."}


def run_walker(client, agent: str, task: str, max_steps: int = 120) -> tuple[str, list[dict]]:
    """Drive the policy against the protocol service directly (what a UFO turn does, minus UFO)."""
    from ufo_ext_mindpalace import tools

    titles = {m["id"]: m["title"] for m in client.palace().get("memories", [])}
    history: list[dict] = []
    for _ in range(max_steps):
        act = next_action(task, history, titles)
        if "text" in act:
            return act["text"], history
        result = tools.call(client, agent, act["tool"], act["input"])
        history.append({"name": act["tool"], "input": act["input"], "result": result})
    return "walker did not finish", history


if __name__ == "__main__":
    import sys

    from ufo_ext_mindpalace.client import ProtocolClient

    text, hist = run_walker(ProtocolClient(), sys.argv[1], sys.argv[2])
    for h in hist:
        print(h["name"], h["input"], {k: v for k, v in h["result"].items() if k in ("ok", "verdict", "note", "refused", "wait", "blocked", "id", "answered")})
    print(text)
