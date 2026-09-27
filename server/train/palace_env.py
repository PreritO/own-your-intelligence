"""The palace as an RL environment.

- `PalaceWorld`: one episode's state. Tools `visit`, `claim`, `handoff`, `answer` call the protocol
  service (:8790) when it is up, else a local simulator over palace.json + the row's ground truth.
- `score_episode`: the Gym reward (docs/SPEC.md -> The Gym):
      +1   correct answer citing only verified stations it actually walked
      +0.5 per expected gap correctly reported
      -1   per gap station cited as a source (invented content)
      -0.25 per skipped route station
      -0.5 per read of a room the agent's team doesn't own without a handoff
- `PalaceEnv`: River `rl.Env` (created per trajectory) exposing the four tools; reward = score_episode.
- `score_plan`: same reward for a single-shot JSON plan (SFT target format), used by eval.py.

River is imported lazily so dry-run paths stay stdlib-only.
"""
from __future__ import annotations

import json
import re
import urllib.request
from dataclasses import dataclass, field

from .common import PROTOCOL, Palace

_palace: Palace | None = None


def palace() -> Palace:
    global _palace
    if _palace is None:
        _palace = Palace()
    return _palace


# ------------------------------------------------------------------ protocol service client
class Protocol:
    """Thin client for server/protocol (ufo-ext). Falls back to local simulation on any error."""

    up: bool | None = None

    @classmethod
    def call(cls, tool: str, payload: dict) -> dict | None:
        if cls.up is False:
            return None
        try:
            req = urllib.request.Request(f"{PROTOCOL}/{tool}", data=json.dumps(payload).encode(), headers={"content-type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=2) as r:
                cls.up = True
                return json.loads(r.read() or b"{}")
        except Exception:
            cls.up = False
            return None


# ------------------------------------------------------------------ episode state
@dataclass
class PalaceWorld:
    row: dict
    use_protocol: bool = False
    visits: list[str] = field(default_factory=list)
    claims: list[str] = field(default_factory=list)
    handoffs: dict[str, str] = field(default_factory=dict)  # memoryId -> toAgent
    unowned_reads: list[str] = field(default_factory=list)
    final: dict | None = None
    tool_calls: int = 0

    @property
    def team(self) -> str:
        return self.row["team"]

    def verdict(self, mid: str) -> str:
        return self.row["expected"]["verdicts"].get(mid) or ("gap" if palace().memories.get(mid, {}).get("freshness", 1) < 0.12 else "verified")

    def _remote(self, tool: str, payload: dict) -> dict | None:
        return Protocol.call(tool, {"agent": self.team, **payload}) if self.use_protocol else None

    # -- tools (return strings shown to the model) --
    def claim(self, memory_id: str) -> str:
        self.tool_calls += 1
        if memory_id not in palace().memories:
            return f"error: unknown station {memory_id}"
        self._remote("claim", {"memoryId": memory_id})
        self.claims.append(memory_id)
        return f"claimed {memory_id}"

    def visit(self, memory_id: str) -> str:
        self.tool_calls += 1
        m = palace().memories.get(memory_id)
        if not m:
            return f"error: unknown station {memory_id}"
        if not palace().readable_by(memory_id, self.team) and memory_id not in self.handoffs:
            self.unowned_reads.append(memory_id)
        remote = self._remote("visit", {"memoryId": memory_id})
        v = (remote or {}).get("verdict") or self.verdict(memory_id)
        self.visits.append(memory_id)
        if v == "gap":
            return json.dumps({"memoryId": memory_id, "verdict": "gap", "note": "no record on this page"})
        body = {"memoryId": memory_id, "verdict": v, "title": m["title"], "excerpt": m["excerpt"]}
        if v == "stale":
            body["note"] = "stale: not reviewed recently"
        return json.dumps(body)

    def handoff(self, memory_id: str, to_agent: str, question: str) -> str:
        self.tool_calls += 1
        owner = palace().owner(memory_id)
        if owner != to_agent:
            return f"error: {memory_id} is owned by {owner}, not {to_agent}"
        self._remote("handoff", {"memoryId": memory_id, "toAgent": to_agent, "question": question})
        self.handoffs[memory_id] = to_agent
        v = self.verdict(memory_id)
        m = palace().memories[memory_id]
        # The owner walks its own station and replies.
        if v == "gap":
            return json.dumps({"reply": f"{to_agent}: {memory_id} has no record (gap)", "verdict": "gap"})
        self.visits.append(memory_id)
        return json.dumps({"reply": f"{to_agent}: {m['excerpt']}", "verdict": v, "memoryId": memory_id})

    def answer(self, text: str, citations: list[str], gaps: list[str] | None = None, stale: list[str] | None = None) -> str:
        self.tool_calls += 1
        self._remote("answer", {"text": text, "citations": citations, "gaps": gaps or [], "stale": stale or []})
        self.final = {"text": text, "citations": list(citations), "gaps": list(gaps or []), "stale": list(stale or [])}
        return "answer recorded"


# ------------------------------------------------------------------ reward
def score_episode(row: dict, visits: list[str], handoffs: dict[str, str] | set[str], unowned_reads: list[str], final: dict | None) -> dict:
    exp = row["expected"]
    stations: list[str] = row["stations"]
    verdicts: dict[str, str] = exp["verdicts"]
    walked = set(visits) | set(handoffs)
    skipped = [s for s in stations if s not in walked]
    final = final or {"text": "", "citations": [], "gaps": [], "stale": []}
    cites = set(final.get("citations") or [])
    reported = set(final.get("gaps") or [])
    gap_set = set(exp["gaps"])
    verified_walked = {s for s in walked if verdicts.get(s, "verified") == "verified" and s in visits}
    invented = sorted(cites & gap_set)
    gaps_hit = sorted(reported & gap_set)
    correct = bool(final.get("text", "").strip()) and cites <= verified_walked and (bool(cites) or not exp["citations"]) and (not exp["citations"] or bool(cites & set(exp["citations"])))
    unowned = sorted(set(unowned_reads))
    reward = (1.0 if correct else 0.0) + 0.5 * len(gaps_hit) - 1.0 * len(invented) - 0.25 * len(skipped) - 0.5 * len(unowned)
    compliant = not skipped and not unowned and not invented and gap_set <= reported
    return {
        "reward": round(reward, 4), "correct": correct, "compliant": compliant,
        "skipped": skipped, "unowned_reads": unowned, "invented": invented, "gaps_reported": gaps_hit,
        "max_reward": 1.0 + 0.5 * len(gap_set),
    }


def score_world(w: PalaceWorld) -> dict:
    return score_episode(w.row, w.visits, w.handoffs, w.unowned_reads, w.final)


def parse_plan(text: str) -> dict | None:
    """Extract the JSON plan from a model reply (tolerates think blocks / code fences)."""
    text = re.sub(r"<think>.*?</think>", "", text or "", flags=re.S)
    m = re.search(r"\{.*\}", text, flags=re.S)
    if not m:
        return None
    try:
        plan = json.loads(m.group(0))
        return plan if isinstance(plan, dict) else None
    except json.JSONDecodeError:
        return None


def score_plan(row: dict, plan: dict | None) -> dict:
    """Execute a single-shot plan in a PalaceWorld: handoffs first, then visit the route, then answer."""
    w = PalaceWorld(row)
    if plan:
        for h in plan.get("handoffs") or []:
            if isinstance(h, dict) and h.get("memoryId") in palace().memories:
                w.handoff(h["memoryId"], str(h.get("toAgent", "")), "handoff from plan")
        for s in plan.get("route") or []:
            if isinstance(s, str) and s not in w.handoffs:
                w.visit(s)
        w.answer(str(plan.get("answer", "")), [c for c in plan.get("citations") or [] if isinstance(c, str)], [g for g in plan.get("gaps") or [] if isinstance(g, str)], [x for x in plan.get("stale") or [] if isinstance(x, str)])
    out = score_world(w)
    out["tool_calls"] = w.tool_calls
    return out


# ------------------------------------------------------------------ River environment
TOOL_PROMPT = (
    "Use the tools: claim then visit every station on your route in order; handoff stations in rooms your "
    "team doesn't own; finish by calling answer(text, citations, gaps, stale). Cite only verified stations."
)


def make_env_class():
    """Build the River rl.Env subclass (requires river-client)."""
    from river_client import rl  # type: ignore

    class PalaceEnv(rl.Env):
        recovery = "stateless"

        def __init__(self, use_protocol: bool = True):
            self.world: PalaceWorld | None = None
            self.use_protocol = use_protocol
            env = self

            @rl.tool
            async def claim(memory_id: str) -> str:
                """Claim a station (memory id) before visiting it."""
                return env.world.claim(memory_id) if env.world else "error: no episode"

            @rl.tool
            async def visit(memory_id: str) -> str:
                """Visit a station and read its verdict (verified | stale | gap) and excerpt."""
                return env.world.visit(memory_id) if env.world else "error: no episode"

            @rl.tool
            async def handoff(memory_id: str, to_agent: str, question: str) -> str:
                """Ask the owning team's agent (legal | finance | eng) to read a station in its room."""
                return env.world.handoff(memory_id, to_agent, question) if env.world else "error: no episode"

            @rl.tool
            async def answer(text: str, citations: list[str], gaps: list[str], stale: list[str]) -> str:
                """Final answer. citations: verified station ids only. gaps/stale: station ids you found."""
                return env.world.answer(text, citations, gaps, stale) if env.world else "error: no episode"

            self.tools = [claim, visit, handoff, answer]

        async def reset(self, row):
            self.world = PalaceWorld(row, use_protocol=self.use_protocol)
            system = row["messages"][0]["content"].split("Reply with one JSON object")[0] + TOOL_PROMPT
            catalog = row["messages"][0]["content"].split("Stations (id | title | owning team):", 1)[-1]
            route = ", ".join(row["stations"])
            return [
                {"role": "system", "content": system + "\n\nStations (id | title | owning team):" + catalog},
                {"role": "user", "content": f"{row['task']}\nRoute: {route}"},
            ]

        async def reward(self, traj, row):
            if self.world is None:
                return 0.0
            if self.world.final is None:
                # Model replied in text instead of calling answer(): score its JSON if present.
                from river_client.renderers import get_text_content  # type: ignore
                plan = parse_plan(get_text_content(traj.messages[-1]))
                if plan:
                    self.world.answer(str(plan.get("answer", "")), plan.get("citations") or [], plan.get("gaps") or [], plan.get("stale") or [])
            return float(score_world(self.world)["reward"])

    return PalaceEnv
