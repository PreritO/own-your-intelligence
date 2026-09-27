"""Per-team training data for the Gym.

Sources, in order of trust:
  1. fixtures/replays/*.jsonl        real orchestrator/QM runs (task, route, visits, handoffs, answer)
  2. fixtures/synthetic-tasks.jsonl  seed's ~50/team {team, question, route, expectedAnswer, expectedGaps} (optional)
  3. generated                       expanded programmatically from palace.json routes, memories and links

Every row carries its ground truth (route, verdict per station, expected citations/gaps/stale/handoffs)
so SFT targets, the RL reward and eval all score against the same thing. 30 held-out rows per team.

    python -m server.train.trajectories [--per-team 300] [--heldout 30] [--seed 7]
"""
from __future__ import annotations

import argparse
import json
import random
from collections import Counter, defaultdict

from .common import DATA, TEAMS, Palace, load_learned_routes, load_optional_jsonl, load_replays, write_jsonl

SYSTEM = """You are the {team} team agent in Acme Robotics' memory palace. Follow the loci protocol:
1. Walk the route: visit every station in order; a route is a checklist, never skip one.
2. Rooms you don't own ({others}) need a handoff to their team; People and the Foyer are shared.
3. Report gaps loudly: if a station has no record, list it under gaps and never invent its content.
4. Answer only from verified stations and cite them. Report stale stations separately.
Reply with one JSON object: {{"route": [...], "handoffs": [{{"memoryId": ..., "toAgent": ...}}], "citations": [...], "gaps": [...], "stale": [...], "answer": "..."}}

Stations (id | title | owning team):
{catalog}"""

CONTEXTS = ["", " this week", " before the board meeting", " for the audit", " — quick answer please", " for the Monday sync", " before we reply to the customer", " for the quarterly review"]


# ------------------------------------------------------------------ ground truth
def observed_verdicts(replays: dict[str, list[dict]]) -> dict[str, str]:
    """Latest verdict seen for each memory across all replays (real runs are ground truth)."""
    out: dict[str, str] = {}
    for events in replays.values():
        for e in sorted(events, key=lambda e: e.get("t", 0)):
            if e.get("type") == "visit":
                out[e["memoryId"]] = e["verdict"]
    return out


def verdict_for(palace: Palace, observed: dict[str, str], seed_gaps: set[str], mid: str) -> str:
    if mid in observed:
        return observed[mid]
    if mid in seed_gaps:
        return "gap"
    f = palace.memories.get(mid, {}).get("freshness", 1.0)
    return "gap" if f < 0.12 else "stale" if f < 0.3 else "verified"


def expected_for(palace: Palace, team: str, stations: list[str], verdicts: dict[str, str]) -> dict:
    v = {s: verdicts[s] for s in stations}
    return {
        "verdicts": v,
        "citations": [s for s in stations if v[s] == "verified"],
        "gaps": [s for s in stations if v[s] == "gap"],
        "stale": [s for s in stations if v[s] == "stale"],
        "handoffs": [{"memoryId": s, "toAgent": palace.owner(s)} for s in stations if not palace.readable_by(s, team)],
    }


def compose_answer(palace: Palace, exp: dict) -> str:
    parts = []
    for s in exp["citations"]:
        m = palace.memories[s]
        parts.append(f"{m['title']}: {m['excerpt'].rstrip('.')}.")
    for s in exp["stale"]:
        parts.append(f"Stale: {palace.memories[s]['title']} needs review before we rely on it.")
    for s in exp["gaps"]:
        parts.append(f"Gap: {palace.memories[s]['title']} has no record; flagged as a Loose End.")
    return " ".join(parts) or "Nothing verified on this route."


# ------------------------------------------------------------------ sources
def from_replays(palace: Palace, replays: dict[str, list[dict]]) -> list[dict]:
    agent_team = {a["id"]: a["team"] for a in palace.raw.get("agents", [])}
    rows = []
    for name, events in replays.items():
        runs: dict[str, dict] = {}
        for e in sorted(events, key=lambda e: e.get("t", 0)):
            if e.get("type") == "train_step":
                continue
            key = e.get("run") or e["agent"]
            if e["type"] == "task":
                runs[key] = {"agent": e["agent"], "task": e["text"], "route": None, "visits": [], "handoffs": [], "answer": None}
            r = runs.get(key)
            if not r:
                continue
            if e["type"] == "route":
                r["route"] = {"id": e["routeId"], "stations": e["stations"], "source": e["source"]}
            elif e["type"] == "visit":
                r["visits"].append({"memoryId": e["memoryId"], "verdict": e["verdict"], "note": e.get("note")})
            elif e["type"] == "handoff":
                r["handoffs"].append({"memoryId": e["memoryId"], "toAgent": e["toAgent"], "question": e["question"]})
            elif e["type"] == "answer":
                r["answer"] = e
        for key, r in runs.items():
            if not r["answer"] or not r["route"]:
                continue
            team = agent_team.get(r["agent"], r["agent"])
            if team not in TEAMS:
                continue
            rows.append({
                "team": team, "task": r["task"], "route_id": r["route"]["id"], "stations": r["route"]["stations"],
                "answer": r["answer"]["text"], "source": f"replay:{name}",
                "trace": {"visits": r["visits"], "handoffs": r["handoffs"], "citations": r["answer"].get("citations", []), "gaps": r["answer"].get("gaps", []), "stale": r["answer"].get("stale", [])},
            })
    return rows


