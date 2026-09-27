import json
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from conftest import PALACE, SOC2

import loose_ends
from gbrain import GBrain, apply_answer
from loci import Brain, Protocol, SimClock, judge, strip_frontmatter
from service import serve_in_thread

ANSWER = "Dana Whitfield (Head of Platform)"


def _post(base, path, body):
    req = urllib.request.Request(base + path, json.dumps(body).encode(), {"content-type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def _get(base, path):
    with urllib.request.urlopen(base + path) as r:
        return json.loads(r.read())


def events(proto, kind=None):
    return [e for e in proto.runs[proto.current].events if kind in (None, e["type"])]


# ---------------------------------------------------------------- page patching (pure)


def test_patch_fills_the_blank_owner_field_on_the_real_soc2_page():
    assert judge({"body": strip_frontmatter(SOC2)[1], "freshness": 1.0})[0] == "gap"
    p = apply_answer(SOC2, ANSWER, day="2026-09-27", by="human:eng-lead", question="Who owns the SOC 2 renewal?", judge=judge)
    meta, body = strip_frontmatter(p.text)
    assert p.strategy == "field" and "2 places" in p.change
    assert meta["updated"] == "2026-09-27" and meta["title"] == "SOC 2 Owner"
    assert f"Owner: {ANSWER}." in body and f"| Owner | {ANSWER} |" in body
    assert "| Backup | (none recorded) |" in body  # only the field the gap was about
    assert body.index("## Answers") < body.index("## Links")  # links stay the last section
    assert "- role_for: [[eng/soc2-renewal]]" in body and "- listed_in: [[people/org-chart]]" in body
    assert "answered by human:eng-lead via Loose Ends; question: Who owns the SOC 2 renewal?" in body
    assert judge({"body": body, "freshness": 1.0})[0] == "verified"


def test_patch_appends_to_a_stale_page_and_strips_wikilinks():
    page = "---\ntitle: Security Policy\nupdated: 2026-03-02\n---\nPolicy, last reviewed March.\n\n## Links\n- governs: [[eng/soc2-owner]]\n"
    p = apply_answer(page, "Re-reviewed; see [[eng/soc2-owner|SOC 2 Owner]] for the owner.", day="2026-09-27", by="ops", judge=judge)
    assert p.strategy == "append"
    assert "[[eng/soc2-owner|" not in p.text.split("## Links")[0]  # fixtures require body wikilinks under ## Links
    assert "Re-reviewed; see SOC 2 Owner for the owner." in p.text and "updated: 2026-09-27" in p.text


def test_patch_empty_and_silent_pages():
    assert apply_answer("", "The DPA owner is Sales ops.", day="2026-09-27", by="h", title="DPA", judge=judge).text.startswith("---\ntitle: DPA\nupdated: 2026-09-27\n---\nThe DPA owner is Sales ops.")
    silent = "---\ntitle: Escalation\nupdated: 2026-02-01\n---\nNo escalation owner is on record.\n\nTiers are listed below in detail.\n"
    p = apply_answer(silent, "Tier 3 escalations go to the on-call SRE lead.", day="2026-09-27", by="h", judge=judge)
    assert p.strategy == "lead" and strip_frontmatter(p.text)[1].startswith("Tier 3 escalations")
    with pytest.raises(ValueError):
        apply_answer(silent, "   ", day="2026-09-27", by="h")


# ---------------------------------------------------------------- inbox


def test_gap_and_stale_become_items_with_team_question_and_asker(world):
    p, inbox = world["proto"], world["inbox"]
    p.task("eng", "Who owns the SOC 2 renewal?")
    assert p.visit("eng", "eng/security-policy")["verdict"] == "stale"
    assert p.visit("eng", "eng/soc2-owner")["verdict"] == "gap"
    items = {i["memoryId"]: i for i in inbox.list()}
    gap, stale = items["eng/soc2-owner"], items["eng/security-policy"]
    assert gap["status"] == "open" and gap["team"] == "eng" and gap["teamLabel"] == "Eng" and gap["verdict"] == "gap"
    assert gap["question"] == "Who owns the SOC 2 renewal?" and gap["askedBy"] == {"agent": "eng", "label": "Eng agent"}
    assert gap["run"] == "r1" and gap["at"] and gap["note"] == "no owner recorded"
    assert stale["verdict"] == "stale" and stale["question"] == "Who owns the SOC 2 renewal?"
    # Routed to the owning team: no webhook -> the team's outbox file.
    log = (world["tmp"] / "outbox" / "eng.log").read_text()
    assert "[open] Loose End for Eng: \"Who owns the SOC 2 renewal?\"" in log and "eng/soc2-owner" in log
    assert gap["notified"]["channel"] == "outbox"
    # Persisted: a restarted service keeps the inbox.
    saved = json.loads((world["tmp"] / "state" / "inbox.json").read_text())
    assert {i["memoryId"] for i in saved["items"]} == {"eng/soc2-owner", "eng/security-policy"}


def test_quest_handoff_is_who_asked(world):
    p, inbox = world["proto"], world["inbox"]
    p.spawn("quest-2", "Answer agent", "#2ac3de", task="Answer Northwind Logistics' security questionnaire")
    p.phase("quest-2", "plan", subtasks=[{"id": "s1", "title": "Pull the Northwind DPA details", "department": "sales"}])
    p.handoff("quest-2", "sales/northwind-dpa-request", "Who owns the Northwind DPA request?", "sales")
    (world["brain_dir"] / "sales").mkdir()
    (world["brain_dir"] / "sales" / "northwind-dpa-request.md").write_text("---\ntitle: Northwind DPA Request\nupdated: 2026-09-20\n---\nDPA request from Northwind. Owner: not recorded.\n")
    assert p.visit("sales", "sales/northwind-dpa-request", subtask="s1")["verdict"] == "gap"
    it = inbox.get("sales/northwind-dpa-request")
    assert it["team"] == "sales" and it["question"] == "Who owns the Northwind DPA request?" and it["questionSource"] == "handoff"
    assert it["askedBy"] == {"agent": "quest-2", "label": "Answer agent", "quest": "Answer Northwind Logistics' security questionnaire"}
    assert it["foundBy"] == "sales"


# ---------------------------------------------------------------- resolve -> page, gbrain, event, re-verify


def test_resolve_writes_the_page_puts_to_isolated_gbrain_and_reverifies(world):
    p, inbox, calls = world["proto"], world["inbox"], world["calls"]
    p.task("eng", "Who owns the SOC 2 renewal?")
    assert p.visit("eng", "eng/soc2-owner")["verdict"] == "gap"
    httpd, base = serve_in_thread(p)
    try:
        assert [i["memoryId"] for i in _get(base, "/loose-ends?status=open")] == ["eng/soc2-owner"]
        s, r = _post(base, "/loose-ends/eng/soc2-owner/resolve", {"text": ANSWER, "by": "human:eng-lead"})
        assert s == 200 and r["ok"], r
        # 1. the real page file (here a tmp copy of fixtures/seed-brain) was rewritten
        page = (world["brain_dir"] / "eng" / "soc2-owner.md").read_text()
        meta, body = strip_frontmatter(page)
        assert meta["updated"] == "2026-09-27" and f"Owner: {ANSWER}." in body
        assert r["write"]["strategy"] == "field" and r["write"]["path"].endswith("eng/soc2-owner.md")
        # 2. gbrain put ran against the ISOLATED home, with the page on stdin and no DATABASE_URL
        put = [json.loads(l) for l in calls.read_text().splitlines()]
        assert put[0]["argv"] == ["put", "eng/soc2-owner"] and put[0]["stdin"] == page
        assert put[0]["GBRAIN_HOME"] == str(world["tmp"] / "gbrain-home") and put[0]["db_env"] == []
        assert put[1]["argv"] == ["get", "eng/soc2-owner"] and r["gbrain"]["status"] == "put" and r["gbrain"]["readBack"] is True
        # 3. owner notified honestly: outbox, and the event says so
        assert r["notify"]["channel"] == "outbox" and "[resolved] Resolved for Eng" in (world["tmp"] / "outbox" / "eng.log").read_text()
        res = events(p, "resolved")
        assert res == [{**res[0], "agent": "eng", "type": "resolved", "memoryId": "eng/soc2-owner", "by": "human:eng-lead", "text": ANSWER, "channel": "outbox"}]
        # 4. the owning agent re-checks right away: the page comes back verified (freshness from updated:)
        visits = events(p, "visit")
        assert visits[-1]["memoryId"] == "eng/soc2-owner" and visits[-1]["verdict"] == "verified" and visits[-1]["agent"] == "eng"
        assert r["recheck"]["verdict"] == "verified"
        assert visits[-1]["evidence"] == f"Role page for the SOC 2 program owner. Owner: {ANSWER}."  # quotes the page, not the log
        item =_get(base, "/loose-ends/eng/soc2-owner")
        assert item["status"] == "resolved" and item["verified"] is True and item["answer"] == ANSWER and item["channel"] == "outbox"
        # 5. and so does any later visit, in a fresh run
        p.start_run("r2")
        v = p.visit("eng", "eng/soc2-owner")
        assert v["verdict"] == "verified" and v["source"] == "seed-brain" and ANSWER in v["content"]
        # resolving twice is refused; unknown ids are 404
        assert _post(base, "/loose-ends/eng/soc2-owner/resolve", {"text": "x"})[0] == 409
        assert _post(base, "/loose-ends/people/org-chart/resolve", {"text": "x"})[0] == 404
        assert _post(base, "/loose-ends/eng/security-policy/resolve", {"text": ""})[0] in (400, 404)
    finally:
        httpd.shutdown()


def test_resolving_a_stale_page_makes_it_fresh(world):
    p, inbox = world["proto"], world["inbox"]
    assert p.visit("eng", "eng/security-policy")["verdict"] == "stale"
    r = inbox.resolve("eng/security-policy", "Re-reviewed Sep 27: all controls still hold.", by="human:ciso")
    assert r["write"]["strategy"] == "append" and r["recheck"]["verdict"] == "verified"
    assert p.brain.read(p.memories["eng/security-policy"])["freshness"] == 1.0
    assert p.brain.read(p.memories["eng/soc2-owner"])["freshness"] == 0.11  # untouched pages keep palace freshness


def test_resolve_removes_a_legacy_overlay_that_would_shadow_the_page(world):
    p, inbox = world["proto"], world["inbox"]
    p.visit("eng", "eng/soc2-owner")
    p.write_back("eng/soc2-owner", "Owner: not recorded", by="old-path")  # legacy overlay that would shadow the page
    r = inbox.resolve("eng/soc2-owner", ANSWER, by="human")
    assert r["write"]["overlayRemoved"] and r["recheck"]["verdict"] == "verified"


def test_slack_webhook_is_used_when_configured(world):
    got = []

    class Hook(BaseHTTPRequestHandler):
        def do_POST(self):
            got.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            self.send_response(200)
            self.end_headers()

        def log_message(self, *a):
            pass

    srv = ThreadingHTTPServer(("127.0.0.1", 0), Hook)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        inbox, p = world["inbox"], world["proto"]
        inbox.webhook = f"http://127.0.0.1:{srv.server_address[1]}/hook"
        p.task("eng", "Who owns the SOC 2 renewal?")
        p.visit("eng", "eng/soc2-owner")
        r = inbox.resolve("eng/soc2-owner", ANSWER, by="human")
        assert r["notify"] == {"channel": "slack", "ok": True} and events(p, "resolved")[0]["channel"] == "slack"
        texts = [g["text"] for g in got]
        assert any("Resolved for Eng" in t and "Who owns the SOC 2 renewal?" in t for t in texts)
        # A dead webhook falls back to the outbox and says why.
        inbox.webhook = "http://127.0.0.1:9/nope"
        res = inbox.deliver("eng", "hello", "open")
        assert res["channel"] == "outbox" and "slackError" in res
    finally:
        srv.shutdown()


def test_gbrain_never_touches_the_personal_brain(tmp_path):
    assert GBrain(home=Path.home()).unavailable().startswith("refusing")
    missing = GBrain(home=tmp_path, bin="gbrain").put("eng/soc2-owner", "x")
    assert missing["status"] == "skipped"


def test_protocol_without_inbox_keeps_legacy_routes(tmp_path):
    palace = tmp_path / "palace.json"
    palace.write_text(json.dumps(PALACE))
    p = Protocol(palace_path=palace, brain=Brain(brain_dir=tmp_path / "b", overlay_dir=tmp_path / "o"), clock=SimClock(), runs_dir=tmp_path / "runs")
    assert loose_ends.route(p, "GET", "/loose-ends", {}, None) is None


def test_reset_clears_inbox_but_refuses_git_reset_on_a_tmp_brain(world):
    p, inbox = world["proto"], world["inbox"]
    p.visit("eng", "eng/soc2-owner")
    assert loose_ends.route(p, "POST", "/loose-ends/reset", {}, {"brain": True})[0] == 400
    s, r = loose_ends.route(p, "POST", "/loose-ends/reset", {}, {})
    assert s == 200 and r["cleared"] == 1 and inbox.list() == []
