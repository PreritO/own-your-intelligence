import json
from pathlib import Path

import pytest

from loci import Brain, Protocol, SimClock


def mem(id, room, freshness=0.8, excerpt="Some content."):
    return {"id": id, "title": id.split("/")[-1], "type": "page", "room": room, "pos": [0, 0, 0], "freshness": freshness, "excerpt": excerpt, "path": f"{id}.md"}


# A small palace with the same shape as the Phase 0 fixture, so tests don't break when seed swaps fixtures.
PALACE = {
    "version": 1,
    "generatedAt": "2026-09-27T00:00:00Z",
    "wings": [],
    "rooms": [
        {"id": "foyer", "wing": "foyer", "owner": "shared", "label": "Foyer", "center": [0, 0, 0], "size": [1, 1, 1], "doors": []},
        {"id": "room-people-0", "wing": "people", "owner": "shared", "label": "People", "center": [0, 0, 0], "size": [1, 1, 1], "doors": []},
        {"id": "room-legal-0", "wing": "legal", "owner": "legal", "label": "Legal", "center": [0, 0, 0], "size": [1, 1, 1], "doors": []},
        {"id": "room-finance-1", "wing": "finance", "owner": "finance", "label": "Budget", "center": [0, 0, 0], "size": [1, 1, 1], "doors": []},
        {"id": "room-eng-0", "wing": "eng", "owner": "eng", "label": "Eng", "center": [0, 0, 0], "size": [1, 1, 1], "doors": []},
    ],
    "memories": [
        mem("companies/gripworks", "room-people-0"),
        mem("eng/security-policy", "room-eng-0", freshness=0.15),
        mem("eng/soc2-owner", "room-eng-0", freshness=0.1, excerpt=""),
        mem("finance/budget-2026-q4", "room-finance-1", excerpt="Supplier line: $55k allocated, $15k committed."),
        mem("legal/gripworks-msa", "room-legal-0"),
        mem("people/org-chart", "room-people-0"),
    ],
    "links": [],
    "agents": [
        {"id": "legal", "label": "Legal agent", "team": "legal", "color": "#bb9af7", "home": "room-legal-0"},
        {"id": "finance", "label": "Finance agent", "team": "finance", "color": "#e0af68", "home": "room-finance-1"},
        {"id": "eng", "label": "Eng agent", "team": "eng", "color": "#9ece6a", "home": "room-eng-0"},
    ],
    "routes": [
        {"id": "contract-signoff", "label": "Contract", "stations": ["companies/gripworks", "legal/gripworks-msa", "finance/budget-2026-q4"]},
    ],
}


@pytest.fixture
def clock():
    return SimClock()


@pytest.fixture
def proto(tmp_path: Path, clock):
    palace = tmp_path / "palace.json"
    palace.write_text(json.dumps(PALACE))
    brain = Brain(brain_dir=tmp_path / "seed-brain", overlay_dir=tmp_path / "overlay")
    p = Protocol(palace_path=palace, brain=brain, clock=clock, runs_dir=tmp_path / "runs")
    p.start_run("test")
    return p


def types(p: Protocol):
    return [e["type"] for e in p.runs[p.current].events]
