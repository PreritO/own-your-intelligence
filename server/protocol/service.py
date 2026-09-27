"""Loci protocol service: HTTP on :8790 over `loci.Protocol`. Stdlib only.

    uv run --project server/protocol python server/protocol/service.py [--port 8790]

POST (JSON body; every body may carry "run", default = current run):
  /run        {run?}                                  start a fresh run -> {run}
  /task       {agent, text}
  /route      {agent, routeId, stations?, source?}    stations default to palace.json routes
  /claim      {agent, memoryId, ttl?}                 -> {ok} | {wait, heldBy} | 403 refused
  /visit      {agent, memoryId, question?}            -> {verdict, note, content, ...} | wait | 403 refused
  /handoff    {agent, memoryId, question, toAgent?}   -> {id, toAgent}
  /reply      {agent, id, answer}
  /answer     {agent, text, citations}                -> {blocked, reasons, gaps, stale}
  /writeback  {memoryId, content, by}                 Loose End answered by a human -> page overlay
GET:
  /events?run=&replay=1   SSE, `data: <PalaceEvent>\\n\\n` (replays the run's events first)
  /events.jsonl?run=      the run's events as JSONL
  /inbox?agent=           open handoffs addressed to agent
  /handoff?id=            handoff status (answered, answer, verdict)
  /loose-ends?status=     gaps waiting on a human
  /state  /health  /palace
"""

from __future__ import annotations

import argparse
import json
import queue
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from loci import Protocol, ProtocolError  # noqa: E402

PORT = 8790


def make_handler(proto: Protocol):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):  # quiet
            pass

        def _cors(self):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "content-type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

        def _json(self, status: int, body) -> None:
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self._cors()
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self):
            url = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(url.query).items()}
            run = q.get("run")
            try:
                if url.path == "/health":
                    return self._json(200, {"ok": True, "run": proto.current, "palace": str(proto.palace_path)})
                if url.path == "/palace":
                    return self._json(200, proto.palace)
                if url.path == "/state":
                    return self._json(200, proto.state(run))
                if url.path == "/inbox":
                    return self._json(200, proto.inbox(q["agent"], run))
                if url.path == "/handoff":
                    return self._json(200, proto.handoff_status(q["id"], run))
                if url.path == "/loose-ends":
                    return self._json(200, proto.list_loose_ends(q.get("status")))
                if url.path == "/events.jsonl":
                    r = proto.run(run)
                    data = "".join(json.dumps(e) + "\n" for e in r.events).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/x-ndjson")
                    self.send_header("Content-Length", str(len(data)))
                    self._cors()
                    self.end_headers()
                    self.wfile.write(data)
                    return
                if url.path == "/events":
                    return self._sse(run, q.get("replay", "1") != "0")
                return self._json(404, {"ok": False, "error": f"no route {url.path}"})
            except KeyError as e:
                return self._json(400, {"ok": False, "error": f"missing query param {e}"})
            except ProtocolError as e:
                return self._json(e.status, e.payload)

        def _sse(self, run_filter: str | None, replay: bool) -> None:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self._cors()
            self.end_headers()
            q: queue.Queue = queue.Queue()

            def listener(ev):
                if run_filter is None or ev.get("run") == run_filter:
                    q.put(ev)

            with proto.lock:
                backlog = []
                if replay and proto.current:
                    r = proto.runs.get(run_filter or proto.current)
                    backlog = list(r.events) if r else []
                proto.listeners.append(listener)
            try:
                for ev in backlog:
                    self.wfile.write(f"data: {json.dumps(ev)}\n\n".encode())
                self.wfile.flush()
                while True:
                    try:
                        ev = q.get(timeout=15)
                        self.wfile.write(f"data: {json.dumps(ev)}\n\n".encode())
                    except queue.Empty:
                        self.wfile.write(b": keep-alive\n\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                with proto.lock:
                    if listener in proto.listeners:
                        proto.listeners.remove(listener)

        def do_POST(self):
            url = urlparse(self.path)
            try:
                n = int(self.headers.get("Content-Length") or 0)
                b = json.loads(self.rfile.read(n) or b"{}") if n else {}
            except json.JSONDecodeError:
                return self._json(400, {"ok": False, "error": "body must be JSON"})
            run = b.get("run")
            try:
                p = url.path
                if p == "/run":
                    r = proto.start_run(b.get("run"))
                    return self._json(200, {"ok": True, "run": r.id})
                if p == "/task":
                    return self._json(200, proto.task(b["agent"], b["text"], run))
                if p == "/route":
                    return self._json(200, proto.route(b["agent"], b.get("routeId", "explore"), b.get("stations"), b.get("source", "fallback"), run))
                if p == "/claim":
                    return self._json(200, proto.claim(b["agent"], b["memoryId"], run, b.get("ttl")))
                if p == "/visit":
                    return self._json(200, proto.visit(b["agent"], b["memoryId"], run, b.get("question")))
                if p == "/handoff":
                    return self._json(200, proto.handoff(b["agent"], b["memoryId"], b["question"], b.get("toAgent"), run))
                if p == "/reply":
                    return self._json(200, proto.reply(b["agent"], b["id"], b["answer"], run))
                if p == "/answer":
                    res = proto.answer(b["agent"], b["text"], list(b.get("citations") or []), run)
                    return self._json(200, res)
                if p == "/writeback":
                    return self._json(200, proto.write_back(b["memoryId"], b["content"], b.get("by", "human")))
                return self._json(404, {"ok": False, "error": f"no route {p}"})
            except KeyError as e:
                return self._json(400, {"ok": False, "error": f"missing field {e}"})
            except ProtocolError as e:
                return self._json(e.status, e.payload)

    return Handler


def serve(proto: Protocol, port: int = PORT, host: str = "127.0.0.1") -> ThreadingHTTPServer:
    httpd = ThreadingHTTPServer((host, port), make_handler(proto))
    httpd.daemon_threads = True
    return httpd


def serve_in_thread(proto: Protocol, port: int = 0) -> tuple[ThreadingHTTPServer, str]:
    httpd = serve(proto, port)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"


def main() -> None:
    ap = argparse.ArgumentParser(description="Loci protocol service")
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--palace", default=None)
    args = ap.parse_args()
    proto = Protocol(palace_path=args.palace)
    httpd = serve(proto, args.port, args.host)
    print(f"loci protocol service on http://{args.host}:{args.port} (palace {proto.palace_path})", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
