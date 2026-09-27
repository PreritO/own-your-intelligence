"""Gym scoreboard: score policies on each team's 30 held-out tasks with the Gym reward.

    python -m server.train.eval --dry-run          # scripted baselines + RL-sim policy, no key needed
    python -m server.train.eval [--limit 10]       # + River base model and every saved checkpoint

Metrics per (team, policy): mean reward (and max achievable), correct %, protocol-compliant %
(no skipped stations, no unowned reads, gaps reported, nothing invented), tool calls, latency.
The best non-oracle reward per team is its PR. Writes server/train/out/scoreboard.json.
"""
from __future__ import annotations

import argparse
import json
import time

from .common import DATA, OUT, TEAMS, load_checkpoints, pick_base_model, read_jsonl, river_client, river_key
from .palace_env import parse_plan, score_plan
from .sim import BASELINES, evaluate


def heldout(team: str) -> list[dict]:
    p = DATA / f"{team}.heldout.jsonl"
    if not p.exists():
        raise SystemExit("No datasets yet: python -m server.train.trajectories")
    return read_jsonl(p)


def _content(result) -> str:
    body = getattr(result, "response_json", result)
    if isinstance(body, (bytes, str)):
        try:
            body = json.loads(body)
        except json.JSONDecodeError:
            return str(body)
    try:
        return body["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        return str(body)


def eval_river(rows: list[dict], call) -> dict:
    agg = {"reward": 0.0, "max_reward": 0.0, "correct": 0, "compliant": 0, "tool_calls": 0, "latency": 0.0}
    for row in rows:
        t0 = time.time()
        try:
            text = call(row["messages"][:2])
        except Exception as e:  # keep the scoreboard going; record as a failed attempt
            text = f"error: {e}"
        agg["latency"] += time.time() - t0
        s = score_plan(row, parse_plan(text))
        for k in ("reward", "max_reward", "tool_calls"):
            agg[k] += s[k]
        agg["correct"] += s["correct"]
        agg["compliant"] += s["compliant"]
    n = max(len(rows), 1)
    return {"n": len(rows), **{k: v / n for k, v in agg.items()}}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="scripted policies only (no River calls)")
    ap.add_argument("--limit", type=int, default=30, help="held-out tasks per team for River models")
    ap.add_argument("--samples", type=int, default=4, help="samples per task for scripted policies")
    a = ap.parse_args()

    board: dict[str, dict[str, dict]] = {t: {} for t in TEAMS}
    for team in TEAMS:
        rows = heldout(team)
        for name, probs in BASELINES.items():
            board[team][name] = {**evaluate(rows, probs, seed=1, samples=a.samples), "kind": "scripted"}
        pol = OUT / f"rl-{team}-dryrun-policy.json"
        if pol.exists():
            p = json.loads(pol.read_text())
            board[team][f"rl-sim@{p['step']}"] = {**evaluate(rows, p["probs"], seed=1, samples=a.samples), "kind": "rl-sim"}

    mode = "dry-run"
    if not a.dry_run:
        if not river_key():
            print("RIVER_API_KEY not set: scoring scripted policies only (same as --dry-run).")
        else:
            mode = "river"
            client = river_client()
            base = pick_base_model(client)
            ckpts = load_checkpoints()
            print(f"River base model: {base}; checkpoints: {sorted(ckpts)}")
            for team in TEAMS:
                rows = heldout(team)[: a.limit]
                board[team][f"base:{base.split('/')[-1]}"] = {**eval_river(rows, lambda m: _content(client.chat_complete(m, base_model=base, max_tokens=1024, temperature=0.0))), "kind": "base"}
                for key, info in ckpts.items():
                    if info.get("team") != team or not info.get("inference_path"):
                        continue
                    path = info["inference_path"]
                    board[team][key] = {**eval_river(rows, lambda m, path=path: _content(client.chat_complete_from_checkpoint(m, checkpoint_path=path, base_model=info.get("base_model", base), max_tokens=1024, temperature=0.0))), "kind": "checkpoint"}
            # Frontier planner column: not wired (no frontier key in this workspace); see NOTES-training.md.

    print(f"\nGym scoreboard ({mode}) · held-out tasks per team · reward = docs/SPEC.md Gym rules\n")
    hdr = f"{'team':8} {'policy':28} {'n':>4} {'reward':>7} {'/max':>6} {'correct':>8} {'compliant':>10} {'tools':>6} {'latency':>8}"
    print(hdr)
    print("-" * len(hdr))
    for team in TEAMS:
        rows = board[team]
        pr_name = max((k for k in rows if k != "oracle-route"), key=lambda k: rows[k]["reward"], default=None)
        for name, r in rows.items():
            lat = f"{r['latency']:.2f}s" if "latency" in r else "-"
            flag = "  PR" if name == pr_name and name != "oracle-route" else ("  (ceiling)" if name == "oracle-route" else "")
            print(f"{team:8} {name:28} {r['n']:>4} {r['reward']:>7.3f} {r['max_reward']:>6.2f} {100 * r['correct']:>7.0f}% {100 * r['compliant']:>9.0f}% {r['tool_calls']:>6.1f} {lat:>8}{flag}")
        print()
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "scoreboard.json").write_text(json.dumps({"mode": mode, "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"), "teams": board}, indent=2))
    print(f"wrote {(OUT / 'scoreboard.json').relative_to(OUT.parents[2])}")


if __name__ == "__main__":
    main()
