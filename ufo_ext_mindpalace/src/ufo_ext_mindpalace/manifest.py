"""Agent Palace for UFO: the entry point (`ufo.extension` -> manifest, `ufo.pack` -> pack).

Imports only `ufo.sdk` (plus this package). Points used:
  tools           loci_* (forward to the protocol service on :8790), gbrain_stations (per-team
                  GBrain scope), loose_ends / loose_end_resolve (the Loose End loop)
  agents          legal / finance / eng team agents, each scoped by its name to its palace wing
  models          mindpalace-walker: scripted loci walker (River-specialist stand-in, no key needed)
  prompt_sections the loci protocol rules, so any UFO agent that holds the tools follows them
"""

from __future__ import annotations

import asyncio
import json

from pydantic import BaseModel, Field
from ufo.sdk.manifest import AgentProvision, AgentSpec, Manifest, Pack, PromptSection
from ufo.sdk.tools import TextContent, ToolContext, ToolDef, ToolResult

from ufo_ext_mindpalace import tools as T
from ufo_ext_mindpalace.client import ProtocolClient
from ufo_ext_mindpalace.model import WALKER_SPEC

NAME = "mindpalace"
VERSION = "0.1.0"

RULES = """## Agent Palace: the loci protocol
You walk Acme Robotics' company brain (GBrain) as a memory palace with the loci_* tools. The protocol
service enforces these rules; follow them and read its refusals:
1. Start every task with loci_route(task): it gives the ordered stations (memory ids) to walk.
2. Walk every station in order: loci_claim then loci_visit. Verdicts are verified, stale or gap. Never
   invent content for a gap.
3. A station in a room your team doesn't own is refused: call loci_handoff(memoryId, question) with one
   specific question, then loci_await_reply(handoffId).
4. If a claim says wait, retry after the holder finishes.
5. Finish with loci_answer(text, citations): cite only stations verified in this run (yours or a
   handoff reply), and state every gap and stale station. A blocked answer means fix and re-answer.
Before ending your turn, call loci_inbox and answer handoffs addressed to you (claim, visit, loci_reply).
"""


class RouteIn(BaseModel):
    task: str = Field(description="The task in the member's words")
    routeId: str | None = Field(default=None, description="Optional route id; omitted = best match")


class StationIn(BaseModel):
    memoryId: str = Field(description="Station = GBrain page slug, e.g. legal/gripworks-msa")


class VisitIn(StationIn):
    question: str | None = Field(default=None, description="What you need from this page")


class HandoffIn(StationIn):
    question: str = Field(description="One specific question for the owning team's agent")
    toAgent: str | None = None


class AwaitIn(BaseModel):
    handoffId: str
    timeout: float = 30.0


class ReplyIn(BaseModel):
    handoffId: str
    answer: str


class AnswerIn(BaseModel):
    text: str
    citations: list[str]


class EmptyIn(BaseModel):
    pass


class LooseEndsIn(BaseModel):
    status: str | None = "open"


class ResolveIn(StationIn):
    content: str = Field(description="The human's answer; becomes the page body")
    by: str = "human"


def _handler(name: str):
    async def handle(ctx: ToolContext, args: BaseModel) -> ToolResult:
        agent = T.palace_agent(getattr(ctx.agent, "name", None))
        result = await asyncio.to_thread(T.call, ProtocolClient(), agent, name, args.model_dump())
        is_error = result.get("status", 200) >= 500
        return ToolResult(content=(TextContent(text=json.dumps(result)),), is_error=is_error)

    return handle


TOOL_SPECS = [
    ("loci_route", RouteIn, "Start a task: record it and get its route, the ordered stations to walk."),
    ("loci_claim", StationIn, "Claim a station (a 30 s lease) before working on it. Returns wait if another agent holds it, refused if your team doesn't own the room."),
    ("loci_visit", VisitIn, "Read a station's GBrain page and get its verdict: verified, stale (freshness < 0.3) or gap (missing/empty/silent)."),
    ("loci_handoff", HandoffIn, "Ask the owning team's agent one specific question about a station you may not enter."),
    ("loci_await_reply", AwaitIn, "Wait for the reply to a handoff you sent."),
    ("loci_inbox", EmptyIn, "List handoffs addressed to you that still need a reply."),
    ("loci_reply", ReplyIn, "Reply to a handoff, after visiting its station yourself."),
    ("loci_answer", AnswerIn, "Post the final answer. Citations must be stations verified in this run; gaps and stale stations are attached. Returns blocked with reasons otherwise."),
    ("gbrain_stations", EmptyIn, "GBrain scoped to your team: pages you may read directly and pages you must ask the owner about."),
    ("loose_ends", LooseEndsIn, "Gaps the agents found that are waiting on a human answer."),
    ("loose_end_resolve", ResolveIn, "Write a human's answer to a Loose End back to its GBrain page; the owning agent re-verifies it."),
]


def tool_defs() -> tuple[ToolDef, ...]:
    return tuple(
        ToolDef(name=n, description=d, input_model=m, handler=_handler(n), binds_member_authority=False)
        for n, m, d in TOOL_SPECS
    )


def _agent(team: str, label: str) -> AgentProvision:
    return AgentProvision(
        name=f"mindpalace-{team}",
        spec=AgentSpec(
            model="auto",
            reasoning="auto",
            internet_access_allowed=False,
            prompt=f"You are Acme Robotics' {label} agent in the Agent Palace. Your team owns the {label} wing; "
            "the People wing is shared. Work only through the loci_* tools and follow the loci protocol.",
            purpose=f"Answers {label} questions from the company brain by walking the Agent Palace.",
        ),
        tools=tuple(n for n, _, _ in TOOL_SPECS),
    )


def manifest() -> Manifest:
    return Manifest(
        name=NAME,
        version=VERSION,
        tools=tool_defs(),
        models=(WALKER_SPEC,),
        prompt_sections=(PromptSection(name="mindpalace_loci", body=RULES),),
        agents=(_agent("legal", "Legal"), _agent("finance", "Finance"), _agent("eng", "Eng")),
    )


# A pack = the stock `assistant` pack's extensions plus Agent Palace. `[pack] name = "mindpalace_pack"`.
# (A trimmed set fails at boot: memory's actions need the kinds other assistant extensions register.)
PACK_EXTENSIONS = (
    "mindpalace",
    *("perplexity", "todos", "sites", "scheduled_tasks", "report_digest", "monitors", "repl", "memory", "rag", "mcp"),
    *("connectors", "composio", "keyed_connectors", "workspace_credentials", "pipedream", "sources", "coding"),
    *("browser_use", "skill_create", "context_compact", "index_default", "embed_openai", "flags_open", "openrouter"),
    *("ufo", "debugger"),
)


def pack() -> Pack:
    return Pack(name="mindpalace_pack", version=VERSION, extensions=PACK_EXTENSIONS)