def route_team(palace: Palace, stations: list[str], hint: dict[str, str], route_id: str) -> str:
    if route_id in hint:
        return hint[route_id]
    owned = [palace.owner(s) for s in stations if palace.owner(s) in TEAMS]
    return owned[0] if owned else "legal"


def generated(palace: Palace, team_hint: dict[str, str]) -> list[dict]:
    """Programmatic expansion: route questions, sub-routes, single-station lookups, cross-team handoffs."""
    rows: list[dict] = []
    routes = [{"id": r["id"], "label": r["label"], "stations": r["stations"]} for r in palace.routes]
    for lr in load_learned_routes():
        if lr.get("routeId") and lr.get("stations") and all(s in palace.memories for s in lr["stations"]):
            routes.append({"id": lr["routeId"], "label": lr.get("task") or lr["routeId"], "stations": lr["stations"], "task": lr.get("task")})

    route_tpl = [
        "{label}: what's the answer{ctx}?",
        "Walk the {label} route and tell me where we stand{ctx}.",
        "{task}",
        "Check {first} through {last} and answer: {label}{ctx}.",
        "What do {first} and {last} tell us about {label_l}{ctx}?",
        "Before anyone acts on {label_l}, confirm every station{ctx}.",
        "Summarize {label_l} with citations{ctx}.",
        "Is anything missing for {label_l}{ctx}?",
    ]
    for r in routes:
        team = route_team(palace, r["stations"], team_hint, r["id"])
        st = r["stations"]
        titles = [palace.memories[s]["title"] for s in st]
        for tpl in route_tpl:
            for ctx in CONTEXTS:
                q = tpl.format(label=r["label"], label_l=r["label"].lower(), task=r.get("task") or r["label"] + "?", first=titles[0], last=titles[-1], ctx=ctx)
                rows.append({"team": team, "task": q, "route_id": r["id"], "stations": st, "source": "generated:route"})
        # prefixes of the route are shorter checklists in their own right
        for k in range(2, len(st)):
            sub = st[:k]
            for ctx in CONTEXTS[:4]:
                q = f"Up to {palace.memories[sub[-1]]['title']}, what does the {r['label'].lower()} route say{ctx}?"
                rows.append({"team": team, "task": q, "route_id": f"{r['id']}~{k}", "stations": sub, "source": "generated:subroute"})

    mem_tpl = [  # single station
        "What does our {type} '{title}' say{ctx}?",
        "Is {title} still current{ctx}?",
        "Who is responsible for {title}{ctx}?",
        "Pull the facts from {title}{ctx}.",
    ]
    linked_tpl = [  # station + its linked pages
        "Summarize {title} and what it links to{ctx}.",
        "Follow {title}'s links and brief me{ctx}.",
        "Give me {title} with its related pages{ctx}.",
    ]
    for mid, m in palace.memories.items():
        owner = palace.owner(mid)
        linked = palace.neighbours(mid)[:2]
        station_sets = [[mid]] + ([[mid] + linked] if linked else [])
        for team in TEAMS:
            if owner not in (team, "shared") and owner in TEAMS:
                # cross-team: the asking team must hand off to the owner
                for tpl in mem_tpl[:3]:
                    for ctx in CONTEXTS[:4]:
                        q = f"[{team}] needs {owner}'s input: " + tpl.format(type=m["type"], title=m["title"], ctx=ctx)
                        rows.append({"team": team, "task": q, "route_id": f"lookup:{mid}", "stations": [mid], "source": "generated:handoff"})
                continue
            for stations in station_sets:
                for tpl in (mem_tpl if len(stations) == 1 else linked_tpl):
                    for ctx in CONTEXTS:
                        q = tpl.format(type=m["type"], title=m["title"], ctx=ctx)
                        rows.append({"team": team, "task": q, "route_id": f"lookup:{'+'.join(stations)}", "stations": stations, "source": "generated:lookup"})
    return rows


