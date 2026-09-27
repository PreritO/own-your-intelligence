"""GBrain write-back for Loose Ends: a human's answer becomes the real page.

    from gbrain import write_answer
    write_answer(brain_dir, memory, "Dana Whitfield (Head of Platform)", by="human:eng-lead",
                 question="Who owns the SOC 2 renewal?", judge=loci.judge)

1. patches `<brain_dir>/<memory.path>` (fixtures/seed-brain/<id>.md): fills the missing field or
   appends the answer, logs it under "## Answers", bumps `updated:` to today (pages.apply_answer);
2. pushes the new page into the ISOLATED project brain with `gbrain put` (cli.GBrain).

Reset everything with `python server/gbrain/reset.py` (git checkout of fixtures/seed-brain, re-put of
the reverted pages, Loose Ends state and outbox cleared). See NOTES-loose-ends.md.
"""

from __future__ import annotations

import datetime as _dt
import os
from pathlib import Path
from typing import Callable

from .cli import GBrain
from .pages import Patch, apply_answer, clean_answer

__all__ = ["GBrain", "Patch", "apply_answer", "clean_answer", "today", "write_answer"]


def today() -> str:
    """Local date, or MP_TODAY (tests / a pinned demo date)."""
    return os.environ.get("MP_TODAY") or _dt.date.today().isoformat()


def write_answer(
    brain_dir: Path | str,
    memory: dict,
    answer: str,
    *,
    by: str,
    question: str | None = None,
    judge: Callable[[dict], tuple[str, str | None]] | None = None,
    gbrain: GBrain | None = None,
    sync: bool = True,
    day: str | None = None,
) -> dict:
    """-> {path, created, change, strategy, updated, gbrain: {status, ...}}. Raises ValueError on an empty answer."""
    brain_dir = Path(brain_dir)
    rel = memory.get("path") or f"{memory['id']}.md"
    path = (brain_dir / rel).resolve()
    if brain_dir.resolve() not in path.parents:
        raise ValueError(f"page path escapes the brain dir: {rel}")
    created = not path.exists()
    old = "" if created else path.read_text("utf8")
    day = day or today()
    patch = apply_answer(old, answer, day=day, by=by, question=question, title=memory.get("title"), judge=judge)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(patch.text, "utf8")
    out = {"path": str(path), "created": created, "change": patch.change, "strategy": patch.strategy, "updated": day}
    if sync:
        out["gbrain"] = (gbrain or GBrain()).put(memory["id"], patch.text, verify_text=clean_answer(answer)[:60])
    else:
        out["gbrain"] = {"status": "skipped", "reason": "gbrain sync disabled for this brain dir"}
    return out
