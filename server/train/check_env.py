"""Offline smoke test of the River PalaceEnv (needs river-client installed, no key, no network).

    uv sync --project server/train --extra river
    uv run --project server/train python -m server.train.check_env

Builds the rl.Env, prints the tool schemas River derives, walks the demo contract task through the
tools like a perfect agent, then like a sloppy one, and prints both rewards.
"""
from __future__ import annotations

import asyncio

from .common import DATA, read_jsonl
from .palace_env import make_env_class


class _Traj:
    messages = [{"role": "assistant", "content": ""}]


async def _run() -> None:
    import river_client as river  # type: ignore

    print("river_client", getattr(river, "__version__", "?"))
    Env = make_env_class()
    rows = read_jsonl(DATA / "legal.train.jsonl")
    row = next((r for r in rows if r["source"].startswith("replay")), rows[0])
    env = Env(use_protocol=False)
    for t in env.tools:
        spec = t.spec if isinstance(t.spec, dict) else {}
        print("tool:", spec.get("name") or spec.get("function", {}).get("name"), "args:", list((spec.get("parameters") or spec.get("function", {}).get("parameters") or {}).get("properties", {})))
    claim, visit, handoff, answer = env.tools
    msgs = await env.reset(row)
    print("task:", msgs[1]["content"].splitlines()[0])

    for s in row["stations"]:  # perfect walk
        h = next((h for h in row["expected"]["handoffs"] if h["memoryId"] == s), None)
        if h:
            await handoff(memory_id=s, to_agent=h["toAgent"], question="in budget?")
        else:
            await claim(memory_id=s)
            await visit(memory_id=s)
    await answer(text=row["expected"]["answer"], citations=row["expected"]["citations"], gaps=row["expected"]["gaps"], stale=row["expected"]["stale"])
    print("perfect walk reward:", await env.reward(_Traj(), row))

    await env.reset(row)  # sloppy: skip two stations, read finance directly, cite everything
    for s in row["stations"][1:-1]:
        await visit(memory_id=s)
    await answer(text="yes", citations=row["stations"], gaps=[], stale=[])
    print("sloppy walk reward:", await env.reward(_Traj(), row))


if __name__ == "__main__":
    asyncio.run(_run())
