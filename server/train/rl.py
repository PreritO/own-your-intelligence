"""RL in the Gym's sparring ring: the palace is the environment (Legal first).

    python -m server.train.rl --dry-run [--team legal] [--steps 30] [--pace 0]
    python -m server.train.rl [--team legal] [--steps 20]         # real River job (needs RIVER_API_KEY)

Real mode follows River's RL recipe (docs.river.ai/guides/rl-sync, rl-tools): PalaceEnv with
visit/claim/handoff/answer tools, 8 attempts per task (group_size=8), GroupCentered advantages,
CISPO loss, synchronous (max_staleness=0), starting from the team's SFT checkpoint when one exists.

Dry-run trains a 4-behaviour Bernoulli policy (sim.py) with the same group-centred policy
gradient through the same PalaceWorld tools and reward, so reward/mean genuinely climbs and the
Gym gets real train_step events without a key. Every step is logged as a train_step PalaceEvent
to server/train/out/<run>.jsonl and POSTed to the bridge (:8788) when it is up.
"""
from __future__ import annotations

import argparse
import json
import random
import time

from .common import DATA, OUT, StepLogger, load_checkpoints, pick_base_model, read_jsonl, river_client, river_key, save_checkpoint
from .sim import BEHAVIOURS, evaluate, logit, rollout, sigmoid
from .palace_env import score_world


def rows_for(team: str, split: str) -> list[dict]:
    p = DATA / f"{team}.{split}.jsonl"
    if not p.exists():
        raise SystemExit("No datasets yet: python -m server.train.trajectories")
    return read_jsonl(p)


# ------------------------------------------------------------------ dry run
def dry_run(team: str, steps: int, groups_per_step: int, group_size: int, lr: float, pace: float, seed: int) -> None:
    train, held = rows_for(team, "train"), rows_for(team, "heldout")
    rng = random.Random(seed)
    # Start where an untuned model tends to be: walks most stations, rarely hands off or reports gaps.
    theta = {"visit": logit(0.7), "handoff": logit(0.25), "report": logit(0.3), "invent": logit(0.45)}
    run = f"rl-{team}-dryrun"
    log = StepLogger(run)
    probs = lambda: {b: sigmoid(theta[b]) for b in BEHAVIOURS}  # noqa: E731
    # Only rows with something to learn (route of 2+ stations, a gap, or a handoff) give group variance.
    pool = [r for r in train if len(r["stations"]) > 1 or r["expected"]["gaps"] or r["expected"]["handoffs"]] or train
    print(f"[dry-run] RL {team}: {len(pool)} train tasks, {len(held)} held-out, {groups_per_step}x{group_size} rollouts/step, lr={lr}")
    base_eval = evaluate(held, probs(), seed=99, samples=2)
    print(json.dumps({"eval": "start", "heldout_reward": round(base_eval["reward"], 3), "compliant": round(base_eval["compliant"], 3)}))
    for step in range(1, steps + 1):
        grads = {b: 0.0 for b in BEHAVIOURS}
        rewards: list[float] = []
        zero_var = 0
        tokens = 0
        for row in rng.sample(pool, groups_per_step):
            group = [rollout(row, probs(), rng) for _ in range(group_size)]
            rs = [score_world(w)["reward"] for w, _ in group]
            mean = sum(rs) / len(rs)
            zero_var += int(max(rs) == min(rs))
            rewards += rs
            for (w, dec), r in zip(group, rs):
                adv = r - mean  # GroupCentered()
                for b, ds in dec.items():
                    for a, p in ds:
                        grads[b] += adv * (a - p)  # d log Bernoulli / d logit
                        tokens += 1
        n = groups_per_step * group_size
        for b in BEHAVIOURS:
            theta[b] += lr * grads[b] / n * 8
        ckpt = f"river-dryrun://{run}/step-{step:03d}" if step % 10 == 0 or step == steps else None
        metrics = {"batch": step, "model_step": step, "reward/mean": round(sum(rewards) / n, 4), "reward/zero_variance_group_frac": round(zero_var / groups_per_step, 3), "train/updated": True, **{f"policy/p_{b}": round(v, 3) for b, v in probs().items()}}
        print(json.dumps(metrics), flush=True)
        log.log(team, step, metrics["reward/mean"], ckpt, t=2.0 + step * 1.5)
        if ckpt:
            ev = evaluate(held, probs(), seed=99, samples=2)
            print(json.dumps({"eval": f"step {step}", "heldout_reward": round(ev["reward"], 3), "compliant": round(ev["compliant"], 3), "checkpoint": ckpt}))
        if pace:
            time.sleep(pace)
    (OUT / f"rl-{team}-dryrun-policy.json").write_text(json.dumps({"step": steps, "probs": probs(), "theta": theta}, indent=2))
    save_checkpoint(f"rl-{team}-dryrun", {"team": team, "kind": "rl-dryrun", "step": steps, "probs": probs()})
    print(f"wrote {log.path.relative_to(OUT.parents[2])} ({steps} train_step events) and out/rl-{team}-dryrun-policy.json")
    print(f"tip: cp {log.path.relative_to(OUT.parents[2])} fixtures/replays/gym-{team}.jsonl  -> the Gym plays it in /?demo")


