import json
import urllib.error
import urllib.request

import pytest

from conftest import types
from loci import ProtocolError
from service import serve_in_thread


# ---- ownership refusal


def test_ownership_refusal_on_visit(proto):
    with pytest.raises(ProtocolError) as e:
        proto.visit("legal", "finance/budget-2026-q4")
    assert e.value.status == 403
    assert e.value.payload["refused"] is True
    assert e.value.payload["owner"] == "finance"
    assert e.value.payload["handoffTo"] == "finance"
    # The agent walked to the door but never claimed or visited.
    assert types(proto) == ["move"]
    assert proto.runs["test"].verdicts == {}


def test_ownership_refusal_on_claim_and_shared_rooms_open(proto):
    with pytest.raises(ProtocolError):
        proto.claim("eng", "legal/gripworks-msa")
    # People room is shared: every team may read it.
    for agent in ("legal", "finance", "eng"):
        assert proto.visit(agent, "people/org-chart")["verdict"] == "verified"


def test_handoff_must_go_to_owner_and_reply_must_be_grounded(proto):
    with pytest.raises(ProtocolError) as e:
        proto.handoff("legal", "finance/budget-2026-q4", "Within budget?", to_agent="eng")
    assert e.value.status == 403
    h = proto.handoff("legal", "finance/budget-2026-q4", "Is Gripworks within Q4 budget?")
    assert h["toAgent"] == "finance"
    assert proto.inbox("finance")[0]["id"] == h["id"]
    with pytest.raises(ProtocolError) as e:
        proto.reply("finance", h["id"], "yes")  # hasn't visited yet
    assert e.value.status == 409
    proto.visit("finance", "finance/budget-2026-q4")
    assert proto.reply("finance", h["id"], "Yes, $40k of $55k.")["verdict"] == "verified"
    assert proto.inbox("finance") == []


# ---- claims


def test_claim_wait_then_reuse(proto, clock):
    assert proto.claim("eng", "people/org-chart")["ok"]
    w = proto.claim("finance", "people/org-chart")
    assert w == {"ok": False, "wait": True, "heldBy": "eng", "expiresIn": 30.0}
    # Visiting while someone else holds the lease also waits.
    assert proto.visit("finance", "people/org-chart")["wait"] is True
    ev = [e for e in proto.runs["test"].events if e["type"] == "wait"]
    assert ev and ev[0]["heldBy"] == "eng" and ev[0]["memoryId"] == "people/org-chart"
    clock.advance(1)
    assert proto.visit("eng", "people/org-chart")["verdict"] == "verified"  # releases the lease
    v = proto.visit("finance", "people/org-chart")
    assert v["verdict"] == "verified" and "reused eng" in v["note"]


def test_claim_lease_expires(proto, clock):
    proto.claim("eng", "people/org-chart", ttl=5)
    assert proto.claim("legal", "people/org-chart")["wait"]
    clock.advance(6)
    assert proto.claim("legal", "people/org-chart")["ok"]


# ---- verdicts


def test_gap_verdict_on_empty_page(proto):
    v = proto.visit("eng", "eng/soc2-owner")
    assert v["verdict"] == "gap"
    assert v["note"] == "page is empty"
    ends = proto.list_loose_ends("open")
    assert ends[0]["memoryId"] == "eng/soc2-owner" and ends[0]["team"] == "eng"


def test_gap_verdict_on_silent_seed_page(proto, tmp_path):
    page = tmp_path / "seed-brain" / "eng" / "soc2-owner.md"
    page.parent.mkdir(parents=True)
    page.write_text("---\ntitle: SOC 2 owner\n---\n# SOC 2 owner\n\nNo owner recorded.\n")
    v = proto.visit("eng", "eng/soc2-owner")
    assert v["verdict"] == "gap" and "silent" in v["note"]


def test_stale_verdict_and_unknown_page(proto):
    assert proto.visit("eng", "eng/security-policy")["verdict"] == "stale"
    with pytest.raises(ProtocolError) as e:
        proto.visit("eng", "eng/does-not-exist")
    assert e.value.status == 404


def test_loose_end_writeback_reverifies(proto):
    assert proto.visit("eng", "eng/soc2-owner")["verdict"] == "gap"
    proto.write_back("eng/soc2-owner", "Priya Nair (Eng) owns the SOC 2 renewal.", by="human:eng-lead")
    assert proto.list_loose_ends()[0]["status"] == "answered"
    proto.start_run("next")
    v = proto.visit("eng", "eng/soc2-owner")
    assert v["verdict"] == "verified" and v["source"] == "overlay"
    assert proto.list_loose_ends()[0]["status"] == "verified"


# ---- grounding


def test_blocked_ungrounded_answer(proto):
    proto.visit("legal", "companies/gripworks")
    r = proto.answer("legal", "We can sign.", ["companies/gripworks", "legal/gripworks-msa"])
    assert r["blocked"] is True
    assert any("legal/gripworks-msa: not visited" in x for x in r["reasons"])
    ev = proto.runs["test"].events[-1]
    assert ev["type"] == "answer" and ev["blocked"] is True


def test_blocked_answer_citing_stale_or_gap(proto):
    proto.visit("eng", "eng/security-policy")
    proto.visit("eng", "eng/soc2-owner")
    r = proto.answer("eng", "Owner is X.", ["eng/soc2-owner"])
    assert r["blocked"] and r["gaps"] == ["eng/soc2-owner"] and r["stale"] == ["eng/security-policy"]


