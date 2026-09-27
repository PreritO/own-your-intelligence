"""The extension's logic against a real in-process protocol service (no UFO needed)."""

import threading
import time
from pathlib import Path

import pytest

from loci import REPO, Brain, Protocol
from service import serve_in_thread
from ufo_ext_mindpalace import loose_ends, tools
from ufo_ext_mindpalace.client import ProtocolClient
from ufo_ext_mindpalace.walker import next_action, run_walker


@pytest.fixture
def svc(tmp_path: Path):
    proto = Protocol(palace_path=REPO / "fixtures" / "palace.json", brain=Brain(overlay_dir=tmp_path / "overlay"), runs_dir=tmp_path / "runs")
    proto.start_run("t")
    httpd, base = serve_in_thread(proto)
    yield proto, ProtocolClient(base, run="t")
    httpd.shutdown()


def test_agent_name_maps_to_team():
    assert tools.palace_agent("mindpalace-legal") == "legal"
    assert tools.palace_agent("finance") == "finance"
    assert tools.palace_agent("eng-bot") == "eng"


def test_pick_route_matches_demo_tasks(svc):
    _, c = svc
    p = c.palace()
    assert tools.pick_route(p, "Can we sign the Gripworks contract this week?")["id"] == "contract-signoff"
    assert tools.pick_route(p, "Who owns the SOC 2 renewal?")["id"] == "soc2-owner"
    assert tools.pick_route(p, "What did we promise Ada in the last board meeting?")["id"] == "board-promises"


def test_gbrain_scope_is_per_team(svc):
    _, c = svc
    s = tools.gbrain_stations(c, "legal")
    assert all(r["owner"] in ("legal", "shared") for r in s["readable"])
    assert any(r["memoryId"] == "finance/budget-2026-q4" for r in s["askOwner"])


def test_contract_signoff_route_with_handoff(svc):
    proto, c = svc
    out = {}
    t = threading.Thread(target=lambda: out.update(legal=run_walker(c, "legal", "Can we sign the Gripworks contract this week?")))
    t.start()
    for _ in range(100):  # wait for legal's handoff to land in finance's inbox
        if c.inbox("finance"):
            break
        time.sleep(0.05)
    fin_text, _ = run_walker(c, "finance", "What did we promise Ada in the last board meeting?")
    t.join(20)
    text, hist = out["legal"]
    ans = [e for e in proto.runs["t"].events if e["type"] == "answer" and e["agent"] == "legal"][-1]
    assert "blocked" not in ans, text
    assert ans["citations"] == ["companies/gripworks", "legal/gripworks-msa", "finance/budget-2026-q4", "legal/approvals", "people/signatories"]
    types = [e["type"] for e in proto.runs["t"].events]
    assert "handoff" in types and "reply" in types


def test_soc2_gap_loose_end_loop(svc, tmp_path, monkeypatch):
    proto, c = svc
    monkeypatch.setattr(loose_ends, "CHANNEL_DIR", tmp_path / "channels")
    text, _ = run_walker(c, "eng", "Who owns the SOC 2 renewal?")
    assert text.startswith("Gap: SOC 2 Owner")
    posted = loose_ends.poll_once(c, set())
    assert [le["memoryId"] for le in posted] == ["eng/soc2-owner"]
    assert "eng/soc2-owner" in (tmp_path / "channels" / "eng.log").read_text()
    r = loose_ends.resolve(c, "eng/soc2-owner", "Priya Nair (Eng) owns the SOC 2 renewal as of Sep 27.", "human:eng-lead")
    assert r["ok"] and r["verdict"] == "verified" and r["reverifiedBy"] == "eng"
    assert proto.runs["t"].events[-1]["verdict"] == "verified"


def test_walker_never_cites_unverified():
    h = [
        {"name": "loci_route", "input": {"task": "x"}, "result": {"ok": True, "stations": ["a", "b"]}},
        {"name": "loci_claim", "input": {"memoryId": "a"}, "result": {"ok": True}},
        {"name": "loci_visit", "input": {"memoryId": "a"}, "result": {"ok": True, "verdict": "stale", "content": "old"}},
        {"name": "loci_claim", "input": {"memoryId": "b"}, "result": {"ok": True}},
        {"name": "loci_visit", "input": {"memoryId": "b"}, "result": {"ok": True, "verdict": "gap", "note": "page is empty", "content": ""}},
    ]
    act = next_action("x", h)
    assert act["tool"] == "loci_answer" and act["input"]["citations"] == []
