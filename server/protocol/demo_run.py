"""Scripted, harness-free driver: walks the 3 demo tasks through the protocol service over HTTP.

    uv run --project server/protocol python server/protocol/demo_run.py            # in-process service, sim clock
    uv run --project server/protocol python server/protocol/demo_run.py --url http://localhost:8790 --tick 0.3

Writes the run's events to fixtures/replays/protocol-run.jsonl (override with --out), which must
pass `bun run validate`. No LLM: every agent follows the loci protocol literally. The rules are
still enforced by the service, not here: refusals, waits and grounding come back from HTTP.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable, Iterator

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from loci import REPO, Brain, Protocol, SimClock  # noqa: E402
from service import serve_in_thread  # noqa: E402

TASKS = [
    # (agent, task text, route id) — the three demo tasks from docs/SPEC.md → Demo script.
    ("legal", "Can we sign the Gripworks contract this week?", "contract-signoff"),
    ("finance", "What did we promise Ada in the last board meeting?", "board-promises"),
    ("eng", "Who owns the SOC 2 renewal?", "soc2-owner"),
]
QUESTIONS = {"finance/budget-2026-q4": "Is the Gripworks contract within the Q4 budget?"}


class Client:
    def __init__(self, base: str, run: str | None = None):
        self.base, self.run = base.rstrip("/"), run

    def post(self, path: str, body: dict) -> tuple[int, dict]:
        if self.run:
            body = {**body, "run": self.run}
        req = urllib.request.Request(self.base + path, json.dumps(body).encode(), {"content-type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def get(self, path: str, raw: bool = False):
        sep = "&" if "?" in path else "?"
        url = self.base + path + (f"{sep}run={self.run}" if self.run else "")
        with urllib.request.urlopen(url, timeout=10) as r:
            data = r.read().decode()
            return data if raw else json.loads(data)


def first_sentence(text: str, limit: int = 160) -> str:
    text = re.sub(r"^#.*$", "", text, flags=re.M)
    text = re.sub(r"\[\[([^\]|]+)\|?([^\]]*)\]\]", lambda m: m.group(2) or m.group(1), text)
    text = re.sub(r"[*_`>]", "", text)
    text = " ".join(text.split())
    m = re.match(r"(.+?[.!?])(\s|$)", text)
    s = m.group(1) if m else text
    return s if len(s) <= limit else s[: limit - 1].rstrip() + "…"


class Agent:
    def __init__(self, c: Client, agent: str, task: str, route: str | dict, world: dict):
        self.c, self.id, self.task, self.world = c, agent, task, world
        # route: a palace route id, or a picked route {routeId, stations, source} (server/routes.ts)
        self.route = {"routeId": route, "source": "fallback"} if isinstance(route, str) else dict(route)
        self.found: dict[str, dict] = {}  # memoryId -> {verdict, text}
        self.done = False

    def serve_inbox(self) -> Iterator[None]:
        """Answer handoffs addressed to me: walk to the station, verify it, reply."""
        for h in self.c.get(f"/inbox?agent={self.id}"):
            mid = h["memoryId"]
            while True:
                s, r = self.c.post("/claim", {"agent": self.id, "memoryId": mid})
                if r.get("wait"):
                    yield
                    continue
                break
            yield
            s, v = self.c.post("/visit", {"agent": self.id, "memoryId": mid, "question": h["question"]})
            yield
            if v.get("verdict") == "verified":
                ans = first_sentence(v["content"])
            else:
                ans = f"{v.get('verdict', 'gap')}: {v.get('note') or 'page is silent'}"
            self.c.post("/reply", {"agent": self.id, "id": h["id"], "answer": ans})
            yield

    def run(self) -> Iterator[None]:
        self.c.post("/task", {"agent": self.id, "text": self.task})
        yield
        body = {"agent": self.id, "routeId": self.route.get("routeId", "explore"), "source": self.route.get("source", "fallback")}
        if self.route.get("stations"):
            body["stations"] = self.route["stations"]
        s, r = self.c.post("/route", body)
        if s != 200 and body.get("stations") and body["routeId"] in self.world["routes"]:
            s, r = self.c.post("/route", {**body, "stations": None, "source": "fallback"})
        stations = r.get("stations") or []
        yield
        for mid in stations:
            yield from self.serve_inbox()
            while True:
                s, r = self.c.post("/claim", {"agent": self.id, "memoryId": mid})
                if s == 403 and r.get("refused"):
                    yield  # stopped at the door
                    q = QUESTIONS.get(mid) or f"{self.task} What does {mid} say?"
                    s, h = self.c.post("/handoff", {"agent": self.id, "memoryId": mid, "question": q, "toAgent": r["handoffTo"]})
                    yield
                    for _ in range(80):
                        st = self.c.get(f"/handoff?id={h['id']}")
                        if st["answered"]:
                            break
                        yield from self.serve_inbox()
                        yield
                    if st["answered"]:
                        self.found[mid] = {"verdict": st["verdict"], "text": st["answer"]}
                    break
                if r.get("wait"):
                    yield
                    continue
                if not r.get("ok"):
                    break  # unknown station etc.: no verdict, never cited
                yield  # reading the page
                s, v = self.c.post("/visit", {"agent": self.id, "memoryId": mid, "question": self.task})
                if v.get("wait"):
                    yield
                    continue
                if not v.get("verdict"):
                    break
                self.found[mid] = {"verdict": v["verdict"], "text": first_sentence(v["content"]) if v["verdict"] != "gap" else v.get("note") or "gap"}
                break
            yield
        yield from self.serve_inbox()
        cites = [m for m in stations if self.found.get(m, {}).get("verdict") == "verified"]
        gaps = [m for m in stations if self.found.get(m, {}).get("verdict") == "gap"]
        stale = [m for m in stations if self.found.get(m, {}).get("verdict") == "stale"]
        parts = []
        for m in gaps:
            parts.append(f"Gap: {self.world['titles'].get(m, m)} ({self.found[m]['text']}).")
        parts += [self.found[m]["text"] for m in cites[-3:]]
        for m in stale:
            parts.append(f"Stale: {self.world['titles'].get(m, m)} may be out of date.")
        self.c.post("/answer", {"agent": self.id, "text": " ".join(parts), "citations": cites})
        self.done = True
        yield
        # Keep serving handoffs until everyone has answered.
        while not self.world["all_done"]():
            yield from self.serve_inbox()
            yield


def drive(c: Client, advance: Callable[[float], None], palace: dict, order: list[str], tasks: list[dict] | None = None, max_ticks: int = 600) -> None:
    """tasks: [{agent, text, route?}] (route = palace route id or {routeId, stations, source}); default TASKS."""
    routes = {r["id"] for r in palace.get("routes", [])}
    agents = {a["id"] for a in palace.get("agents", [])}
    world: dict = {"titles": {m["id"]: m["title"] for m in palace["memories"]}, "routes": routes}
    if tasks is None:
        tasks = [{"agent": a, "text": text, "route": rid} for a, text, rid in TASKS if rid in routes]
    default_route = {a: rid for a, _, rid in TASKS}
    walkers = []
    for t in tasks:
        route = t.get("route") or default_route.get(t["agent"])
        if t.get("agent") in agents and route:
            walkers.append(Agent(c, t["agent"], t["text"], route, world))
    if not walkers:
        raise SystemExit("palace.json has none of the demo routes/agents")
    world["all_done"] = lambda: all(w.done for w in walkers)
    walkers.sort(key=lambda w: order.index(w.id) if w.id in order else 99)
    gens = {w.id: w.run() for w in walkers}
    for _ in range(max_ticks):
        if not gens:
            return
        for w in walkers:
            g = gens.get(w.id)
            if g is None:
                continue
            try:
                next(g)
            except StopIteration:
                del gens[w.id]
            advance(0.12)
        advance(0.2)
    raise SystemExit(f"demo did not finish in {max_ticks} ticks")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=os.environ.get("PROTOCOL_URL"), help="drive a running service (real time) instead of an in-process one (sim clock); env PROTOCOL_URL")
    ap.add_argument("--tick", type=float, default=0.25, help="real seconds per step with --url")
    ap.add_argument("--out", default=None, help="default: fixtures/replays/protocol-run.jsonl (sim); not written with --url (the service logs runs)")
    ap.add_argument("--palace", default=None)
    ap.add_argument("--run", default="protocol-run")
    ap.add_argument("--order", default="eng,finance,legal", help="agent step order within a tick")
    args = ap.parse_args()

    if args.url:
        c = Client(args.url)
        s, r = c.post("/run", {"run": None if os.environ.get("PROTOCOL_URL") == args.url else args.run})
        c.run = r["run"]
        palace = c.get("/palace")
        scale = args.tick / 0.12
        advance = lambda dt: time.sleep(dt * scale)  # noqa: E731
        httpd = None
    else:
        clock = SimClock()
        overlay = Path(tempfile.mkdtemp(prefix="mp-overlay-"))  # never pick up earlier write-backs
        proto = Protocol(palace_path=args.palace, brain=Brain(overlay_dir=overlay), clock=clock, runs_dir=HERE / "runs")
        httpd, base = serve_in_thread(proto)
        c = Client(base)
        s, r = c.post("/run", {"run": args.run})
        c.run = r["run"]
        palace = proto.palace
        advance = clock.advance

    try:
        drive(c, advance, palace, args.order.split(","))
        jsonl = c.get("/events.jsonl", raw=True)
    finally:
        if httpd:
            httpd.shutdown()
    if args.out is None and args.url:
        print(f"run {c.run} done; the service logged it under server/protocol/runs/")
        return
    out = Path(args.out or REPO / "fixtures" / "replays" / "protocol-run.jsonl")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(jsonl, "utf8")
    evs = [json.loads(l) for l in jsonl.splitlines() if l]
    counts: dict[str, int] = {}
    for e in evs:
        counts[e["type"]] = counts.get(e["type"], 0) + 1
    print(f"wrote {len(evs)} events to {out}: {counts}")
    for e in evs:
        if e["type"] in ("visit", "wait", "handoff", "reply", "answer") and (e["type"] != "visit" or e["verdict"] != "verified"):
            print("  ", json.dumps({k: v for k, v in e.items() if k != "run"}))


if __name__ == "__main__":
    main()
