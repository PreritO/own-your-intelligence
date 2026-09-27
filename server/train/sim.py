"""Scripted policies for dry-runs: they act through the same PalaceWorld tools and the same reward
as a River model, so the eval harness and RL loop are exercised end to end without a key.

A policy is four Bernoulli behaviours (logits):
  visit   - walk each route station (else skip it)
  handoff - hand off a station in a room the team doesn't own (else read it directly)
  report  - list a gap it hit under `gaps`
  invent  - cite a gap station as a source anyway (bad)
"""
from __future__ import annotations

import json
import math
import random

from .palace_env import PalaceWorld, palace, score_world

BEHAVIOURS = ("visit", "handoff", "report", "invent")


def sigmoid(x: float) -> float:
    return 1 / (1 + math.exp(-x))


def logit(p: float) -> float:
    p = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p))


# Fixed baselines (probabilities), used as comparison rows in eval --dry-run.
BASELINES: dict[str, dict[str, float]] = {
    "oracle-route": {"visit": 1.0, "handoff": 1.0, "report": 1.0, "invent": 0.0},
    "naive-rag": {"visit": 0.35, "handoff": 0.0, "report": 0.1, "invent": 0.6},
    "no-protocol": {"visit": 0.9, "handoff": 0.0, "report": 0.5, "invent": 0.3},
}


def rollout(row: dict, probs: dict[str, float], rng: random.Random) -> tuple[PalaceWorld, dict[str, list[tuple[int, float]]]]:
    """Run one episode. Returns the world and the (action, prob) decisions per behaviour."""
    w = PalaceWorld(row)
    decisions: dict[str, list[tuple[int, float]]] = {b: [] for b in BEHAVIOURS}

    def draw(b: str) -> bool:
        a = int(rng.random() < probs[b])
        decisions[b].append((a, probs[b]))
        return bool(a)

    team = row["team"]
    gaps_seen: list[str] = []
    for s in row["stations"]:
        if not palace().readable_by(s, team) and draw("handoff"):
            reply = json.loads(w.handoff(s, palace().owner(s), f"{row['task']} ({s})"))
            if reply.get("verdict") == "gap":
                gaps_seen.append(s)
            continue
        if not draw("visit"):
            continue
        w.claim(s)
        body = w.visit(s)
        if body.startswith("{") and json.loads(body).get("verdict") == "gap":
            gaps_seen.append(s)
    verified = [s for s in dict.fromkeys(w.visits) if w.verdict(s) == "verified"]
    cites = list(verified)
    reported = []
    for g in gaps_seen:
        if draw("invent"):
            cites.append(g)
        elif draw("report"):
            reported.append(g)
    stale = [s for s in dict.fromkeys(w.visits) if w.verdict(s) == "stale"]
    text = " ".join(palace().memories[c]["excerpt"] for c in cites if c in palace().memories) or ("Gap reported." if reported else "Only stale records; needs review." if stale else "")
    w.answer(text, cites, reported, stale)
    return w, decisions


def evaluate(rows: list[dict], probs: dict[str, float], seed: int = 0, samples: int = 1) -> dict:
    rng = random.Random(seed)
    n = 0
    agg = {"reward": 0.0, "correct": 0, "compliant": 0, "tool_calls": 0, "max_reward": 0.0}
    for row in rows:
        for _ in range(samples):
            w, _ = rollout(row, probs, rng)
            s = score_world(w)
            n += 1
            agg["reward"] += s["reward"]
            agg["max_reward"] += s["max_reward"]
            agg["correct"] += s["correct"]
            agg["compliant"] += s["compliant"]
            agg["tool_calls"] += w.tool_calls
    n = max(n, 1)
    return {"n": n, "reward": agg["reward"] / n, "max_reward": agg["max_reward"] / n, "correct": agg["correct"] / n, "compliant": agg["compliant"] / n, "tool_calls": agg["tool_calls"] / n}
