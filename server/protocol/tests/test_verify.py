"""Real verification: the relevance judge (visit) and claim-level grounding (answer).

LLM tests replay recorded Claude responses from tests/recorded/ (offline, deterministic). The pages
live in this file, so seed-brain edits never invalidate the recordings. To re-record after changing a
prompt, a page or a question here:

    MP_JUDGE_TEST_MODE=record uv run --project server/protocol pytest server/protocol/tests/test_verify.py
"""

import json
import threading
import time
from pathlib import Path

import pytest

import judge as judge_mod
from judge import Judge, quote_on_page, validate_claims
from loci import Brain, Protocol, SimClock, assess


def _mem(id, room, freshness=0.9, title=None):
    return {"id": id, "title": title or id.split("/")[-1], "type": "page", "room": room, "pos": [0, 0, 0], "freshness": freshness, "excerpt": "", "path": f"{id}.md"}


def _room(id, owner):
    return {"id": id, "wing": owner if owner != "shared" else "people", "owner": owner, "label": id, "center": [0, 0, 0], "size": [1, 1, 1], "doors": []}


PALACE = {
    "version": 1,
    "generatedAt": "2026-09-27T00:00:00Z",
    "wings": [],
    "rooms": [_room("foyer", "shared"), _room("room-people", "shared"), _room("room-legal", "legal"), _room("room-finance", "finance"), _room("room-eng", "eng")],
    "memories": [
        _mem("legal/gripworks-msa", "room-legal", title="Gripworks MSA"),
        _mem("finance/budget-2026-q4", "room-finance", title="Q4 2026 Budget"),
        _mem("people/org-chart", "room-people", title="Org Chart"),
        _mem("eng/soc2-renewal", "room-eng", title="SOC 2 Renewal"),
        _mem("eng/soc2-owner", "room-eng", freshness=0.1, title="SOC 2 Owner"),
    ],
    "links": [],
    "agents": [
        {"id": "legal", "label": "Legal agent", "team": "legal", "color": "#bb9af7", "home": "room-legal"},
        {"id": "finance", "label": "Finance agent", "team": "finance", "color": "#e0af68", "home": "room-finance"},
        {"id": "eng", "label": "Eng agent", "team": "eng", "color": "#9ece6a", "home": "room-eng"},
    ],
    "routes": [],
}

PAGES = {
    "legal/gripworks-msa": """---
title: Gripworks MSA
---
Master services agreement draft v3. Net-45 payment, 12-month term, liability cap 1x fees. Redlines resolved Sep 20. Contract value $40k.

Counterparty: [[companies/gripworks|Gripworks]]. The $40k is funded from the Q4 supplier line in the [[finance/budget-2026-q4|Q4 2026 Budget]].

| Term | v3 |
| --- | --- |
| Payment | Net-45 |
| Term | 12 months |
| Liability cap | 1x fees |
| Value | $40k |
""",
    "finance/budget-2026-q4": """---
title: Q4 2026 Budget
---
Supplier line: $55k allocated, $15k committed. Gripworks ($40k) fits within the line. Owner: Raj Patel.

| Line | Allocated | Committed | Remaining |
| --- | --- | --- | --- |
| Suppliers | $55k | $15k | $40k |
| Cloud | $90k | $88k | $2k |
""",
    "people/org-chart": """---
title: Org Chart
---
Acme Robotics, 48 people. Teams: Finance (Raj Patel), Legal (Tomas Reyes), Eng (Priya Nand), People (Lena Vogt). CEO Mara Okafor, COO Dev Lindqvist.

| Team | Lead | Headcount |
| --- | --- | --- |
| Finance | Raj Patel | 4 |
| Legal | Tomas Reyes | 2 |
| Eng | Priya Nand | 34 |

Security and compliance has no named lead on this chart. The row was removed in January when the Halden Compliance contract ended and has not been filled.
""",
    "eng/soc2-renewal": """---
title: SOC 2 Renewal
---
SOC 2 Type II renewal window opens Nov 1. Auditor: Brightline. Evidence collection not started. Owner: see SOC 2 Owner page.

The 2026 audit period covers May through October. Controls are defined by the Security Policy.
""",
    "eng/soc2-owner": """---
title: SOC 2 Owner
---
Role page for the SOC 2 program owner. Owner: not recorded.

| Field | Value |
| --- | --- |
| Owner | (none recorded) |
""",
}

PAYMENT_Q = "What are the payment terms in the Gripworks MSA?"


