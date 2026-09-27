"""Per-agent improvement ladder: base Qwen -> SFT generations -> RL on the grounding judge, promoted by a gate.

    python -m server.train.flywheel questions --team eng        # Claude-written handoff questions per page (+ held-out split)
    python -m server.train.flywheel distill --team eng          # grounded replies distilled from verified runs (SFT rows)
    python -m server.train.flywheel sft --team eng --gen 1      # reply-format LoRA SFT on River (saves inference + training)
    python -m server.train.flywheel rl --team legal --gen 3 --init 2 --steps 20   # GRPO, reward = grounding judge
    python -m server.train.flywheel bench --team eng --keys base,gen1,claude
    python -m server.train.flywheel board                       # fixtures/gym-scoreboard.json with the promotion gate

Generations (per team): 0 = base Qwen3.5-9B on River (the starting incumbent). Legal 1 = the route-plan SFT from
the training workspace (sft-legal). Then reply-format SFT generations, then RL generations. A generation is
**promoted** only if it beats the incumbent's held-out `grounded` and loses at most 2 points of `correct`.
serve.py serves each team's highest promoted generation.

Held-out: Legal uses serve.EVAL_SET (20 hand-written questions). Training questions on the same pages are
dropped when they share an expected fact or most of their words with a held-out question. Eng and Sales hold out
whole pages (sha1 order) until 20 answerable questions. Training never sees them. Question files are committed
under server/train/bench/ so every number can be reproduced.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from .common import FIXTURES, OUT, TRAIN_DIR, StepLogger, river_client
from .serve import (
    BRAIN,
    CLAUDE_MODEL,
    EVAL_SET,
    QWEN,
    SCOREBOARD,
    _replay_handoffs,
    build_messages,
    call_base,
    call_checkpoint,
    call_claude,
    correct,
    ground,
    palace_verdict,
    plain,
    quote_in_page,
    read_page,
)

BENCH = TRAIN_DIR / "bench"  # committed: questions + held-out split
LADDER = OUT / "ladder"  # gitignored: SFT rows, job records, bench results
LADDER_TEAMS = ("legal", "eng", "sales")
HELDOUT_N = 20

# Generation 1 for Legal predates this file: the route-plan SFT from NOTES-training.md.
LEGACY = {
    ("legal", 1): {
        "jobId": "50692a37-0f22-4aa7-b1f6-903fbd180ffe:model:1",
        "inference_path": "river://6932ec36-6bda-43e0-b9a9-4f576919f06a/sampler_weights/sft-legal",
        "training_path": "river://6932ec36-6bda-43e0-b9a9-4f576919f06a/weights/sft-legal-train",
        "trainedOn": "270 route-plan examples (palace tasks + replays), 30 steps",
        "recipe": "sft-route-plan",
    },
}


def team_pages(team: str) -> list[str]:
    return [f"{team}/{p.stem}" for p in sorted((BRAIN / team).glob("*.md"))]


def _read_jsonl(p: Path) -> list[dict]:
    return [json.loads(l) for l in p.read_text().splitlines() if l.strip()] if p.exists() else []


def _write_jsonl(p: Path, rows: list[dict]) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))


def _parse_json(text: str) -> Any:
    s, e = text.find("{"), text.rfind("}")
    if s < 0 or e <= s:
        return None
    try:
        return json.loads(text[s : e + 1])
    except ValueError:
        return None


# ---------------------------------------------------------------- questions

QGEN_SYSTEM = "You write evaluation questions for a company knowledge base. Reply with JSON only."
QGEN_USER = """Page {pid} ("{title}", owned by the {team} team at Acme Robotics):
<page>
{body}
</page>

