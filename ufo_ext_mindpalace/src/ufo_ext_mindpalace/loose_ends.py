"""Loose End loop: gap -> post to the owning team's channel -> human reply writes the page back ->
the owning station re-verifies. No ufo imports, so it runs standalone too:

    python -m ufo_ext_mindpalace.loose_ends --watch            # post new gaps as they appear
    python -m ufo_ext_mindpalace.loose_ends --resolve eng/soc2-owner "Priya Nair owns the SOC 2 renewal."

Posting: if MP_SLACK_WEBHOOK_<TEAM> (e.g. MP_SLACK_WEBHOOK_ENG) is set, the question goes to that
Slack incoming webhook; otherwise it is appended to MP_CHANNEL_DIR/<team>.log (default
server/protocol/runs/channels/) and printed. Inside UFO the same questions are also readable by the
`loose_ends` tool and answered by `loose_end_resolve`.
"""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.request
from pathlib import Path

from ufo_ext_mindpalace.client import ProtocolClient

REPO = Path(__file__).resolve().parents[3]
CHANNEL_DIR = Path(os.environ.get("MP_CHANNEL_DIR", REPO / "server" / "protocol" / "runs" / "channels"))


def format_post(le: dict) -> str:
    return (
        f":warning: Loose End for #{le['team']}: *{le.get('title') or le['memoryId']}* ({le['memoryId']}) came up "
        f"{le.get('note') or 'empty'} while the {le.get('foundBy')} agent worked on: \"{le.get('question')}\". "
        f"Reply with the answer and it is written back to GBrain."
    )


def post(le: dict) -> str:
    text = format_post(le)
    hook = os.environ.get(f"MP_SLACK_WEBHOOK_{le['team'].upper()}")
    if hook:
        req = urllib.request.Request(hook, json.dumps({"text": text}).encode(), {"content-type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=10).read()
        return f"slack:{le['team']}"
    CHANNEL_DIR.mkdir(parents=True, exist_ok=True)
    with (CHANNEL_DIR / f"{le['team']}.log").open("a", encoding="utf8") as f:
        f.write(json.dumps({"ts": time.time(), "memoryId": le["memoryId"], "text": text}) + "\n")
    print(f"[#{le['team']}] {text}", flush=True)
    return f"file:{CHANNEL_DIR / (le['team'] + '.log')}"


def poll_once(c: ProtocolClient, posted: set[str]) -> list[dict]:
    """Post every open Loose End not yet posted. Returns the ones posted this call."""
    out = []
    for le in c.loose_ends("open"):
        key = f"{le['memoryId']}@{le.get('run')}"
        if key in posted:
            continue
        le["postedTo"] = post(le)
        posted.add(key)
        out.append(le)
    return out


def resolve(c: ProtocolClient, memory_id: str, content: str, by: str = "human") -> dict:
    """Human reply -> page write-back -> the owning team's agent re-visits the station."""
    wb = c.write_back(memory_id, content, by)
    if not wb.get("ok"):
        return wb
    palace = c.palace()
    room_of = {m["id"]: m["room"] for m in palace.get("memories", [])}
    owner = next((r["owner"] for r in palace.get("rooms", []) if r["id"] == room_of.get(memory_id)), "shared")
    agent = next((a["id"] for a in palace.get("agents", []) if a["team"] == owner), None) or "eng"
    v = c.visit(agent, memory_id, "re-verify after Loose End write-back")
    return {"ok": v.get("verdict") == "verified", "writeBack": wb, "reverifiedBy": agent, "verdict": v.get("verdict"), "note": v.get("note")}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=None)
    ap.add_argument("--watch", action="store_true")
    ap.add_argument("--interval", type=float, default=2.0)
    ap.add_argument("--resolve", nargs=2, metavar=("MEMORY_ID", "CONTENT"))
    ap.add_argument("--by", default="human")
    args = ap.parse_args()
    c = ProtocolClient(args.url)
    if args.resolve:
        print(json.dumps(resolve(c, args.resolve[0], args.resolve[1], args.by), indent=2))
        return
    posted: set[str] = set()
    while True:
        poll_once(c, posted)
        if not args.watch:
            return
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