def test_blocked_answer_before_route_finished(proto):
    proto.route("legal", "contract-signoff")
    proto.visit("legal", "companies/gripworks")
    r = proto.answer("legal", "Yes.", ["companies/gripworks"])
    assert r["blocked"] and any("route not finished" in x for x in r["reasons"])


def test_grounded_answer_via_handoff(proto):
    proto.route("legal", "contract-signoff")
    proto.visit("legal", "companies/gripworks")
    proto.visit("legal", "legal/gripworks-msa")
    h = proto.handoff("legal", "finance/budget-2026-q4", "Within Q4 budget?")
    proto.visit("finance", "finance/budget-2026-q4")
    proto.reply("finance", h["id"], "Yes.")
    r = proto.answer("legal", "Yes, sign.", ["legal/gripworks-msa", "finance/budget-2026-q4"])
    assert r["blocked"] is False and r["reasons"] == []
    assert "blocked" not in proto.runs["test"].events[-1]


def test_events_are_monotonic_and_logged(proto, clock, tmp_path):
    proto.task("eng", "Who owns SOC 2?")
    clock.advance(0.5)
    proto.visit("eng", "eng/soc2-owner")
    ts = [e["t"] for e in proto.runs["test"].events]
    assert ts == sorted(ts)
    lines = (tmp_path / "runs" / "test.jsonl").read_text().splitlines()
    assert [json.loads(l)["type"] for l in lines] == types(proto)


# ---- HTTP


def _post(base, path, body):
    req = urllib.request.Request(base + path, data=json.dumps(body).encode(), headers={"content-type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test_http_roundtrip_and_sse(proto):
    httpd, base = serve_in_thread(proto)
    try:
        assert _post(base, "/visit", {"agent": "legal", "memoryId": "finance/budget-2026-q4"})[0] == 403
        s, r = _post(base, "/visit", {"agent": "eng", "memoryId": "eng/soc2-owner"})
        assert s == 200 and r["verdict"] == "gap"
        s, r = _post(base, "/answer", {"agent": "eng", "text": "x", "citations": ["people/org-chart"]})
        assert s == 200 and r["blocked"]
        with urllib.request.urlopen(base + "/events") as resp:
            assert resp.headers["Content-Type"] == "text/event-stream"
            assert resp.headers["Access-Control-Allow-Origin"] == "*"
            got = []
            while len(got) < 4:
                line = resp.readline().decode()
                if line.startswith("data: "):
                    got.append(json.loads(line[6:]))
        assert [e["type"] for e in got] == ["move", "claim", "visit", "answer"]
        assert got[2]["verdict"] == "gap"
    finally:
        httpd.shutdown()


# ---- grounding (QM fork pre-post check) + dispatch (bridge)


def test_grounding_verdicts(proto):
    assert proto.grounding("eng", "anything")["verdict"] == "block"  # never answered
    proto.visit("eng", "eng/security-policy")
    proto.visit("eng", "eng/soc2-owner")
    proto.visit("eng", "people/org-chart")
    proto.answer("eng", "Org chart lists no compliance owner.", ["people/org-chart"])
    g = proto.grounding("eng", "Org chart lists no compliance owner.")
    assert g["verdict"] == "annotate" and "eng/soc2-owner" in g["text"] and "eng/security-policy" in g["text"]
    proto.answer("eng", "Owner is Bob.", ["eng/soc2-owner"])
    g = proto.grounding("eng", "Owner is Bob.")
    assert g["verdict"] == "block" and "not verified" in g["reason"]
    proto.visit("legal", "legal/gripworks-msa")
    proto.answer("legal", "MSA is v3.", ["legal/gripworks-msa"])
    assert proto.grounding("legal", "MSA is v3.")["verdict"] == "ok"


def test_http_dispatch_runs_demo_tasks(tmp_path):
    import time as _t

    from loci import REPO, Brain, Protocol

    p = Protocol(palace_path=REPO / "fixtures" / "palace.json", brain=Brain(overlay_dir=tmp_path / "o"), runs_dir=tmp_path / "runs")
    httpd, base = serve_in_thread(p)
    try:
        s, r = _post(base, "/dispatch", {"tick": 0.0})
        assert s == 200 and r["run"]
        for _ in range(200):
            if sum(1 for e in p.runs[r["run"]].events if e["type"] == "answer") == 3:
                break
            _t.sleep(0.05)
        evs = p.runs[r["run"]].events
        kinds = [e["type"] for e in evs]
        assert kinds.count("answer") == 3 and "handoff" in kinds and "wait" in kinds
        assert not any(e.get("blocked") for e in evs if e["type"] == "answer")
        assert any(e["type"] == "visit" and e["verdict"] == "gap" for e in evs)
        s, g = _post(base, "/grounding", {"agent": "legal", "run": r["run"]})
        assert g["verdict"] == "ok"
        # Bridge shape: tasks with picked routes {routeId, stations, source}.
        s, r2 = _post(base, "/run", {"tasks": [{"agent": "eng", "text": "Who owns the SOC 2 renewal?", "route": {"routeId": "learned-soc2", "stations": ["eng/soc2-renewal", "eng/soc2-owner"], "source": "learned"}}], "tick": 0.0})
        assert s == 200 and r2["run"] != r["run"]
        for _ in range(200):
            if any(e["type"] == "answer" for e in p.runs[r2["run"]].events):
                break
            _t.sleep(0.05)
        route = [e for e in p.runs[r2["run"]].events if e["type"] == "route"][0]
        assert route["source"] == "learned" and route["stations"] == ["eng/soc2-renewal", "eng/soc2-owner"]
    finally:
        httpd.shutdown()
