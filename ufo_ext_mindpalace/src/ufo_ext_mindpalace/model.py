"""`mindpalace-walker`: a UFO model provider that runs the scripted loci walker (walker.py).

Stand-in for a Gym-trained River specialist served to UFO agents (spec: "Model provider"), and a way
to run a real UFO turn through the Agent Palace tools with no model key. Imports only ufo.sdk.
"""

from __future__ import annotations

import json
import os
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass

from ufo.sdk.models import (
    ModelEvent,
    ModelPrice,
    ModelRequest,
    ModelSpec,
    ModelStreamStart,
    ReasoningSupport,
    TextDelta,
    ToolCallDelta,
    ToolCallStart,
    Usage,
)

from ufo_ext_mindpalace.tools import TOOL_NAMES
from ufo_ext_mindpalace.walker import next_action

WALKER_MODEL = "mindpalace-walker"
PROVIDER = "mindpalace"


def _text(content) -> str:
    if isinstance(content, str):
        return content
    out = []
    for b in content:
        t = getattr(b, "text", None)
        if isinstance(t, str):
            out.append(t)
    return "\n".join(out)


def transcript(request: ModelRequest) -> tuple[str, list[dict]]:
    """-> (task, history) from the conversation: the member's last message and our tool calls since."""
    task = ""
    calls: dict[str, dict] = {}
    history: list[dict] = []
    for msg in request.messages:
        blocks = (msg.content,) if isinstance(msg.content, str) else msg.content
        for b in blocks:
            kind = getattr(b, "type", None) if not isinstance(b, str) else "text"
            if msg.role == "user" and kind == "text":
                text = b if isinstance(b, str) else b.text
                if text.strip():
                    task, history, calls = text.strip(), [], {}  # a new member message starts a new walk
            elif msg.role == "assistant" and kind == "tool_use" and b.name in TOOL_NAMES:
                calls[b.id] = {"name": b.name, "input": dict(b.input)}
            elif msg.role == "user" and kind == "tool_result" and b.tool_use_id in calls:
                raw = _text(b.content)
                try:
                    result = json.loads(raw)
                except json.JSONDecodeError:
                    start = raw.find("{")
                    try:
                        result = json.loads(raw[start:]) if start >= 0 else {"raw": raw}
                    except json.JSONDecodeError:
                        result = {"raw": raw}
                history.append({**calls[b.tool_use_id], "result": result if isinstance(result, dict) else {"raw": result}})
    # UFO may wrap the member's words; keep the last line that reads like the question.
    lines = [l.strip() for l in task.splitlines() if l.strip() and not l.strip().startswith("<")]
    return (lines[-1] if lines else task), history


@dataclass(frozen=True)
class WalkerModelClient:
    model: str

    async def complete(self, request: ModelRequest) -> AsyncIterator[ModelEvent]:
        task, history = transcript(request)
        act = next_action(task, history)
        if log := os.environ.get("MP_WALKER_LOG"):
            with open(log, "a", encoding="utf8") as f:
                f.write(json.dumps({"task": task, "steps": len(history), "action": act}) + "\n")
        yield ModelStreamStart()
        if "text" in act:
            yield TextDelta(text=act["text"])
        else:
            call_id = f"toolu_mp_{uuid.uuid4().hex[:16]}"
            yield ToolCallStart(id=call_id, name=act["tool"])
            yield ToolCallDelta(id=call_id, partial_json=json.dumps(act["input"]))
        yield Usage(input_tokens=1, output_tokens=1)


WALKER_SPEC = ModelSpec(
    id=WALKER_MODEL,
    provider=PROVIDER,
    client=lambda spec, key: WalkerModelClient(model=spec.id),
    price=ModelPrice(0, 0, 0, 0, 0),
    knowledge_cutoff="2026-09",
    context_window=200_000,
    reasoning=ReasoningSupport(supported=False, tools_with_reasoning=False),
    api_surface="chat",
    accepts_image_input=False,
)