def _protocol(tmp_path: Path, judge: Judge) -> Protocol:
    brain_dir = tmp_path / "seed-brain"
    for mid, text in PAGES.items():
        f = brain_dir / f"{mid}.md"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text)
    palace = tmp_path / "palace.json"
    palace.write_text(json.dumps(PALACE))
    p = Protocol(palace_path=palace, brain=Brain(brain_dir=brain_dir, overlay_dir=tmp_path / "overlay"), clock=SimClock(), runs_dir=tmp_path / "runs", judge=judge)
    p.start_run("v", log=False)
    return p


@pytest.fixture
def vp(tmp_path, recorded_judge):
    return _protocol(tmp_path, recorded_judge)


@pytest.fixture
def rules_p(tmp_path):
    return _protocol(tmp_path / "rules", Judge(mode="rules"))


def _page(mid: str) -> str:
    return PAGES[mid].split("---", 2)[2].strip()


# ---------------------------------------------------------------- relevance judge (visit)


def test_relevant_page_answers_with_exact_quote(vp):
    v = vp.visit("legal", "legal/gripworks-msa", question=PAYMENT_Q)
    assert v["judge"] == "llm" and v["support"] == "answers" and v["verdict"] == "verified"
    ev = v["event"]
    assert ev["judge"] == "llm" and ev["support"] == "answers"
    assert quote_on_page(ev["evidence"], _page("legal/gripworks-msa"))
    assert "Net-45" in ev["evidence"]


def test_irrelevant_fresh_page_is_a_gap_not_verified(vp, rules_p):
    # Before: the regex judge only sees a fresh, non-empty page -> verified.
    before = rules_p.visit("legal", "people/org-chart", question=PAYMENT_Q)
    assert before["verdict"] == "verified" and before["judge"] == "rules"
    # After: the page is fresh but says nothing about payment terms -> gap, loudly.
    v = vp.visit("legal", "people/org-chart", question=PAYMENT_Q)
    assert v["judge"] == "llm" and v["support"] == "silent"
    assert v["verdict"] == "gap" and v["note"].startswith("page doesn't say:")
    assert "evidence" not in v["event"]
    assert vp.list_loose_ends("open")[0]["memoryId"] == "people/org-chart"
    # ...and an answer citing it is blocked at the citation level already.
    r = vp.answer("legal", "Payment is Net-45.", ["people/org-chart"])
    assert r["blocked"] and any("people/org-chart: verdict is gap" in x for x in r["reasons"])


def test_rules_gap_is_final_and_stale_still_from_freshness(vp):
    # Blank owner field: the rules judge already says gap; the LLM is not asked and can't loosen it.
    v = vp.visit("eng", "eng/soc2-owner", question="Who owns the SOC 2 renewal?")
    assert v["verdict"] == "gap" and v["judge"] == "rules" and v["note"] == "no owner recorded"


# ---------------------------------------------------------------- claim-level grounding (answer)

FABRICATED = "The Gripworks MSA has Net-45 payment terms and caps liability at 2x fees."
CORRECT = "The Gripworks MSA (draft v3) has Net-45 payment terms, a 12-month term and a liability cap of 1x fees. The contract is worth $40k."


def test_fabricated_claim_is_blocked_naming_the_claim(vp, rules_p):
    # Before: citation-level grounding only checks the station was verified -> the bluff goes out.
    rules_p.visit("legal", "legal/gripworks-msa", question=PAYMENT_Q)
    before = rules_p.answer("legal", FABRICATED, ["legal/gripworks-msa"])
    assert before["blocked"] is False and before["grounding"] == "citations"

    vp.visit("legal", "legal/gripworks-msa", question=PAYMENT_Q)
    r = vp.answer("legal", FABRICATED, ["legal/gripworks-msa"])
    assert r["blocked"] is True and r["grounding"] == "claims"
    bad = [c for c in r["claims"] if c["status"] == "unsupported"]
    assert bad and any("2x" in c["text"] for c in bad)
    assert any(x.startswith("unsupported claim:") and "2x" in x for x in r["reasons"])
    good = [c for c in r["claims"] if c["status"] == "supported"]
    assert any("Net-45" in c["text"] for c in good)
    ev = vp.runs["v"].events[-1]
    assert ev["type"] == "answer" and ev["blocked"] is True and ev["claims"] == r["claims"] and ev["reasons"] == r["reasons"]
    # QM's pre-post check uses the same result.
    g = vp.grounding("legal", FABRICATED)
    assert g["verdict"] == "block" and "2x" in g["reason"]


