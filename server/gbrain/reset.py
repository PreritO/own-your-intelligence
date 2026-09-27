"""Undo Loose End write-backs: seed-brain pages, the isolated GBrain, the inbox, outbox and overlay.

    python server/gbrain/reset.py            # revert pages that carry a Loose Ends answer
    python server/gbrain/reset.py --all      # git checkout -- fixtures/seed-brain (every local edit!)
    python server/gbrain/reset.py --dry-run  # say what would happen

(requested as `bun run reset-brain`; see NOTES-loose-ends.md). A running protocol service keeps its
inbox in memory, so reset through it instead: `curl -XPOST localhost:8790/loose-ends/reset -d '{"brain":true}'`.

Only pages whose working copy contains the write-back marker ("via Loose Ends") are reverted by
default, so a seed author's uncommitted edits survive. Reverted pages are re-put into the isolated
brain so GBrain matches the files again. Pages the write-back created (no git history) are deleted.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from gbrain.cli import GBrain  # type: ignore
else:
    from .cli import GBrain

REPO = Path(__file__).resolve().parents[2]
SEED = "fixtures/seed-brain"
MARKER = "via Loose Ends"
PROTOCOL = REPO / "server" / "protocol"
DEFAULTS = {"state_dir": PROTOCOL / ".loose-ends", "outbox_dir": PROTOCOL / ".outbox", "overlay_dir": PROTOCOL / ".overlay"}


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, check=True).stdout


def changed_pages(repo: Path = REPO, all_edits: bool = False) -> tuple[list[str], list[str]]:
    """-> (modified tracked pages to revert, untracked pages the write-back created)."""
    modified = [p for p in _git(repo, "diff", "--name-only", "--", SEED).splitlines() if p.endswith(".md")]
    untracked = [p for p in _git(repo, "ls-files", "--others", "--exclude-standard", "--", SEED).splitlines() if p.endswith(".md")]
    marked = lambda p: (repo / p).exists() and MARKER in (repo / p).read_text("utf8")  # noqa: E731
    if not all_edits:
        modified = [p for p in modified if marked(p)]
    return modified, [p for p in untracked if marked(p)]


def reset_brain(
    repo: Path = REPO,
    *,
    all_edits: bool = False,
    dry_run: bool = False,
    gbrain: GBrain | None = None,
    state_dir: Path | None = None,
    outbox_dir: Path | None = None,
    overlay_dir: Path | None = None,
    sync: bool = True,
) -> dict:
    modified, created = changed_pages(repo, all_edits)
    dirs = {
        "state_dir": Path(state_dir or DEFAULTS["state_dir"]),
        "outbox_dir": Path(outbox_dir or DEFAULTS["outbox_dir"]),
        "overlay_dir": Path(overlay_dir or DEFAULTS["overlay_dir"]),
    }
    out: dict = {"reverted": modified, "deleted": created, "cleared": [str(d) for d in dirs.values() if d.exists()], "gbrain": []}
    if dry_run:
        return out
    if modified:
        _git(repo, "checkout", "--", *modified)
    for p in created:
        (repo / p).unlink(missing_ok=True)
    for d in dirs.values():
        if d.exists():
            shutil.rmtree(d)
    if sync and modified:
        g = gbrain or GBrain(home=repo)
        for p in modified:
            slug = p[len(SEED) + 1 : -3]
            out["gbrain"].append({"slug": slug, **g.put(slug, (repo / p).read_text("utf8"))})
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--all", action="store_true", help="git checkout the whole fixtures/seed-brain (discards every local edit)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-gbrain", action="store_true", help="don't re-put reverted pages into the isolated brain")
    a = ap.parse_args()
    print(json.dumps(reset_brain(all_edits=a.all, dry_run=a.dry_run, sync=not a.no_gbrain), indent=2))


if __name__ == "__main__":
    main()
