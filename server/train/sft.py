"""Weight rack: one LoRA specialist per team (SFT on that team's verified runs).

    python -m server.train.sft --dry-run              # validate datasets + print the plan, no River calls
    python -m server.train.sft [--team legal] [--steps 30]

Follows docs.river.ai/guides/sft: input = system (loci protocol + station catalog) + task,
target = the correct route, handoffs, citations, gaps and cited answer as JSON. Loss is masked to
the completion. Each team's adapter is saved twice: mode="inference" (served / eval / plates on
the rack) and mode="training" (RL starts from it). Paths go to server/train/out/checkpoints.json.
After saving, a quick held-out check scores the checkpoint with the Gym reward and posts it as a
train_step (with the checkpoint path, so the Gym adds a plate to the team's rack).
"""
from __future__ import annotations

import argparse
import json
import random
import time

from .common import DATA, OUT, TEAMS, StepLogger, pick_base_model, read_jsonl, river_client, river_key, save_checkpoint
from .palace_env import parse_plan, score_plan


def rows_for(team: str, split: str) -> list[dict]:
    p = DATA / f"{team}.{split}.jsonl"
    if not p.exists():
        raise SystemExit("No datasets yet: python -m server.train.trajectories")
    return read_jsonl(p)


def load_tok(base: str):
    try:
        import river_client as river  # type: ignore
        return river.load_tokenizer(base_model=base)
    except Exception:
        from transformers import AutoTokenizer  # type: ignore
        return AutoTokenizer.from_pretrained(base)


def make_datum(tok, row: dict) -> dict:
    msgs = row["messages"]
    try:
        prompt = tok.apply_chat_template(msgs[:2], tokenize=False, add_generation_prompt=True, enable_thinking=False)
    except TypeError:
        prompt = tok.apply_chat_template(msgs[:2], tokenize=False, add_generation_prompt=True)
    prompt_ids = tok(prompt, add_special_tokens=False)["input_ids"]
    completion_ids = tok(msgs[2]["content"], add_special_tokens=False)["input_ids"] + [tok.eos_token_id]
    ids = prompt_ids + completion_ids
    return {
        "input_ids": ids,
        "target_tokens": ids[1:] + [tok.eos_token_id],
        "weights": [0.0] * (len(prompt_ids) - 1) + [1.0] * (len(completion_ids) + 1),
    }


def _content(result) -> str:
    body = getattr(result, "response_json", result)
    if isinstance(body, (str, bytes)):
        try:
            body = json.loads(body)
        except json.JSONDecodeError:
            return str(body)
    try:
        return body["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        return str(body)


def dry_run(teams: list[str], steps: int, batch: int) -> None:
    print(f"[dry-run] SFT plan: LoRA rank 16, {steps} steps x batch {batch}, lr 2e-4, loss=cross_entropy (completion-masked)")
    for team in teams:
        tr, ho = rows_for(team, "train"), rows_for(team, "heldout")
        chars_p = sum(len(r["messages"][0]["content"]) + len(r["messages"][1]["content"]) for r in tr) / len(tr)
        chars_c = sum(len(r["messages"][2]["content"]) for r in tr) / len(tr)
        bad = [r["id"] for r in tr if not parse_plan(r["messages"][2]["content"])]
        oracle = sum(score_plan(r, parse_plan(r["messages"][2]["content"]))["reward"] for r in ho) / len(ho)
        print(f"  {team:8} train={len(tr):4} heldout={len(ho):3} ~prompt {chars_p / 4:.0f} tok, ~target {chars_c / 4:.0f} tok, "
              f"unparseable targets={len(bad)}, target plans score {oracle:.3f} on held-out (ceiling check)")
    print("  checkpoints -> out/checkpoints.json as sft-<team> {inference_path, training_path}")


def train_team(client, base: str, team: str, steps: int, batch: int, lr: float, rank: int, log: StepLogger) -> None:
    import river_client as river  # type: ignore

    tok = load_tok(base)
    train = rows_for(team, "train")
    data = [make_datum(tok, r) for r in train]
    rng = random.Random(0)
    with client.session(project=f"mind-palace-sft-{team}") as session:
        model = session.create_model(base_model=base, lora=river.LoraConfig(rank=rank))
        print(f"[{team}] model_id={model.model_id} base={base} examples={len(data)}", flush=True)
        for step in range(1, steps + 1):
            mb = rng.sample(data, min(batch, len(data)))
            fb = model.forward_backward(mb, loss_fn="cross_entropy")
            model.optim_step(lr=lr, grad_clip_norm=1.0)
            print(json.dumps({"team": team, "step": model.step, "loss": round(fb.metrics["loss"], 4)}), flush=True)
        inf = model.save_weights(f"sft-{team}", mode="inference")
        trn = model.save_weights(f"sft-{team}-train", mode="training")
        info = {"team": team, "kind": "sft", "base_model": base, "inference_path": inf.path, "training_path": trn.path, "steps": steps, "savedAt": time.strftime("%H:%M:%S")}
        save_checkpoint(f"sft-{team}", info)
        print(json.dumps({"team": team, "saved": inf.path}), flush=True)
    # quick held-out check with the Gym reward
    rows = rows_for(team, "heldout")[:10]
    rs = []
    for r in rows:
        try:
            text = _content(client.chat_complete_from_checkpoint(r["messages"][:2], checkpoint_path=inf.path, base_model=base, max_tokens=1024, temperature=0.0, chat_template_kwargs={"enable_thinking": False}))
        except Exception as e:
            text = f"error: {e}"
        rs.append(score_plan(r, parse_plan(text))["reward"])
    mean = sum(rs) / max(len(rs), 1)
    log.log(team, steps, mean, inf.path)
    print(json.dumps({"team": team, "heldout10_reward": round(mean, 3), "checkpoint": inf.path}), flush=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--team", choices=TEAMS, help="default: all three")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--steps", type=int, default=30)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--rank", type=int, default=16)
    a = ap.parse_args()
    teams = [a.team] if a.team else list(TEAMS)
    if a.dry_run or not river_key():
        if not a.dry_run:
            print("RIVER_API_KEY not set: running --dry-run.")
        dry_run(teams, a.steps, a.batch)
        return
    client = river_client()
    base = pick_base_model(client)
    print(f"River healthy={client.health_check()} base={base}")
    log = StepLogger("sft")
    for team in teams:
        train_team(client, base, team, a.steps, a.batch, a.lr, a.rank, log)
    print(f"checkpoints: {OUT / 'checkpoints.json'}")


if __name__ == "__main__":
    main()
