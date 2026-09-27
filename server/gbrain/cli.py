"""The `gbrain` CLI, pinned to the ISOLATED project brain. Never the personal ~/.gbrain.

gbrain 0.42 reads its config from `$GBRAIN_HOME/.gbrain` (NOTES-seed.md). `--path` alone is not
enough, and DATABASE_URL / GBRAIN_DATABASE_URL override the config, so both are dropped from the
child's environment. The project brain is seeded by `bash fixtures/seed-gbrain.sh` into <repo>/.gbrain.

    GBrain().put("eng/soc2-owner", markdown)  ->  {"status": "put", ...} | {"status": "skipped", "reason"} | {"status": "failed", ...}

`MP_GBRAIN_HOME` points at another isolated brain (a directory that CONTAINS .gbrain);
`MP_GBRAIN_BIN` swaps the executable (tests put a fake `gbrain` on disk and assert its argv/env).
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DROP_ENV = ("DATABASE_URL", "GBRAIN_DATABASE_URL")


class GBrain:
    def __init__(self, home: Path | str | None = None, bin: str | None = None, timeout: float = 45.0):
        self.home = Path(home or os.environ.get("MP_GBRAIN_HOME") or REPO).expanduser().resolve()
        self.bin = bin or os.environ.get("MP_GBRAIN_BIN") or "gbrain"
        self.timeout = timeout

    @property
    def config_dir(self) -> Path:
        return self.home / ".gbrain"

    def env(self) -> dict[str, str]:
        env = {k: v for k, v in os.environ.items() if k not in DROP_ENV}
        env["GBRAIN_HOME"] = str(self.home)
        return env

    def unavailable(self) -> str | None:
        """Why we must not (or cannot) call gbrain. None = go."""
        personal = (Path.home() / ".gbrain").resolve()
        if self.config_dir.resolve() == personal:
            return f"refusing: {self.config_dir} is the personal brain"
        exe = shutil.which(self.bin) if os.sep not in self.bin else (self.bin if Path(self.bin).exists() else None)
        if not exe:
            return f"gbrain CLI not found ({self.bin})"
        if not (self.config_dir / "config.json").exists():
            return f"isolated brain not seeded at {self.config_dir} (run: bash fixtures/seed-gbrain.sh)"
        return None

    def _run(self, args: list[str], stdin: str | None = None) -> subprocess.CompletedProcess:
        return subprocess.run([self.bin, *args], input=stdin, env=self.env(), capture_output=True, text=True, timeout=self.timeout, cwd=str(self.home))

    def put(self, slug: str, markdown: str, *, verify_text: str | None = None) -> dict:
        """`gbrain put <slug>` with the page on stdin. With verify_text, reads the page back with
        `gbrain get` and reports whether the brain now contains it."""
        base = {"home": str(self.config_dir), "cmd": f"GBRAIN_HOME={self.home} gbrain put {slug} < page.md"}
        why = self.unavailable()
        if why:
            return {**base, "status": "skipped", "reason": why}
        try:
            r = self._run(["put", slug], stdin=markdown)
        except (OSError, subprocess.TimeoutExpired) as e:
            return {**base, "status": "failed", "reason": f"{type(e).__name__}: {e}"}
        if r.returncode != 0:
            return {**base, "status": "failed", "reason": _tail(r.stderr or r.stdout)}
        out = {**base, "status": "put"}
        if verify_text:
            try:
                g = self._run(["get", slug])
                out["readBack"] = g.returncode == 0 and verify_text in g.stdout
            except (OSError, subprocess.TimeoutExpired):
                out["readBack"] = False
        return out


def _tail(s: str, n: int = 400) -> str:
    s = (s or "").strip()
    return s[-n:] if s else "gbrain exited non-zero"