def test_correct_answer_passes_with_every_claim_supported(vp):
    vp.visit("legal", "legal/gripworks-msa", question=PAYMENT_Q)
    r = vp.answer("legal", CORRECT, ["legal/gripworks-msa"])
    assert r["blocked"] is False and r["reasons"] == [] and r["grounding"] == "claims"
    assert len(r["claims"]) >= 3
    for c in r["claims"]:
        assert c["status"] == "supported", c
        assert c["memoryId"] == "legal/gripworks-msa"
        assert quote_on_page(c["quote"], _page("legal/gripworks-msa"))
    assert "blocked" not in vp.runs["v"].events[-1]
    assert vp.grounding("legal", CORRECT)["verdict"] == "ok"


HANDOFF_ANSWER = "Yes, we can fund Gripworks: the Q4 supplier line has $40k remaining, which covers the $40k contract."


def test_claims_supported_by_a_handoff_reply_page(vp):
    # Legal can't enter Finance; Finance verifies the budget page and replies. Legal's claims about the
    # budget are grounded in the page Finance verified in this run (not in the reply's paraphrase).
    vp.visit("legal", "legal/gripworks-msa", question=PAYMENT_Q)
    h = vp.handoff("legal", "finance/budget-2026-q4", "Is the $40k Gripworks contract within the Q4 supplier budget?")
    fv = vp.visit("finance", "finance/budget-2026-q4", question="Is the $40k Gripworks contract within the Q4 supplier budget?")
    assert fv["verdict"] == "verified" and fv["judge"] == "llm"
    vp.reply("finance", h["id"], "Yes, it fits.")
    r = vp.answer("legal", HANDOFF_ANSWER, ["legal/gripworks-msa", "finance/budget-2026-q4"])
    assert r["blocked"] is False, r["reasons"]
    assert any(c["memoryId"] == "finance/budget-2026-q4" for c in r["claims"] if c["status"] == "supported")


GAP_ANSWER = "The SOC 2 Type II renewal window opens Nov 1 with Brightline as auditor. Gap: no SOC 2 owner is recorded."


def test_stated_gap_is_a_gap_claim_not_a_block(vp):
    vp.visit("eng", "eng/soc2-renewal", question="Who owns the SOC 2 renewal, and when does it start?")
    vp.visit("eng", "eng/soc2-owner", question="Who owns the SOC 2 renewal?")
    r = vp.answer("eng", GAP_ANSWER, ["eng/soc2-renewal"])
    assert r["blocked"] is False, r["reasons"]
    statuses = {c["status"] for c in r["claims"]}
    assert "gap" in statuses and "unsupported" not in statuses
    assert any(c["status"] == "gap" and c.get("memoryId") == "eng/soc2-owner" for c in r["claims"])


def test_grounding_rechecks_a_different_message(vp):
    # The answer passed, but the harness tries to post a different text: it gets the same claim check.
    vp.visit("legal", "legal/gripworks-msa", question=PAYMENT_Q)
    assert not vp.answer("legal", CORRECT, ["legal/gripworks-msa"])["blocked"]
    g = vp.grounding("legal", FABRICATED)
    assert g["verdict"] == "block" and "2x" in g["reason"]


# ---------------------------------------------------------------- offline behaviour (no network, fake transports)


def test_quote_not_on_page_downgrades_to_partial_and_rules(tmp_path):
    fake = lambda *a: {"evidence": "Payment is due in 30 days.", "support": "answers", "missing": "", "contradiction": ""}  # noqa: E731
    p = _protocol(tmp_path, Judge(mode="auto", cache_dir=tmp_path / "c", transport=fake))
    v = p.visit("legal", "legal/gripworks-msa", question=PAYMENT_Q)
    assert v["support"] == "partial" and v["judge"] == "rules" and v["verdict"] == "verified"
    assert "quote not on the page" in v["note"]
    assert v["evidence"] != "Payment is due in 30 days."


def test_contradicts_is_verified_with_a_note(tmp_path):
    fake = lambda *a: {"evidence": "Net-45 payment", "support": "contradicts", "missing": "", "contradiction": "page says Net-45, not Net-30"}  # noqa: E731
    p = _protocol(tmp_path, Judge(mode="auto", cache_dir=tmp_path / "c", transport=fake))
    v = p.visit("legal", "legal/gripworks-msa", question="Is the Gripworks MSA on Net-30?")
    assert v["verdict"] == "verified" and v["support"] == "contradicts" and "Net-30" in v["note"]
    assert v["evidence"] == "Net-45 payment"


