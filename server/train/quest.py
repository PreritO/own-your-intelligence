"""A commissioned quest agent trains in the Gym for its task.

    python -m server.train.quest --task "<text>" --agent quest-1 [--steps 12] [--seconds 10] [--river]

stdout: one `train_step` PalaceEvent JSON per line (and nothing else), paced over ~--seconds.
The policy is the local RL sim (sim.py: 4 protocol behaviours, group-centred policy gradient,
8 attempts per task) trained through PalaceWorld + the Gym reward on the palace tasks that best
match the commission text. Checkpoints are labelled honestly: "sim-step-N".

--stations '[{"id","subtask","value"}]' (what server/commission/quest.ts passes: the stations the agent
explored in run 1, value 0 = wasted hop) additionally trains a per-station keep policy with the same
group-centred policy gradient and the commission Gym's route reward (useful evidence covered, hop cost,
uncovered-subtask cost), and ends the stream with one {"probs": {station: p_keep}} line. The learned route
is every station with p >= 0.5.

--river additionally starts a real River RL job (rl.py --simple, from the matched team's SFT
checkpoint when one exists) in the background and reports its log path and job (model) id on
stderr, so stdout stays a clean event stream.
"""
from __future__ import annotations

import argparse
import json
import random
import re
import subprocess
import sys
import time
import zlib

from .common import OUT, ROOT, Palace, river_key
from .palace_env import score_world
from .sim import BEHAVIOURS, logit, rollout, sigmoid
from .trajectories import build

STOP = set("a an the of to for and or in on is are was we our do does did what who whom how can this that with by be it its at from about".split())