Write 6 different questions that another team's agent might hand to the {team} agent, each answered by this page
(vary them: numbers, names, dates, rules, status, who/what/when). For each, give "expected" (a short answer) and
"facts": 1-3 groups; each group is a list of 1-3 alternative short strings (1-4 words, lowercase) that any correct
answer must contain. The FIRST alternative of every group must be copied exactly from the page text.
Then write 1 question on a related topic that this page does NOT answer, marked "unanswerable": true.
Return {{"questions": [{{"q": "...", "expected": "...", "facts": [["..."]]}}, ..., {{"q": "...", "unanswerable": true}}]}}"""


def _gen_page_questions(team: str, pid: str) -> list[dict]:
    title, body = read_page(pid)
    try:
        raw = _parse_json(call_claude([{"role": "system", "content": QGEN_SYSTEM}, {"role": "user", "content": QGEN_USER.format(pid=pid, title=title, team=team.title(), body=body[:3000])}], timeout=60))
    except Exception as e:
        print(f"qgen {pid}: {e}", file=sys.stderr)
        return []
    page_plain = plain(body)
    out = []
    for q in (raw or {}).get("questions", []):
        if not isinstance(q, dict) or not isinstance(q.get("q"), str):
            continue
        if q.get("unanswerable"):
            out.append({"page": pid, "q": q["q"].strip(), "unanswerable": True})
            continue
        facts = [[str(a).lower().strip() for a in g if str(a).strip()] for g in q.get("facts") or [] if isinstance(g, list)]
        facts = [g for g in facts if g]
        if facts and all(plain(g[0]) in page_plain for g in facts):  # first alternative verbatim from the page
            out.append({"page": pid, "q": q["q"].strip(), "expected": str(q.get("expected", "")), "facts": facts})
    return out


def _toks(s: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", s.lower()) if len(w) > 2}


def _too_close_to_heldout(item: dict, heldout: list[dict]) -> bool:
    for h in heldout:
        if h["page"] != item["page"]:
            continue
        a, b = _toks(item["q"]), _toks(h["q"])
        if a and b and len(a & b) / len(a | b) > 0.5:
            return True
        alts = {plain(x) for g in h["facts"] for x in g}
        if any(plain(x) in alts for g in item.get("facts", []) for x in g):
            return True
    return False


def questions(team: str, refresh: bool = False) -> tuple[list[dict], list[dict]]:
    """-> (train, heldout). Cached in server/train/bench/<team>.questions.jsonl (committed)."""
    path = BENCH / f"{team}.questions.jsonl"
    rows = [] if refresh else _read_jsonl(path)
    if not rows:
        with ThreadPoolExecutor(6) as ex:
            for qs in ex.map(lambda pid: _gen_page_questions(team, pid), team_pages(team)):
                rows += qs
        if team == "legal":
            held = [{"page": r["page"], "q": r["q"], "expected": r["expected"], "facts": r["facts"], "split": "heldout"} for r in EVAL_SET]
            train = [dict(r, split="train") for r in rows if not _too_close_to_heldout(r, held)]
            dropped = len(rows) - len(train)
            print(f"legal: dropped {dropped} generated questions too close to the 20 held-out ones", file=sys.stderr)
            rows = held + train
        else:
            order = sorted(team_pages(team), key=lambda p: hashlib.sha1(p.encode()).hexdigest())
            held_pages: list[str] = []
            n = 0
            for p in order:
                k = sum(1 for r in rows if r["page"] == p and not r.get("unanswerable"))
                if k == 0:
                    continue
                held_pages.append(p)
                n += k
                if n >= HELDOUT_N:
                    break
            answerable_held = [r for r in rows if r["page"] in held_pages and not r.get("unanswerable")][:HELDOUT_N]
            keep = {id(r) for r in answerable_held}
            rows = [dict(r, split="heldout" if id(r) in keep else ("excluded" if r["page"] in held_pages else "train")) for r in rows]
        _write_jsonl(path, rows)
    return [r for r in rows if r["split"] == "train"], [r for r in rows if r["split"] == "heldout"]


# ---------------------------------------------------------------- distillation (verified runs -> SFT rows)


def _is_gap_reply(reply: str, body: str) -> bool:
    g = ground(reply, body)
    return "doesn't say" in reply.lower().replace("’", "'") and g["supported"] == 0 and g["unsupported"] == 0


def _distill_one(team: str, item: dict) -> dict | None:
    title, body = read_page(item["page"])
    msgs = build_messages(team, item["q"], item["page"], title, body, palace_verdict(item["page"]))
    try:
        target = call_claude(msgs)
    except Exception as e:
        print(f"distill {item['page']}: {e}", file=sys.stderr)
        return None
    if item.get("unanswerable"):
        ok = _is_gap_reply(target, body)
    elif item.get("facts"):
        ok = ground(target, body)["grounded"] and correct(target, item["facts"])
    else:  # replayed handoff: no expected facts, grounding only
        ok = ground(target, body)["grounded"]
    if not ok:
        return None
    return {"source": item.get("source", "questions"), "page": item["page"], "q": item["q"], "messages": msgs + [{"role": "assistant", "content": target}]}


def distill(team: str, refresh: bool = False) -> list[dict]:
    """SFT rows = Claude replies that passed claim-level grounding (and the expected facts), from:
    the team's train questions (incl. unanswerable -> "The page doesn't say."), the team's replayed handoffs
    (fixtures/replays), and the shared generic pool of other departments' pages. Held-out questions never appear."""
    path = LADDER / f"{team}.sft.jsonl"
    if path.exists() and not refresh:
        return _read_jsonl(path)
    train, held = questions(team)
    held_q = {h["q"] for h in held}
    items = [dict(r, source="questions") for r in train]
    items += [i for i in _replay_handoffs(team) if (BRAIN / f"{i['page']}.md").exists() and i["q"] not in held_q]
    with ThreadPoolExecutor(6) as ex:
        rows = [r for r in ex.map(lambda it: _distill_one(team, it), items) if r]
    # Generic pool (serve.py sft, Legal's first reply-SFT build): other departments' pages only.
    pool = _read_jsonl(OUT / "reply-sft-legal.jsonl")
    rows += [dict(r, source="generic") for r in pool if r.get("source") == "generic" and not r["page"].startswith(f"{team}/")]
    _write_jsonl(path, rows)
    by = {}
    for r in rows:
        by[r["source"]] = by.get(r["source"], 0) + 1
    print(json.dumps({"team": team, "sft_rows": len(rows), "by_source": by, "candidates": len(items)}), flush=True)
    return rows