def test_silent_beats_stale(tmp_path):
    fake = lambda *a: {"evidence": "", "support": "silent", "missing": "who signs", "contradiction": ""}  # noqa: E731
    pal = json.loads(json.dumps(PALACE))
    pal["memories"][0]["freshness"] = 0.1
    p = _protocol(tmp_path, Judge(mode="auto", cache_dir=tmp_path / "c", transport=fake))
    p.palace_path.write_text(json.dumps(pal))
    p.start_run("s", log=False)
    v = p.visit("legal", "legal/gripworks-msa", "s", question="Who signs?")
    assert v["verdict"] == "gap" and v["note"].startswith("page doesn't say: who signs") and "freshness" in v["note"]


def test_timeout_falls_back_to_rules_then_cache_fills(tmp_path):
    done = threading.Event()

    def slow(*a):
        time.sleep(0.3)
        done.set()
        return {"evidence": "Net-45 payment", "support": "answers", "missing": "", "contradiction": ""}

    j = Judge(mode="auto", cache_dir=tmp_path / "c", transport=slow, judge_timeout=0.05)
    p = _protocol(tmp_path, j)
    v = p.visit("legal", "legal/gripworks-msa", question=PAYMENT_Q)
    assert v["judge"] == "rules" and v["verdict"] == "verified" and v.get("support") is None
    assert done.wait(2)
    time.sleep(0.05)
    p.start_run("again", log=False)
    v2 = p.visit("legal", "legal/gripworks-msa", "again", question=PAYMENT_Q)
    assert v2["judge"] == "llm" and v2["support"] == "answers"


def test_no_key_is_rules_and_citation_grounding(tmp_path, monkeypatch):
    monkeypatch.setattr(judge_mod, "load_api_key", lambda: None)
    j = Judge(mode="auto", cache_dir=tmp_path / "c")
    assert not j.live
    p = _protocol(tmp_path, j)
    v = p.visit("legal", "legal/gripworks-msa", question=PAYMENT_Q)
    assert v["judge"] == "rules"
    r = p.answer("legal", FABRICATED, ["legal/gripworks-msa"])
    assert r["grounding"] == "citations" and r["claims"] is None and "claims" not in r["event"]


def test_cache_mode_never_calls_the_network(tmp_path):
    def boom(*a):
        raise AssertionError("network in cache mode")

    p = _protocol(tmp_path, Judge(mode="cache", cache_dir=tmp_path / "empty", transport=boom))
    assert p.visit("legal", "legal/gripworks-msa", question=PAYMENT_Q)["judge"] == "rules"


def test_validate_claims_rehomes_and_rejects():
    sources = {
        "a": {"title": "A", "body": "Net-45 payment, 12-month term.", "verdict": "verified"},
        "b": {"title": "B", "body": "Liability cap 1x fees.", "verdict": "verified"},
        "s": {"title": "S", "body": "Owner is Dana.", "verdict": "stale"},
    }
    out = validate_claims(
        [
            {"text": "Cap is 1x fees", "status": "supported", "memoryId": "a", "quote": "Liability cap 1x fees", "reason": ""},  # wrong page: re-homed to b
            {"text": "Owner is Dana", "status": "supported", "memoryId": "s", "quote": "Owner is Dana.", "reason": ""},  # stale page
            {"text": "Net-30", "status": "supported", "memoryId": "a", "quote": "Net-30 payment", "reason": ""},  # invented quote
            {"text": "No auditor recorded", "status": "gap", "memoryId": "zzz", "quote": "", "reason": ""},  # gap about an unwalked page
            {"text": "Term is a year", "status": "supported", "memoryId": "a", "quote": "Net-45 payment ... 12-month term", "reason": ""},  # elided quote
        ],
        sources,
    )
    st = [(c["status"], c.get("memoryId")) for c in out["claims"]]
    assert st == [("supported", "b"), ("unsupported", "s"), ("unsupported", "a"), ("unsupported", None), ("supported", "a")]
    assert "stale" in out["reasons"]["Owner is Dana"]
    assert out["unsupported"] == ["Owner is Dana", "Net-30", "No auditor recorded"]


def test_quote_on_page_normalises_markdown():
    body = "Counterparty: [[companies/gripworks|Gripworks]]. **Net-45** payment\n| Payment | Net-45 |"
    assert quote_on_page("Counterparty: Gripworks.", body)
    assert quote_on_page("Net-45 payment", body)
    assert quote_on_page("Payment | Net-45", body)
    assert not quote_on_page("Net-30 payment", body)
    assert not quote_on_page("ok", body)


def test_assess_without_question_is_rules_only(tmp_path):
    def boom(*a):
        raise AssertionError("no question, no LLM")

    a = assess({"body": "Some fresh text about things.", "freshness": 0.9}, "x", "X", None, Judge(mode="auto", cache_dir=tmp_path, transport=boom))
    assert a == {"verdict": "verified", "note": None, "judge": "rules"}