def words(s: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", s.lower()) if w not in STOP and len(w) > 2}


def matched_rows(task: str, k: int = 32) -> tuple[list[dict], str]:
    """Palace tasks most similar to the commission (task text + station titles), and their majority team."""
    palace = Palace()
    data = build(per_team=300, heldout=0)
    rows = [r for t in data.values() for r in t["train"] + t["heldout"]]
    q = words(task)

    def score(r: dict) -> float:
        titles = " ".join(palace.memories[s]["title"] for s in r["stations"] if s in palace.memories)
        w = words(r["task"]) | words(titles) | words(" ".join(r["stations"]))
        return len(q & w) + 0.1 * (len(r["stations"]) > 1) + 0.1 * bool(r["expected"]["gaps"] or r["expected"]["handoffs"])

    ranked = sorted(rows, key=lambda r: (-score(r), r["id"]))
    top = [r for r in ranked if score(r) >= 1][:k] or ranked[:k]
    teams = [r["team"] for r in top]
    return top, max(set(teams), key=teams.count)


def start_river(team: str, agent: str, steps: int) -> None:
    if not river_key():
        print(json.dumps({"river": "skipped", "reason": "RIVER_API_KEY not set"}), file=sys.stderr, flush=True)
        return
    OUT.mkdir(parents=True, exist_ok=True)
    log = OUT / f"quest-{agent}-river.log"
    cmd = ["uv", "run", "--project", "server/train", "--extra", "river", "python", "-m", "server.train.rl", "--simple", "--team", team, "--steps", str(steps), "--groups-per-step", "4", "--group-size", "8"]
    proc = subprocess.Popen(cmd, cwd=ROOT, stdout=log.open("w"), stderr=subprocess.STDOUT, start_new_session=True)
    print(json.dumps({"river": "started", "pid": proc.pid, "team": team, "log": str(log.relative_to(ROOT))}), file=sys.stderr, flush=True)
    # The job id (River model id) appears within ~30 s; report it without delaying the stdout stream much.
    deadline = time.time() + 45
    while time.time() < deadline and proc.poll() is None:
        m = re.search(r'"model_id": "([^"]+)"', log.read_text() if log.exists() else "")
        if m:
            print(json.dumps({"river": "job", "model_id": m.group(1), "team": team, "log": str(log.relative_to(ROOT))}), file=sys.stderr, flush=True)
            return
        time.sleep(1)
    print(json.dumps({"river": "pending", "note": "model id not yet in log", "log": str(log.relative_to(ROOT))}), file=sys.stderr, flush=True)


HOP_COST, UNCOVERED = 0.3, 0.6  # same shape as server/commission/gym.ts


def route_reward(keep: list[bool], stations: list[dict]) -> float:
    r, covered = 0.0, set()
    need = {s["subtask"] for s in stations if s["value"] > 0}
    for k, s in zip(keep, stations):
        if k:
            r += s["value"] - HOP_COST
            if s["value"] > 0:
                covered.add(s["subtask"])
    return r - UNCOVERED * len(need - covered)


class RoutePolicy:
    """One Bernoulli keep/drop per explored station; starts high (run 1 visited everything)."""

    def __init__(self, stations: list[dict], rng: random.Random, group: int = 12, lr: float = 2.5):
        self.st, self.rng, self.group, self.lr = stations, rng, group, lr
        self.theta = [1.5 for _ in stations]

    def step(self) -> None:
        ps = [sigmoid(t) for t in self.theta]
        samples = [[self.rng.random() < p for p in ps] for _ in range(self.group)]
        rs = [route_reward(k, self.st) for k in samples]
        mean = sum(rs) / len(rs)
        sd = (sum((r - mean) ** 2 for r in rs) / len(rs)) ** 0.5 or 1.0
        for i, p in enumerate(ps):
            g = sum(((r - mean) / sd) * ((1.0 if k[i] else 0.0) - p) for k, r in zip(samples, rs))
            self.theta[i] += self.lr * g / self.group

    def probs(self) -> dict[str, float]:
        return {s["id"]: round(sigmoid(t), 3) for s, t in zip(self.st, self.theta)}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--task", required=True)
    ap.add_argument("--agent", default="quest-1")
    ap.add_argument("--steps", type=int, default=12)
    ap.add_argument("--seconds", type=float, default=10.0, help="spread the stream over about this long")
    ap.add_argument("--groups", type=int, default=8)
    ap.add_argument("--group-size", type=int, default=8)
    ap.add_argument("--lr", type=float, default=0.9)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--team", action="store_true", help="include the matched team in each event (default: agent only)")
    ap.add_argument("--stations", default="", help="JSON [{id, subtask, value}]: also learn a route over these stations")
    ap.add_argument("--river", action="store_true", help="also start a real River RL job and report its id on stderr")
    a = ap.parse_args()

    t0 = time.time()
    rows, team = matched_rows(a.task)
    print(json.dumps({"quest": a.agent, "matched_team": team, "tasks": len(rows), "examples": [r["task"] for r in rows[:3]]}), file=sys.stderr, flush=True)
    if a.river:
        start_river(team, a.agent, max(a.steps, 10))

    rng = random.Random(a.seed ^ zlib.crc32(a.task.encode()))
    stations = [{"id": str(x["id"]), "subtask": str(x.get("subtask", "s1")), "value": float(x.get("value", 0))} for x in json.loads(a.stations)] if a.stations else []
    route = RoutePolicy(stations, random.Random(a.seed + 7)) if stations else None
    theta = {"visit": logit(0.65), "handoff": logit(0.25), "report": logit(0.3), "invent": logit(0.45)}
    pace = a.seconds / max(a.steps, 1)
    for step in range(1, a.steps + 1):
        probs = {b: sigmoid(theta[b]) for b in BEHAVIOURS}
        grads = {b: 0.0 for b in BEHAVIOURS}
        rewards: list[float] = []
        for row in rng.sample(rows, min(a.groups, len(rows))):
            group = [rollout(row, probs, rng) for _ in range(a.group_size)]
            rs = [score_world(w)["reward"] for w, _ in group]
            mean = sum(rs) / len(rs)
            rewards += rs
            for (_, dec), r in zip(group, rs):
                for b, ds in dec.items():
                    for act, p in ds:
                        grads[b] += (r - mean) * (act - p)
        n = max(len(rewards), 1)
        for b in BEHAVIOURS:
            theta[b] += a.lr * grads[b] / n * 8
        e = {"t": round(time.time() - t0, 3), "agent": a.agent, "run": f"{a.agent}-gym", "type": "train_step", "step": step, "reward": round(sum(rewards) / n, 4), "checkpoint": f"sim-step-{step}"}
        if a.team:
            e["team"] = team
        if route:
            route.step()
        print(json.dumps(e), flush=True)
        # keep the whole stream near --seconds regardless of compute time
        sleep = t0 + step * pace - time.time()
        if sleep > 0:
            time.sleep(sleep)
    if route:
        print(json.dumps({"probs": route.probs(), "policy": "route-keep (sim)", "matched_team": team}), flush=True)


if __name__ == "__main__":
    main()