# ------------------------------------------------------------------ real River job
def real(team: str, steps: int, groups_per_step: int, group_size: int, lr: float, use_protocol: bool = False, from_base: bool = False) -> None:
    import river_client as river  # type: ignore
    from river_client import rl  # type: ignore
    from river_client.renderers import get_renderer  # type: ignore

    from .palace_env import make_env_class

    PalaceEnv = make_env_class()
    rows = rows_for(team, "train")
    client = river_client()
    base = pick_base_model(client)
    init = None if from_base else load_checkpoints().get(f"sft-{team}", {}).get("training_path")
    run = f"rl-{team}-base" if from_base or not init else f"rl-{team}"
    log = StepLogger(run, fresh=False)  # a resumed run keeps its earlier train_step events
    print(f"RL {team} on {base} from {init or 'base weights'}; {len(rows)} tasks")

    def on_step(step) -> None:
        m = step.metrics
        print(json.dumps({"batch": step.n, "model_step": step.model_step, **m}), flush=True)
        log.log(team, step.n, float(m.get("reward/mean", 0.0)))

    renderer = get_renderer(base)
    # River docs (rl-checkpoints): after a transient failure, recreate the session and trainer with the
    # same checkpoint directory and it resumes. Retry a few times on RiverError.
    for attempt in range(1, 5):
        try:
            _real_once(river, rl, client, base, renderer, PalaceEnv, rows, run, init, team, steps, groups_per_step, group_size, lr, use_protocol, log, on_step)
            return
        except river.RiverError as e:  # type: ignore[attr-defined]
            print(json.dumps({"attempt": attempt, "river_error": str(e)[:300], "action": "resume from checkpoint dir"}), flush=True)
            time.sleep(10 * attempt)
    raise SystemExit("RL gave up after 4 attempts; see log")


def _real_once(river, rl, client, base, renderer, PalaceEnv, rows, run, init, team, steps, groups_per_step, group_size, lr, use_protocol, log, on_step) -> None:
    with client.session(experiment=f"mind-palace-{run}") as session:
        model = session.create_model(base_model=base, tokenizer=renderer.tokenizer, lora=river.LoraConfig(rank=16, seed=0))
        print(json.dumps({"run": run, "model_id": model.model_id}), flush=True)
        engine = rl.RolloutEngine(
            model,
            # Local PalaceWorld by default: 64 concurrent rollouts through :8790 would flood the palace's /events.
            env=lambda: PalaceEnv(use_protocol=use_protocol),
            renderer=renderer,
            budget=rl.Budget(max_turns=14, max_generated_tokens=6144, max_context_tokens=16_384, max_turn_tokens=1024, tool_output_tokens=512),
            schedule=rl.Schedule(concurrency=64),
            temperature=1.0,
            seed=0,
        )
        trainer = rl.AsyncTrainer(
            engine=engine,
            optimizer=rl.Adam(lr=lr),
            advantage=rl.GroupCentered(),
            completion=rl.GroupCompletion(mode="wait"),
            normalize="token",
            loss="cispo",
            groups_per_step=groups_per_step,
            group_size=group_size,
            max_staleness=0,
            init_checkpoint=init,
            checkpoint=rl.Checkpointing(str(OUT.parent / "runs" / run), weights_every=5, on_signal=("SIGINT", "SIGTERM")),
            run_config={"env_version": 1, "team": team},
        )
        rl.run(trainer, rows, steps=steps, on_step=on_step)
        ck = model.save_weights(f"{run}-final", mode="inference")
        save_checkpoint(run, {"team": team, "kind": "rl", "base_model": base, "inference_path": ck.path, "step": steps})
        log.log(team, steps, 0.0 if not log.path.exists() else _last_reward(log.path), ck.path)
        print(json.dumps({"checkpoint": ck.path}))


def _last_reward(path) -> float:
    lines = [l for l in path.read_text().splitlines() if l.strip()]
    return json.loads(lines[-1])["reward"] if lines else 0.0


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--team", default="legal", choices=["legal", "finance", "eng"])
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--steps", type=int, default=None)
    ap.add_argument("--groups-per-step", type=int, default=8)
    ap.add_argument("--group-size", type=int, default=8)
    ap.add_argument("--lr", type=float, default=None)
    ap.add_argument("--pace", type=float, default=0.0, help="dry-run: seconds between steps (live Gym demo)")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--protocol", action="store_true", help="real mode: route tool calls through the protocol service (:8790)")
    ap.add_argument("--from-base", action="store_true", help="real mode: ignore the SFT checkpoint and start from base weights")
    a = ap.parse_args()
    if a.dry_run or not river_key():
        if not a.dry_run:
            print("RIVER_API_KEY not set: running --dry-run.")
        dry_run(a.team, a.steps or 30, a.groups_per_step, a.group_size, a.lr or 0.6, a.pace, a.seed)
    else:
        real(a.team, a.steps or 20, a.groups_per_step, a.group_size, a.lr or 1e-5, a.protocol, a.from_base)


if __name__ == "__main__":
    main()