# ---------------------------------------------------------------- generation records


def gen_path(team: str, gen: int) -> Path:
    return LADDER / f"{team}-gen{gen}.json"


def gen_info(team: str, gen: int) -> dict:
    if (team, gen) in LEGACY:
        return dict(LEGACY[(team, gen)])
    p = gen_path(team, gen)
    return json.loads(p.read_text()) if p.exists() else {}


def _save_gen(team: str, gen: int, info: dict) -> None:
    LADDER.mkdir(parents=True, exist_ok=True)
    gen_path(team, gen).write_text(json.dumps(info, indent=2))


# ---------------------------------------------------------------- SFT


def sft(team: str, gen: int, steps: int, batch: int, lr: float, rank: int, init_gen: int | None = None) -> None:
    import river_client as river  # type: ignore

    from .sft import load_tok, make_datum

    rows = distill(team)
    tok = load_tok(QWEN)
    data = [make_datum(tok, r) for r in rows]
    data += [make_datum(tok, r) for r in rows if r["source"] not in ("generic", "questions")]  # real runs count twice
    by = {}
    for r in rows:
        by[r["source"]] = by.get(r["source"], 0) + 1
    trained_on = f"{len(rows)} grounded replies ({', '.join(f'{v} {k}' for k, v in sorted(by.items()))}), {steps} steps"
    client = river_client()
    rng = random.Random(gen)
    with client.session(project=f"mind-palace-ladder-{team}-gen{gen}") as session:
        model = session.create_model(base_model=QWEN, lora=river.LoraConfig(rank=rank))
        init = gen_info(team, init_gen).get("training_path") if init_gen else None
        if init:
            model.load_weights(init, load_optimizer=False)
        info = {"team": team, "generation": gen, "recipe": "sft-reply", "jobId": model.model_id, "base_model": QWEN, "init": init, "trainedOn": trained_on, "status": "training", "steps": steps, "losses": []}
        _save_gen(team, gen, info)
        print(json.dumps({"team": team, "gen": gen, "job": model.model_id, "examples": len(data)}), flush=True)
        for _ in range(steps):
            fb = model.forward_backward(rng.sample(data, min(batch, len(data))), loss_fn="cross_entropy")
            model.optim_step(lr=lr, grad_clip_norm=1.0)
            info["losses"].append(round(fb.metrics["loss"], 4))
            print(json.dumps({"team": team, "gen": gen, "step": model.step, "loss": info["losses"][-1]}), flush=True)
        name = f"ladder-{team}-gen{gen}"
        info["inference_path"] = model.save_weights(name, mode="inference").path
        info["training_path"] = model.save_weights(f"{name}-train", mode="training").path
        info.update(status="done", savedAt=time.strftime("%H:%M:%S"))
        _save_gen(team, gen, info)
        print(json.dumps({"team": team, "gen": gen, "saved": info["inference_path"]}), flush=True)


