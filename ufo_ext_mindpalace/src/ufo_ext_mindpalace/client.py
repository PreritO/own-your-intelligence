"""HTTP client for the loci protocol service (:8790). Stdlib only, no ufo imports.

The extension never re-implements protocol rules: every tool is one call here, and refusals,
waits and blocked answers come back from the service as data the agent reads.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request

DEFAULT_URL = "http://127.0.0.1:8790"


class ProtocolClient:
    def __init__(self, base: str | None = None, run: str | None = None, timeout: float = 10.0):
        self.base = (base or os.environ.get("MP_PROTOCOL_URL") or DEFAULT_URL).rstrip("/")
        self.run = run or os.environ.get("MP_RUN") or None
        self.timeout = timeout

    def post(self, path: str, body: dict) -> dict:
        if self.run and "run" not in body:
            body = {**body, "run": self.run}
        req = urllib.request.Request(self.base + path, json.dumps(body).encode(), {"content-type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                out = json.loads(r.read())
                out.setdefault("status", r.status)
                return out
        except urllib.error.HTTPError as e:
            try:
                out = json.loads(e.read())
            except json.JSONDecodeError:
                out = {"ok": False, "error": str(e)}
            out["status"] = e.code
            return out
        except urllib.error.URLError as e:
            return {"ok": False, "status": 503, "error": f"protocol service unreachable at {self.base}: {e.reason}"}

    def get(self, path: str) -> dict | list:
        sep = "&" if "?" in path else "?"
        url = self.base + path + (f"{sep}run={self.run}" if self.run else "")
        try:
            with urllib.request.urlopen(url, timeout=self.timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            return {"ok": False, "status": e.code, "error": e.read().decode(errors="replace")}
        except urllib.error.URLError as e:
            return {"ok": False, "status": 503, "error": f"protocol service unreachable at {self.base}: {e.reason}"}

    # -- the loci tools, one call each

    def task(self, agent: str, text: str) -> dict:
        return self.post("/task", {"agent": agent, "text": text})

    def route(self, agent: str, route_id: str, stations: list[str] | None = None, source: str = "fallback") -> dict:
        body: dict = {"agent": agent, "routeId": route_id, "source": source}
        if stations:
            body["stations"] = stations
        return self.post("/route", body)

    def claim(self, agent: str, memory_id: str) -> dict:
        return self.post("/claim", {"agent": agent, "memoryId": memory_id})

    def visit(self, agent: str, memory_id: str, question: str | None = None) -> dict:
        return self.post("/visit", {"agent": agent, "memoryId": memory_id, "question": question})

    def handoff(self, agent: str, memory_id: str, question: str, to_agent: str | None = None) -> dict:
        return self.post("/handoff", {"agent": agent, "memoryId": memory_id, "question": question, "toAgent": to_agent})

    def await_reply(self, handoff_id: str, timeout: float = 30.0, poll: float = 0.5) -> dict:
        deadline = time.monotonic() + timeout
        while True:
            st = self.get(f"/handoff?id={handoff_id}")
            if not isinstance(st, dict) or st.get("answered") or st.get("ok") is False or time.monotonic() >= deadline:
                return st if isinstance(st, dict) else {"ok": False}
            time.sleep(poll)

    def inbox(self, agent: str) -> list:
        r = self.get(f"/inbox?agent={agent}")
        return r if isinstance(r, list) else []

    def reply(self, agent: str, handoff_id: str, answer: str) -> dict:
        return self.post("/reply", {"agent": agent, "id": handoff_id, "answer": answer})

    def answer(self, agent: str, text: str, citations: list[str]) -> dict:
        return self.post("/answer", {"agent": agent, "text": text, "citations": citations})

    def palace(self) -> dict:
        r = self.get("/palace")
        return r if isinstance(r, dict) else {}

    def loose_ends(self, status: str | None = None) -> list:
        r = self.get("/loose-ends" + (f"?status={status}" if status else ""))
        return r if isinstance(r, list) else []

    def write_back(self, memory_id: str, content: str, by: str) -> dict:
        return self.post("/writeback", {"memoryId": memory_id, "content": content, "by": by})
