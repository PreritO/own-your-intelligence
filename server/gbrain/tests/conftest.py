"""Run: uv run --project server/protocol pytest server/gbrain/tests -q"""

import json
import stat
import sys
import textwrap
from pathlib import Path

import pytest

SERVER = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(SERVER / "protocol"))
sys.path.insert(0, str(SERVER))

from loci import Brain, Protocol, SimClock  # noqa: E402

REPO = SERVER.parent
SOC2 = (REPO / "fixtures" / "seed-brain" / "eng" / "soc2-owner.md").read_text("utf8")


def mem(id, room, freshness=0.8, excerpt="Some content."):
    return {"id": id, "title": id.split("/")[-1].replace("-", " ").title(), "type": "page", "room": room, "pos": [0, 0, 0], "freshness": freshness, "excerpt": excerpt, "path": f"{id}.md"}


PALACE = {
    "version": 1,
    "generatedAt": "2026-09-27T00:00:00Z",
    "wings": [
        {"id": "people", "label": "People", "color": "#7aa2f7", "owner": "shared", "origin": [0, 0, 0], "rooms": ["room-people-0"]},
        {"id": "eng", "label": "Eng", "color": "#9ece6a", "owner": "eng", "origin": [0, 0, 0], "rooms": ["room-eng-0"]},
        {"id": "sales", "label": "Sales", "color": "#2ac3de", "owner": "sales", "origin": [0, 0, 0], "rooms": ["room-sales-0"]},
    ],
    "rooms": [
        {"id": "foyer", "wing": "foyer", "owner": "shared", "label": "Foyer", "center": [0, 0, 0], "size": [1, 1, 1], "doors": []},
        {"id": "room-people-0", "wing": "people", "owner": "shared", "label": "People", "center": [0, 0, 0], "size": [1, 1, 1], "doors": []},
        {"id": "room-eng-0", "wing": "eng", "owner": "eng", "label": "Security", "center": [0, 0, 0], "size": [1, 1, 1], "doors": []},
        {"id": "room-sales-0", "wing": "sales", "owner": "sales", "label": "Deals", "center": [0, 0, 0], "size": [1, 1, 1], "doors": []},
    ],
    "memories": [
        mem("eng/soc2-owner", "room-eng-0", freshness=0.11),
        mem("eng/security-policy", "room-eng-0", freshness=0.0),
        mem("people/org-chart", "room-people-0"),
        mem("sales/northwind-dpa-request", "room-sales-0", freshness=0.9),
    ],
    "links": [],
    "agents": [
        {"id": "eng", "label": "Eng agent", "team": "eng", "color": "#9ece6a", "home": "room-eng-0"},
        {"id": "sales", "label": "Sales agent", "team": "sales", "color": "#2ac3de", "home": "room-sales-0"},
    ],
    "routes": [],
}

FAKE_GBRAIN = textwrap.dedent(
    """\
    #!/usr/bin/env python3
    # Stand-in for the gbrain CLI: records argv/env/stdin, serves `get` from what was put.
    import json, os, sys
    from pathlib import Path
    home = Path(os.environ["GBRAIN_HOME"]) / ".gbrain"
    log = home / "calls.jsonl"
    stdin = sys.stdin.read() if sys.argv[1:2] == ["put"] else None
    with log.open("a") as f:
        f.write(json.dumps({"argv": sys.argv[1:], "GBRAIN_HOME": os.environ.get("GBRAIN_HOME"),
                            "db_env": [k for k in ("DATABASE_URL", "GBRAIN_DATABASE_URL") if k in os.environ],
                            "stdin": stdin}) + "\\n")
    pages = home / "pages"
    if sys.argv[1] == "put":
        (pages / (sys.argv[2].replace("/", "__") + ".md")).parent.mkdir(parents=True, exist_ok=True)
        (pages / (sys.argv[2].replace("/", "__") + ".md")).write_text(stdin)
        print(json.dumps({"ok": True, "slug": sys.argv[2]}))
    elif sys.argv[1] == "get":
        print((pages / (sys.argv[2].replace("/", "__") + ".md")).read_text())
    """
)


@pytest.fixture
def fake_gbrain(tmp_path, monkeypatch):
    """-> (GBrain pointed at an isolated tmp home with a fake CLI, path of its call log)."""
    from gbrain import GBrain

    home = tmp_path / "gbrain-home"
    (home / ".gbrain").mkdir(parents=True)
    (home / ".gbrain" / "config.json").write_text("{}")
    exe = tmp_path / "bin" / "gbrain"
    exe.parent.mkdir()
    exe.write_text(FAKE_GBRAIN)
    exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
    # A DATABASE_URL in the parent env must never reach gbrain (it would override the isolated config).
    monkeypatch.setenv("DATABASE_URL", "postgres://personal-brain-must-not-be-used")
    return GBrain(home=home, bin=str(exe)), home / ".gbrain" / "calls.jsonl"


@pytest.fixture
def world(tmp_path, monkeypatch, fake_gbrain):
    """A Protocol over a tmp copy of the real SOC 2 page, with the Loose Ends inbox attached."""
    import loose_ends

    monkeypatch.setenv("MP_TODAY", "2026-09-27")
    palace = tmp_path / "palace.json"
    palace.write_text(json.dumps(PALACE))
    brain_dir = tmp_path / "seed-brain"
    (brain_dir / "eng").mkdir(parents=True)
    (brain_dir / "eng" / "soc2-owner.md").write_text(SOC2)
    (brain_dir / "eng" / "security-policy.md").write_text(
        "---\ntitle: Security Policy\ntype: policy\nteam: eng\nupdated: 2026-03-02\n---\n"
        "Information security policy, last reviewed March. SSO and MFA everywhere, quarterly access reviews.\n\n"
        "## Links\n- governs: [[eng/soc2-owner]]\n- listed_in: [[people/org-chart]]\n"
    )
    clock = SimClock()
    proto = Protocol(palace_path=palace, brain=Brain(brain_dir=brain_dir, overlay_dir=tmp_path / "overlay"), clock=clock, runs_dir=tmp_path / "runs")
    gbrain, calls = fake_gbrain
    inbox = loose_ends.attach(proto, state_dir=tmp_path / "state", outbox_dir=tmp_path / "outbox", webhook="", load_env=False, gbrain=gbrain, sync_gbrain=True)
    proto.start_run("r1")
    return {"proto": proto, "inbox": inbox, "brain_dir": brain_dir, "calls": calls, "tmp": tmp_path, "clock": clock}
