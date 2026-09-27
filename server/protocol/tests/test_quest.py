import pytest

from loci import ProtocolError, best_snippet


def test_spawned_quest_agent_shared_only_and_handoff(proto):
    proto.start_run("q", log=False)
    proto.spawn("quest-1", "Onboarding agent", "#ff7eb6", "foyer", task="Onboard engineers", harness="protocol", run_id="q")
    # survives a palace reload (start_run reloads palace.json)
    proto.start_run("q2", log=False)
    assert "quest-1" in proto.agents
    v = proto.visit("quest-1", "companies/gripworks", "q2", question="Who is Gripworks?", subtask="s1")
    assert v["verdict"] == "verified" and v["event"]["subtask"] == "s1" and v["event"]["evidence"]
    with pytest.raises(ProtocolError) as e:
        proto.visit("quest-1", "legal/gripworks-msa", "q2")
    assert e.value.status == 403 and e.value.payload["handoffTo"] == "legal"
    h = proto.handoff("quest-1", "legal/gripworks-msa", "What are the payment terms?", run_id="q2")
    proto.visit("legal", "legal/gripworks-msa", "q2")
    proto.reply("legal", h["id"], "Net-45.", "q2")
    a = proto.answer("quest-1", "Done", ["companies/gripworks", "legal/gripworks-msa"], "q2")
    assert not a["blocked"]
    assert not proto.move("quest-1", "room-legal-0", "q2")["moved"]  # the refusal already walked it to the door
    assert proto.move("quest-1", "room-people-0", "q2")["moved"]
    proto.phase("quest-1", "plan", subtasks=[{"id": "s1", "title": "x", "stations": ["companies/gripworks", "nope"]}], run_id="q2")
    assert proto.runs["q2"].events[-1]["subtasks"][0]["stations"] == ["companies/gripworks"]
    proto.train_step("quest-1", 1, 0.5, "sim", run_id="q2")
    assert proto.runs["q2"].events[-1]["checkpoint"] == "sim"
    with pytest.raises(ProtocolError):
        proto.spawn("legal", "x", "#000000")


def test_gap_visit_has_no_evidence(proto):
    proto.start_run("g", log=False)
    v = proto.visit("eng", "eng/soc2-owner", "g")
    assert v["verdict"] == "gap" and "evidence" not in v["event"]


def test_best_snippet_picks_matching_sentence():
    body = "# Title\n\nAcme makes arms. New hires get a laptop on day one. Payroll runs monthly."
    assert best_snippet(body, "what laptop do new hires get") == "New hires get a laptop on day one."