# ---------------------------------------------------------------- RL on the grounding judge


def grounding_reward(reply: str, item: dict, body: str) -> float:
    """The grounding judge as a reward. Page silent (unanswerable): a stated gap +0.5, any content -1 (invented).
    Page answers: +0.5 x share of supported claims, -1 x share of unsupported claims, +0.5 if the expected facts
    are there; a false "doesn't say" is -0.5."""
    g = ground(reply, body)
    gap_stated = "doesn't say" in reply.lower().replace("’", "'")
    if item.get("unanswerable"):
        return 0.5 if gap_stated and g["supported"] == 0 and g["unsupported"] == 0 else -1.0
    n = g["supported"] + g["unsupported"]
    if n == 0:
        return -0.5 if gap_stated else -1.0
    r = 0.5 * g["supported"] / n - 1.0 * g["unsupported"] / n
    if item.get("facts") and correct(reply, item["facts"]):
        r += 0.5
    return r


def rl(team: str, gen: int, init_gen: int, steps: int, groups: int, group_size: int, lr: float) -> None:
    import river_client as river  # type: ignore

    from .sft import load_tok

    train, _ = questions(team)
    items = train + [dict(i, source="replay") for i in _replay_handoffs(team) if (BRAIN / f"{i['page']}.md").exists()]
    init = gen_info(team, init_gen).get("training_path")
    if not init:
        raise SystemExit(f"{team} gen{init_gen} has no training weights")
    tok = load_tok(QWEN)
    pages = {i["page"]: read_page(i["page"]) for i in items}

    def prompt(i: dict) -> tuple[list[int], str]:
        title, body = pages[i["page"]]
        msgs = build_messages(team, i["q"], i["page"], title, body, palace_verdict(i["page"]))
        text = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False)
        return tok(text, add_special_tokens=False)["input_ids"], body

    run = f"rl-{team}-grounding-gen{gen}"
    log = StepLogger(run)
    rng = random.Random(gen)
    client = river_client()
    with client.session(project=f"mind-palace-ladder-{team}-gen{gen}") as session:
        model = session.create_model(base_model=QWEN, lora=river.LoraConfig(rank=16))
        model.load_weights(init, load_optimizer=False)
        info = {"team": team, "generation": gen, "recipe": "rl-grounding", "jobId": model.model_id, "base_model": QWEN, "init": init,
                "trainedOn": f"GRPO {steps} steps x {groups}x{group_size} rollouts on {len(items)} train questions, reward = grounding judge",
                "status": "training", "steps": steps, "rewards": []}
        _save_gen(team, gen, info)
        print(json.dumps({"team": team, "gen": gen, "job": model.model_id, "init": init, "items": len(items)}), flush=True)
        for step in range(1, steps + 1):
            t0 = time.time()
            batch_items = rng.sample(items, groups)
            prompts = [prompt(i) for i in batch_items]
            outs = model.sample(prompt_token_ids=[p for p, _ in prompts], num_samples=group_size, max_tokens=160, temperature=1.0, top_p=1.0, top_k=-1, seed=step)
            batch, rewards, tokens, zero_var = [], [], 0, 0
            for it, (pid, body), group in zip(batch_items, prompts, outs):
                rs = [grounding_reward(s.text, it, body) for s in group]
                rewards += rs
                mean = sum(rs) / len(rs)
                if max(rs) - min(rs) < 1e-9:
                    zero_var += 1
                    continue
                for s, r in zip(group, rs):
                    if not s.tokens or len(s.tokens) != len(s.logprobs):
                        continue
                    ids = pid + list(s.tokens)
                    batch.append({
                        "input_ids": ids,
                        "attention_mask": [1] * len(ids),
                        "old_logprobs": [0.0] * (len(pid) - 1) + list(s.logprobs) + [0.0],
                        "advantages": [0.0] * (len(pid) - 1) + [r - mean] * len(s.tokens) + [0.0],
                    })
                    tokens += len(s.tokens)
            if batch:  # same recipe as rl.py --simple: token-mean folded into advantages, plain optim_step
                for d in batch:
                    d["advantages"] = [x / max(tokens, 1) for x in d["advantages"]]
                for start in range(0, len(batch), 8):
                    model.forward_backward(batch[start : start + 8], loss_fn="importance_sampling", zero_out=(start == 0))
                model.optim_step(lr=lr, grad_clip_norm=1.0)
            mean_r = sum(rewards) / max(len(rewards), 1)
            info["rewards"].append(round(mean_r, 4))
            ckpt = None
            if step == steps:
                ckpt = model.save_weights(f"ladder-{team}-gen{gen}", mode="inference").path
                info["inference_path"] = ckpt
            _save_gen(team, gen, info)
            log.log(team, step, mean_r, ckpt)
            print(json.dumps({"team": team, "gen": gen, "step": step, "reward/mean": round(mean_r, 4), "zero_var_groups": zero_var, "updated": bool(batch), "tokens": tokens, "secs": round(time.time() - t0, 1)}), flush=True)
        info.update(status="done", savedAt=time.strftime("%H:%M:%S"))
        _save_gen(team, gen, info)


