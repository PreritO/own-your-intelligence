"""Launch `ufoctl serve` for Mind Palace: maps ANTHROPIC_API_KEY from the repo .env to UFO_ANTHROPIC_API_KEY
(UFO refuses the bare name in its own .env) without printing it."""
import os
import sys
from pathlib import Path

ENV = Path(sys.argv[1]) if len(sys.argv) > 1 else None
env = dict(os.environ)
if ENV and ENV.exists():
    for line in ENV.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.removeprefix("export ").strip()
        v = v.strip().strip("'\"")
        if k == "ANTHROPIC_API_KEY":
            env["UFO_ANTHROPIC_API_KEY"] = v
        elif k == "OPENAI_API_KEY":
            env["UFO_OPENAI_API_KEY"] = v
env.pop("ANTHROPIC_API_KEY", None)
env.pop("OPENAI_API_KEY", None)
env.setdefault("MP_AGENT_MAP", "chat=legal")
env.setdefault("MP_WALKER_LOG", str(Path(__file__).resolve().parent.parent / "walker.log"))
print("UFO_ANTHROPIC_API_KEY set:", bool(env.get("UFO_ANTHROPIC_API_KEY")), flush=True)
os.execvpe(str(Path(__file__).resolve().parent / ".venv/bin/ufoctl"), ["ufoctl", "serve"], env)
