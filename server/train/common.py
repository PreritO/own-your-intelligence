"""Shared paths, fixture loading, River key/model selection and train_step event logging.

Stdlib only. Never prints secrets: the River key is read from the environment or the repo .env
and only its presence is ever reported.
"""
from __future__ import annotations

import json
import os
import time
import urllib.request
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "fixtures"
TRAIN_DIR = Path(__file__).resolve().parent
DATA = TRAIN_DIR / "data"
OUT = TRAIN_DIR / "out"
TEAMS = ("legal", "finance", "eng")
BRIDGE = os.environ.get("MP_BRIDGE", "http://localhost:8788")
PROTOCOL = os.environ.get("MP_PROTOCOL", "http://localhost:8790")

# Smallest capable first. The authoritative list is client.get_capabilities() at runtime.
MODEL_PREFERENCE = (
    "Qwen/Qwen3.5-9B",
    "nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4",
    "Qwen/Qwen3.6-35B-A3B-FP8",
    "Qwen/Qwen3.8-27B-FP8",
    "zai-org/GLM-5.3-Flash",
    "Qwen/Qwen3.5-122B-A10B-FP8",
)


# ---------------------------------------------------------------- env / River
def load_dotenv() -> None:
    """Populate os.environ from ROOT/.env for keys not already set. Values are never printed."""
    path = ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip().removeprefix("export ").strip()
        os.environ.setdefault(k, v.strip().strip('"').strip("'"))


def river_key() -> str | None:
    load_dotenv()
    key = os.environ.get("RIVER_API_KEY", "").strip()
    return key or None


def river_client():
    """Return a river_client.Client, or raise with an actionable message."""
    key = river_key()
    if not key:
        raise SystemExit("RIVER_API_KEY missing (env or .env). Use --dry-run.")
    try:
        import river_client as river  # type: ignore
    except ImportError as e:  # pragma: no cover
        raise SystemExit("river-client not installed: uv sync --project server/train --extra river") from e
    return river.Client(api_key=key)


def pick_base_model(client) -> str:
    """Smallest capable model this key can use (RIVER_MODEL overrides)."""
    forced = os.environ.get("RIVER_MODEL")
    available = list(client.get_capabilities())
    if forced:
        if forced not in available:
            raise SystemExit(f"RIVER_MODEL={forced} not enabled for this key; available: {available}")
        return forced
    for m in MODEL_PREFERENCE:
        if m in available:
            return m
    if not available:
        raise SystemExit("No models enabled for this River key.")
    return available[0]


# ---------------------------------------------------------------- fixtures
def read_json(path: Path) -> Any:
    return json.loads(path.read_text())


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]


def write_jsonl(path: Path, rows: Iterable[dict]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with path.open("w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
            n += 1
    return n


def load_palace() -> dict:
    return read_json(FIXTURES / "palace.json")


def load_replays() -> dict[str, list[dict]]:
    d = FIXTURES / "replays"
    return {p.stem: read_jsonl(p) for p in sorted(d.glob("*.jsonl"))} if d.exists() else {}


def load_optional_jsonl(name: str) -> list[dict]:
    p = FIXTURES / name
    return read_jsonl(p) if p.exists() else []


def load_learned_routes() -> list[dict]:
    p = FIXTURES / "learned-routes.json"
    try:
        data = read_json(p) if p.exists() else []
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


class Palace:
    """Read-only view of palace.json with ownership lookups."""

    def __init__(self, raw: dict | None = None):
        self.raw = raw or load_palace()
        self.rooms = {r["id"]: r for r in self.raw["rooms"]}
        self.memories = {m["id"]: m for m in self.raw["memories"]}
        self.links = self.raw.get("links", [])
        self.routes = self.raw.get("routes", [])

    def owner(self, memory_id: str) -> str:
        m = self.memories.get(memory_id)
        if m and m["room"] in self.rooms:
            return self.rooms[m["room"]]["owner"]
        prefix = memory_id.split("/")[0]
        return prefix if prefix in TEAMS else "shared"

    def readable_by(self, memory_id: str, team: str) -> bool:
        return self.owner(memory_id) in (team, "shared")

    def neighbours(self, memory_id: str) -> list[str]:
        out = [l["to"] for l in self.links if l["from"] == memory_id]
        out += [l["from"] for l in self.links if l["to"] == memory_id]
        return [x for x in dict.fromkeys(out) if x in self.memories]

    def catalog(self) -> str:
        """Compact station list for prompts: id | title | owner."""
        return "\n".join(f"- {m['id']} | {m['title']} | {self.owner(m['id'])}" for m in sorted(self.memories.values(), key=lambda m: m["id"]))


# ---------------------------------------------------------------- train_step events
class StepLogger:
    """Writes train_step PalaceEvents to out/<run>.jsonl and POSTs them to the bridge if it is up."""

    def __init__(self, run: str, post: bool = True, fresh: bool = True):
        self.run = run
        self.t0 = time.time()
        self.path = OUT / f"{run}.jsonl"
        OUT.mkdir(parents=True, exist_ok=True)
        if fresh or not self.path.exists():
            self.path.write_text("")
        self.post = post
        self._bridge_ok: bool | None = None

    def log(self, team: str, step: int, reward: float, checkpoint: str | None = None, t: float | None = None) -> dict:
        e: dict[str, Any] = {
            "t": round(time.time() - self.t0 if t is None else t, 3),
            "agent": team,
            "run": self.run,
            "type": "train_step",
            "team": team,
            "step": int(step),
            "reward": round(float(reward), 4),
        }
        if checkpoint:
            e["checkpoint"] = checkpoint
        with self.path.open("a") as f:
            f.write(json.dumps(e) + "\n")
        if self.post and self._bridge_ok is not False:
            self._bridge_ok = post_event(e)
        return e


def post_event(e: dict, timeout: float = 0.5) -> bool:
    """POST one PalaceEvent to the bridge (proposed: POST /events rebroadcasts on the SSE stream)."""
    try:
        req = urllib.request.Request(f"{BRIDGE}/events", data=json.dumps(e).encode(), headers={"content-type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return 200 <= r.status < 300
    except Exception:
        return False


def checkpoints_path() -> Path:
    return OUT / "checkpoints.json"


def load_checkpoints() -> dict:
    p = checkpoints_path()
    return read_json(p) if p.exists() else {}


def save_checkpoint(key: str, info: dict) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    data = load_checkpoints()
    data[key] = info
    checkpoints_path().write_text(json.dumps(data, indent=2))