# ---------------------------------------------------------------- bench


def _runner(team: str, key: str):
    if key == "base":
        return f"Base {QWEN.split('/')[-1]} (River, no fine-tune)", lambda m: call_base(m)
    if key == "claude":
        return f"Claude ({CLAUDE_MODEL})", call_claude
    gen = int(key.removeprefix("gen"))
    info = gen_info(team, gen)
    if not info.get("inference_path"):
        raise SystemExit(f"{team} {key}: no checkpoint yet")
    recipe = {"sft-route-plan": "route-plan SFT", "sft-reply": "reply SFT", "rl-grounding": "RL on grounding"}.get(info.get("recipe", ""), info.get("recipe", ""))
    return f"{team.title()} gen {gen} (River {recipe}, Qwen3.5-9B)", lambda m, p=info["inference_path"]: call_checkpoint(m, p)


def bench(team: str, keys: list[str], show: int = 0) -> list[dict]:
    _, held = questions(team)
    out = []
    for key in keys:
        label, fn = _runner(team, key)
        rows = []
        for i, item in enumerate(held):
            title, body = read_page(item["page"])
            msgs = build_messages(team, item["q"], item["page"], title, body, palace_verdict(item["page"]))
            t0 = time.time()
            try:
                text = fn(msgs)
            except Exception as e:
                text = f"error: {type(e).__name__}: {e}"[:200]
            ms = (time.time() - t0) * 1000
            g = ground(text, body)
            ok = correct(text, item["facts"])
            ext = bool(g["claims"]) and all(c["status"] != "unsupported" or quote_in_page(c["text"].rstrip("."), plain(body)) for c in g["claims"])
            rows.append({"page": item["page"], "q": item["q"], "grounded": g["grounded"], "correct": ok, "extractive": ext, "ms": round(ms), "reply": text})
            if i < show or (show < 0 and not (g["grounded"] and ok)):
                print(f"--- {team} {key} #{i} {item['page']}: {item['q']}\n    {text[:300]!r}\n    grounded={g['grounded']} correct={ok}", flush=True)
        n = len(rows)
        lat = sorted(r["ms"] for r in rows)
        res = {"team": team, "key": key, "model": label, "n": n,
               "grounded": round(sum(r["grounded"] for r in rows) / n, 3),
               "correct": round(sum(r["correct"] for r in rows) / n, 3),
               "extractive": round(sum(r["extractive"] for r in rows) / n, 3),
               "latency_ms": lat[n // 2], "benchedAt": time.strftime("%Y-%m-%dT%H:%M:%S")}
        LADDER.mkdir(parents=True, exist_ok=True)
        (LADDER / f"bench-{team}-{key}.json").write_text(json.dumps({"summary": res, "rows": rows}, indent=2))
        print(json.dumps(res), flush=True)
        out.append(res)
    return out


# ---------------------------------------------------------------- scoreboard + promotion gate


def ladder_rows(team: str) -> list[dict]:
    rows = []
    for p in sorted(LADDER.glob(f"bench-{team}-*.json")):
        s = json.loads(p.read_text())["summary"]
        key = s["key"]
        gen = 0 if key == "base" else (None if key == "claude" else int(key.removeprefix("gen")))
        info = gen_info(team, gen) if gen else {}
        row = {"team": team, "key": key, "generation": gen, "model": s["model"], "n": s["n"], "grounded": s["grounded"], "correct": s["correct"], "latency_ms": s["latency_ms"],
               "jobId": info.get("jobId"), "checkpoint": info.get("inference_path"), "trainedOn": info.get("trainedOn") if gen else ("frontier reference, not trained" if key == "claude" else "none (base weights)")}
        rows.append(row)
    benched = {r["generation"] for r in rows}
    for p in sorted(LADDER.glob(f"{team}-gen*.json")):  # generations still training: no numbers yet
        info = json.loads(p.read_text())
        if info.get("generation") not in benched:
            rows.append({"team": team, "key": f"gen{info['generation']}", "generation": info["generation"], "model": f"{team.title()} gen {info['generation']} (River {info.get('recipe', '')}, Qwen3.5-9B)",
                         "status": info.get("status", "training"), "jobId": info.get("jobId"), "checkpoint": info.get("inference_path"), "trainedOn": info.get("trainedOn"),
                         "n": None, "grounded": None, "correct": None, "latency_ms": None, "promoted": None, "note": "not benched yet"})
    trained = sorted((r for r in rows if r["generation"] is not None and r.get("grounded") is not None), key=lambda r: r["generation"])
    inc = None
    for r in trained:
        if r["generation"] == 0:
            r.update(promoted=True, note="starting incumbent")
            inc = r
            continue
        if inc is None:
            r.update(promoted=False, note="no incumbent benched")
            continue
        dg, dc = r["grounded"] - inc["grounded"], r["correct"] - inc["correct"]
        win = dg > 0 and dc >= -0.02
        r["promoted"] = win
        r["note"] = (f"promoted over gen {inc['generation']}: grounded {dg:+.2f}, correct {dc:+.2f}" if win
                     else f"rejected vs gen {inc['generation']}: grounded {dg:+.2f}, correct {dc:+.2f}" + (" (regression)" if dg < 0 else ""))
        if win:
            inc = r
    for r in rows:
        if r["key"] == "claude":
            r.update(promoted=None, note="reference line (Claude, not a River generation)")
    return sorted(rows, key=lambda r: (r["generation"] is None, r["generation"] or 0))


def board() -> dict:
    rows = []
    for team in LADDER_TEAMS:
        rows += ladder_rows(team)
    doc = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "task": "department handoff replies, held-out questions per team",
        "metric": "grounded = every claim carries a verbatim quote from the page (claim-level judge); correct = expected facts present; latency_ms = p50 per reply",
        "promotionRule": "a generation is promoted only if it beats the incumbent's held-out grounded and loses at most 2 points of correct",
        "rows": rows,
    }
    SCOREBOARD.write_text(json.dumps(doc, indent=2) + "\n")
    print(f"{'team':6} {'gen':>3} {'model':52} {'n':>3} {'grounded':>9} {'correct':>8} {'p50 ms':>7}  promoted")
    for r in rows:
        g = "-" if r["generation"] is None else r["generation"]
        if r["grounded"] is None:
            print(f"{r['team']:6} {g:>3} {r['model'][:52]:52}   -         -        -        -  {r.get('status')} job {r.get('jobId')}")
            continue
        print(f"{r['team']:6} {g:>3} {r['model'][:52]:52} {r['n']:>3} {100 * r['grounded']:>8.0f}% {100 * r['correct']:>7.0f}% {r['latency_ms']:>7}  {r['promoted']}  {r.get('note', '')}")
    print(f"wrote {SCOREBOARD.relative_to(FIXTURES.parent)}")
    return doc


def promoted_generation(team: str) -> dict | None:
    """Highest promoted River generation for `team` from the committed scoreboard (what serve.py serves)."""
    try:
        rows = json.loads(SCOREBOARD.read_text()).get("rows", [])
    except (OSError, ValueError):
        return None
    best = [r for r in rows if r.get("team") == team and r.get("promoted") and r.get("generation") is not None]
    return max(best, key=lambda r: r["generation"]) if best else None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    q = sub.add_parser("questions")
    q.add_argument("--team", required=True)
    q.add_argument("--refresh", action="store_true")
    d = sub.add_parser("distill")
    d.add_argument("--team", required=True)
    d.add_argument("--refresh", action="store_true")
    s = sub.add_parser("sft")
    s.add_argument("--team", required=True)
    s.add_argument("--gen", type=int, required=True)
    s.add_argument("--init", type=int, default=None, help="start from this generation's training weights")
    s.add_argument("--steps", type=int, default=30)
    s.add_argument("--batch", type=int, default=16)
    s.add_argument("--lr", type=float, default=2e-4)
    s.add_argument("--rank", type=int, default=16)
    r = sub.add_parser("rl")
    r.add_argument("--team", required=True)
    r.add_argument("--gen", type=int, required=True)
    r.add_argument("--init", type=int, required=True)
    r.add_argument("--steps", type=int, default=20)
    r.add_argument("--groups", type=int, default=8)
    r.add_argument("--group-size", type=int, default=8)
    r.add_argument("--lr", type=float, default=2e-5)
    b = sub.add_parser("bench")
    b.add_argument("--team", required=True)
    b.add_argument("--keys", default="base,claude")
    b.add_argument("--show", type=int, default=0)
    sub.add_parser("board")
    a = ap.parse_args()
    if a.cmd == "questions":
        tr, ho = questions(a.team, a.refresh)
        print(json.dumps({"team": a.team, "train": len(tr), "heldout": len(ho), "unanswerable_train": sum(1 for x in tr if x.get("unanswerable")), "heldout_pages": sorted({x["page"] for x in ho})}))
    elif a.cmd == "distill":
        distill(a.team, a.refresh)
    elif a.cmd == "sft":
        sft(a.team, a.gen, a.steps, a.batch, a.lr, a.rank, a.init)
    elif a.cmd == "rl":
        rl(a.team, a.gen, a.init, a.steps, a.groups, a.group_size, a.lr)
    elif a.cmd == "bench":
        bench(a.team, [k.strip() for k in a.keys.split(",") if k.strip()], a.show)
    elif a.cmd == "board":
        board()


if __name__ == "__main__":
    main()