def from_seed_synthetic(palace: Palace) -> list[dict]:
    rows = []
    for r in load_optional_jsonl("synthetic-tasks.jsonl"):
        route = r.get("route")
        stations = route if isinstance(route, list) else next((x["stations"] for x in palace.routes if x["id"] == route), None)
        if r.get("team") in TEAMS and stations and all(s in palace.memories for s in stations):
            rows.append({"team": r["team"], "task": r["question"], "route_id": route if isinstance(route, str) else "seed", "stations": stations,
                         "answer": r.get("expectedAnswer"), "seed_gaps": r.get("expectedGaps") or [], "source": "seed-synthetic"})
    return rows


# ------------------------------------------------------------------ build
def build(per_team: int = 300, heldout: int = 30, seed: int = 7) -> dict[str, dict[str, list[dict]]]:
    palace = Palace()
    replays = load_replays()
    replay_rows = from_replays(palace, replays)
    seed_rows = from_seed_synthetic(palace)
    team_hint = {r["route_id"]: r["team"] for r in replay_rows}
    seed_gaps = {g for r in seed_rows for g in r.get("seed_gaps", [])}
    verdicts_seen = observed_verdicts(replays)
    verdicts = {mid: verdict_for(palace, verdicts_seen, seed_gaps, mid) for mid in palace.memories}

    rng = random.Random(seed)
    out: dict[str, dict[str, list[dict]]] = {}
    gen = generated(palace, team_hint)
    for team in TEAMS:
        fixed = [r for r in replay_rows + seed_rows if r["team"] == team]
        pool = [r for r in gen if r["team"] == team]
        rng.shuffle(pool)
        seen, rows = set(), []
        for r in fixed + pool:
            key = r["task"].strip().lower()
            if key in seen:
                continue
            seen.add(key)
            rows.append(r)
            if len(rows) >= per_team:
                break
        others = ", ".join(t for t in TEAMS if t != team)
        system = SYSTEM.format(team=team, others=others, catalog=palace.catalog())
        finished = []
        for i, r in enumerate(rows):
            exp = expected_for(palace, team, r["stations"], verdicts)
            exp["answer"] = r.get("answer") or compose_answer(palace, exp)
            target = {"route": r["stations"], "handoffs": exp["handoffs"], "citations": exp["citations"], "gaps": exp["gaps"], "stale": exp["stale"], "answer": exp["answer"]}
            finished.append({
                "id": f"{team}-{i:04d}", "domain": team, "team": team, "task": r["task"], "route_id": r["route_id"],
                "stations": r["stations"], "expected": exp, "source": r["source"],
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": r["task"]},
                    {"role": "assistant", "content": json.dumps(target, ensure_ascii=False)},
                ],
            })
        # held-out: generated rows only (real runs always train), stratified by source
        candidates = [r for r in finished if r["source"].startswith("generated")]
        rng.shuffle(candidates)
        by_src: dict[str, list[dict]] = defaultdict(list)
        for r in candidates:
            by_src[r["source"]].append(r)
        held: list[dict] = []
        while len(held) < min(heldout, len(candidates)):
            for src in sorted(by_src):
                if by_src[src] and len(held) < heldout:
                    held.append(by_src[src].pop())
        held_ids = {r["id"] for r in held}
        for r in finished:
            r["split"] = "heldout" if r["id"] in held_ids else "train"
        out[team] = {"train": [r for r in finished if r["split"] == "train"], "heldout": [r for r in finished if r["split"] == "heldout"]}
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--per-team", type=int, default=300)
    ap.add_argument("--heldout", type=int, default=30)
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    data = build(a.per_team, a.heldout, a.seed)
    print(f"{'team':8} {'train':>6} {'heldout':>8}  sources")
    for team, splits in data.items():
        write_jsonl(DATA / f"{team}.train.jsonl", splits["train"])
        write_jsonl(DATA / f"{team}.heldout.jsonl", splits["heldout"])
        src = Counter(r["source"].split(":")[0] if r["source"].startswith("generated") else r["source"] for r in splits["train"] + splits["heldout"])
        gaps = sum(1 for r in splits["train"] + splits["heldout"] if r["expected"]["gaps"])
        hand = sum(1 for r in splits["train"] + splits["heldout"] if r["expected"]["handoffs"])
        print(f"{team:8} {len(splits['train']):>6} {len(splits['heldout']):>8}  {dict(src)}  gap-tasks={gaps} handoff-tasks={hand}")
    write_jsonl(DATA / "all.train.jsonl", [r for s in data.values() for r in s["train"]])
    print(f"wrote {DATA.relative_to(DATA.parents[2])}/<team>.{{train,heldout}}.jsonl + all.train.jsonl")


if __name__ == "__main__":
    main()
