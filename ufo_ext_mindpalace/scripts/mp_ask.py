"""Send one message to a UFO channel over the ufo surface and stream the turn (no Rust client needed).
    .venv/bin/python mp_ask.py <channel> <model> "<message>"
"""
import sys
import urllib.request
from pathlib import Path

channel, model, message = sys.argv[1], sys.argv[2], sys.argv[3]
token = (Path.home() / ".ufoctl" / "token").read_text().strip()
req = urllib.request.Request(
    f"http://localhost:8710/surface/ufo/{channel}",
    data=message.encode(),
    headers={"authorization": f"Bearer {token}", "x-ufo-model": model, "content-type": "text/plain"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=600) as r:
        print("HTTP", r.status, r.headers.get("content-type"), flush=True)
        for line in r:
            sys.stdout.write(line.decode("utf-8", "replace"))
            sys.stdout.flush()
except urllib.error.HTTPError as e:
    print("HTTP", e.code, e.read().decode("utf-8", "replace")[:2000])
