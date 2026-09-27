"""Loose Ends inbox: what the company doesn't know, routed to the team that owns it.

Every `gap` or `stale` verdict any agent lands becomes an item: the page (memoryId), the owning team
(palace room owner), the question that hit it, who asked (agent, and the quest if a commissioned
agent handed it off), when, and a status (open | resolved). A human answers from the palace board:

    GET  /loose-ends?status=open&team=eng        -> [item]   (list; same keys the UFO extension reads)
    GET  /loose-ends/<memoryId>                  -> item
    GET  /loose-ends/config                      -> where answers go (slack | outbox, gbrain home, brain dir)
    POST /loose-ends/<memoryId>/resolve {text, by, recheck?=true}
    POST /loose-ends/reset {brain?: bool}        -> clear the inbox (+ revert write-backs, server/gbrain/reset.py)

Resolving (all real, nothing faked):
  1. writes the answer into the page, fixtures/seed-brain/<id>.md (fills the blank field or appends,
     logs it under "## Answers", bumps `updated:` to today)            -> server/gbrain/pages.py
  2. `gbrain put <id>` into the ISOLATED project brain (<repo>/.gbrain) -> server/gbrain/cli.py
  3. tells the owning team: Slack if SLACK_WEBHOOK_URL is set (env or .env), else appends to
     server/protocol/.outbox/<team>.log. The response and the event say which one happened.
  4. emits `resolved` {memoryId, by, text, channel} into the current run;
  5. re-checks: the owning team's agent visits the page now (a real protocol visit, so the lectern gets
     its verdict). Every later visit re-judges it too: pages are read from disk each visit, a stale
     overlay is removed, and a page's `updated:` date can only raise its freshness.

The service attaches this in `main()` (`loose_ends.attach(proto)`); `route()` is the HTTP hook. A
Protocol without an attached inbox keeps loci's legacy /loose-ends behaviour (tests, embedded use).
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sys
import threading
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import unquote

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))  # server/ -> the gbrain package

import gbrain as gb  # noqa: E402
from loci import DEFAULT_BRAIN, REPO, Protocol, ProtocolError, judge, strip_frontmatter  # noqa: E402

DEFAULT_STATE = HERE / ".loose-ends"
DEFAULT_OUTBOX = HERE / ".outbox"
FRESH_DAYS = 180  # same scale as the exporter: 1 = today, 0 = 180+ days old


# ---------------------------------------------------------------- freshness from `updated:`


def freshness_from(updated: str | None, today: dt.date | None = None) -> float | None:
    if not updated:
        return None
    try:
        day = dt.date.fromisoformat(str(updated).strip().strip("'\"")[:10])
    except ValueError:
        return None
    today = today or dt.date.fromisoformat(gb.today())
    return max(0.0, min(1.0, 1 - (today - day).days / FRESH_DAYS))


class FreshBrain:
    """Wraps loci.Brain. A seed page's `updated:` can only RAISE the palace freshness, so a page a human
    just answered (updated: today) reads fresh on the next visit, while palace.json (exported earlier)
    still decides for every untouched page."""

    def __init__(self, inner):
        self.inner = inner

    def __getattr__(self, name):
        return getattr(self.inner, name)

    def read(self, memory: dict) -> dict:
        page = self.inner.read(memory)
        if page.get("source") == "seed-brain":
            path = Path(self.inner.brain_dir) / (memory.get("path") or f"{memory['id']}.md")
            try:
                meta, _ = strip_frontmatter(path.read_text("utf8"))
            except OSError:
                return page
            f = freshness_from(meta.get("updated"))
            if f is not None and f > page["freshness"]:
                page = {**page, "freshness": round(f, 3)}
        return page


# ---------------------------------------------------------------- per-run context (who asked what)


@dataclass
class RunCtx:
    tasks: dict[str, str] = field(default_factory=dict)  # agent -> task text
    spawned: dict[str, dict] = field(default_factory=dict)  # quest agent -> {label, task}
    subtasks: dict[str, str] = field(default_factory=dict)  # subtask id -> title
    handoffs: dict[tuple[str, str], tuple[str, str]] = field(default_factory=dict)  # (toAgent, memoryId) -> (from, question)


def _now() -> str:
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def _ignored_dir(d: Path) -> Path:
    """Create a runtime dir that git ignores by itself (server/protocol/.gitignore isn't ours)."""
    d.mkdir(parents=True, exist_ok=True)
    gi = d / ".gitignore"
    if not gi.exists():
        gi.write_text("*\n", "utf8")
    return d


def read_dotenv(path: Path, key: str) -> str | None:
    try:
        for line in path.read_text("utf8").splitlines():
            line = line.strip()
            if line.startswith("export "):
                line = line[7:]
            if line.startswith(f"{key}="):
                return line.split("=", 1)[1].strip().strip("'\"") or None
    except OSError:
        pass
    return None


# ---------------------------------------------------------------- the inbox


class Inbox:
    def __init__(
        self,
        proto: Protocol,
        *,
        state_dir: Path,
        outbox_dir: Path,
        webhook: str | None,
        gbrain: gb.GBrain,
        sync_gbrain: bool,
        repo_brain: bool,
    ):
        self.proto = proto
        self.state_dir = Path(state_dir)
        self.outbox_dir = Path(outbox_dir)
        self.webhook = webhook
        self.gbrain = gbrain
        self.sync_gbrain = sync_gbrain
        self.repo_brain = repo_brain  # writes go to the repo's fixtures/seed-brain (reset may use git)
        self.items: dict[str, dict] = {}
        self.ctx: dict[str, RunCtx] = {}
        self._load()

    # ---- persistence

    @property
    def state_file(self) -> Path:
        return self.state_dir / "inbox.json"

    def _load(self) -> None:
        try:
            data = json.loads(self.state_file.read_text("utf8"))
            self.items = {i["memoryId"]: i for i in data.get("items", []) if i.get("memoryId") in self.proto.memories}
        except (OSError, ValueError):
            self.items = {}
        for i in self.items.values():
            i.pop("_busy", None)

    def _save(self) -> None:
        _ignored_dir(self.state_dir)
        tmp = self.state_file.with_suffix(".tmp")
        tmp.write_text(json.dumps({"items": [{k: v for k, v in i.items() if not k.startswith("_")} for i in self.items.values()]}, indent=1), "utf8")
        tmp.replace(self.state_file)

    # ---- event listener (runs inside proto.lock, from Protocol.emit)

    def on_event(self, ev: dict) -> None:
        c = self.ctx.setdefault(ev.get("run") or "", RunCtx())
        kind, agent = ev.get("type"), ev.get("agent", "")
        if kind == "task":
            c.tasks[agent] = ev.get("text", "")
        elif kind == "spawn":
            c.spawned[agent] = {"label": ev.get("label", agent), "task": ev.get("task")}
            if ev.get("task"):
                c.tasks.setdefault(agent, ev["task"])
        elif kind == "phase":
            for st in ev.get("subtasks") or []:
                c.subtasks[str(st.get("id"))] = st.get("title", "")
        elif kind == "handoff":
            c.handoffs[(ev.get("toAgent", ""), ev.get("memoryId", ""))] = (agent, ev.get("question", ""))
        elif kind == "visit":
            if ev.get("verdict") in ("gap", "stale"):
                self._open(ev, c)
            elif ev.get("verdict") == "verified":
                item = self.items.get(ev.get("memoryId", ""))
                if item and not item.get("verified") and not item.get("_busy"):
                    item["verified"] = True
                    item["recheck"] = {"agent": agent, "verdict": "verified", "note": ev.get("note"), "at": _now(), "run": ev.get("run")}
                    if item["status"] == "open":  # the page was fixed elsewhere (a seed edit, a legacy overlay)
                        item.update(status="resolved", resolvedBy="page re-verified", resolvedAt=_now())
                    self._save()

    def _asker(self, ev: dict, c: RunCtx) -> tuple[str, str, str]:
        """-> (asking agent, question, where the question came from)."""
        mid, agent = ev["memoryId"], ev["agent"]
        h = c.handoffs.get((agent, mid))
        asker = h[0] if h else agent
        if h and h[1].strip():
            return asker, h[1].strip(), "handoff"
        if ev.get("subtask") and c.subtasks.get(str(ev["subtask"])):
            return asker, c.subtasks[str(ev["subtask"])], "subtask"
        if c.tasks.get(asker):
            return asker, c.tasks[asker], "task"
        title = self.proto.memories[mid].get("title", mid)
        verb = "What should it say?" if ev.get("verdict") == "gap" else "Is it still true?"
        return asker, f"{title}: {verb}", "generic"

    def _open(self, ev: dict, c: RunCtx) -> None:
        mid = ev.get("memoryId", "")
        if mid not in self.proto.memories:
            return
        item = self.items.get(mid)
        if item and item["status"] == "open":
            item["hits"] = item.get("hits", 1) + 1
            item["lastSeen"] = _now()
            item["verdict"], item["note"] = ev["verdict"], ev.get("note")  # the latest read of the page wins
            self._save()
            return
        asker, question, qsrc = self._asker(ev, c)
        team = self.proto.owner_of(mid)
        a = self.proto.agents.get(asker, {})
        asked: dict[str, Any] = {"agent": asker, "label": a.get("label") or c.spawned.get(asker, {}).get("label") or asker}
        quest = c.spawned.get(asker, {}).get("task")
        if quest:
            asked["quest"] = quest
        new = {
            "memoryId": mid,
            "title": self.proto.memories[mid].get("title", mid),
            "team": team,
            "teamLabel": self.team_label(team),
            "verdict": ev["verdict"],
            "note": ev.get("note"),
            "question": question,
            "questionSource": qsrc,
            "askedBy": asked,
            "foundBy": ev["agent"],
            "run": ev.get("run"),
            "t": ev.get("t"),
            "at": _now(),
            "status": "open",
            "hits": 1,
        }
        if ev.get("subtask"):
            new["subtask"] = ev["subtask"]
        if item:  # it was resolved and has come back: keep the last answer for context
            new["previous"] = {k: item.get(k) for k in ("answer", "resolvedBy", "resolvedAt")}
        self.items[mid] = new
        self._save()
        self._notify_async(new, "open")

    # ---- views

    def team_label(self, team: str) -> str:
        if team == "shared":
            return "Shared"
        w = next((w for w in self.proto.palace.get("wings", []) if w.get("owner") == team), None)
        return (w or {}).get("label") or team.capitalize()

    def view(self, item: dict) -> dict:
        # loci records the visit's own `question` for gaps after listeners run; prefer it to a task/generic one.
        le = self.proto.loose_ends.get(item["memoryId"]) or {}
        q = le.get("question")
        if item.get("questionSource") in ("task", "generic") and q and not q.endswith("What should it say?") and le.get("run") == item.get("run"):
            item["question"], item["questionSource"] = q, "visit"
        return {k: v for k, v in item.items() if not k.startswith("_")}

    def list(self, status: str | None = None, team: str | None = None) -> list[dict]:
        with self.proto.lock:
            out = [self.view(i) for i in self.items.values() if status in (None, "", i["status"]) and team in (None, "", i["team"])]
        return sorted(out, key=lambda i: (i["status"] != "open", i.get("at") or ""))

    def get(self, memory_id: str) -> dict:
        with self.proto.lock:
            if memory_id not in self.items:
                raise ProtocolError(404, f"no loose end for {memory_id!r}", open=[i["memoryId"] for i in self.items.values() if i["status"] == "open"])
            return self.view(self.items[memory_id])

    def config(self) -> dict:
        return {
            "channel": "slack" if self.webhook else "outbox",
            "outbox": str(self.outbox_dir),
            "brainDir": str(self.proto.brain.brain_dir),
            "gbrain": {"home": str(self.gbrain.config_dir), "sync": self.sync_gbrain, "unavailable": self.gbrain.unavailable() if self.sync_gbrain else "sync off"},
        }

    # ---- notify the owning team

    def _message(self, item: dict, kind: str, answer: str | None = None, by: str | None = None, where: str | None = None) -> str:
        who = item["askedBy"]["label"] + (f" (quest: {item['askedBy']['quest']})" if item["askedBy"].get("quest") else "")
        if kind == "open":
            return (
                f"Loose End for {item['teamLabel']}: \"{item['question']}\" hit {item['title']} ({item['memoryId']}), "
                f"a {item['verdict']}: {item.get('note') or 'nothing recorded'}. Asked by {who}. "
                f"Answer it on the palace Loose Ends board or POST /loose-ends/{item['memoryId']}/resolve."
            )
        a = answer if answer and answer[-1] in ".!?" else f"{answer}."
        return f"Resolved for {item['teamLabel']}: \"{item['question']}\" answered by {by}: {a} Written to {where}."

    def deliver(self, team: str, text: str, kind: str) -> dict:
        """Slack if a webhook is configured and accepts the post; else the team's outbox file. Honest result."""
        out: dict[str, Any] = {}
        if self.webhook:
            try:
                req = urllib.request.Request(self.webhook, json.dumps({"text": text}).encode(), {"content-type": "application/json"}, method="POST")
                with urllib.request.urlopen(req, timeout=6) as r:
                    if 200 <= r.status < 300:
                        return {"channel": "slack", "ok": True}
                    out["slackError"] = f"HTTP {r.status}"
            except Exception as e:  # noqa: BLE001 - any failure falls back to the outbox
                out["slackError"] = f"{type(e).__name__}: {e}"[:200]
        path = _ignored_dir(self.outbox_dir) / f"{team}.log"
        with path.open("a", encoding="utf8") as f:
            f.write(f"{_now()} [{kind}] {text}\n")
        return {"channel": "outbox", "ok": True, "path": str(path), **out}

    def _notify_async(self, item: dict, kind: str) -> None:
        text, team, mid = self._message(item, kind), item["team"], item["memoryId"]

        def go():
            res = self.deliver(team, text, kind)
            with self.proto.lock:
                cur = self.items.get(mid)
                if cur is item:
                    cur["notified"] = {**res, "at": _now()}
                    self._save()

        if self.webhook:  # network: never inside the protocol lock
            threading.Thread(target=go, daemon=True).start()
        else:
            go()

    # ---- resolve

    def resolve(self, memory_id: str, text: str, by: str = "human", recheck: bool = True) -> dict:
        p = self.proto
        with p.lock:
            memory = p._memory(memory_id)
            item = self.items.get(memory_id)
            if item is None:
                raise ProtocolError(404, f"no loose end for {memory_id!r}", open=[i["memoryId"] for i in self.items.values() if i["status"] == "open"])
            if item["status"] == "resolved":
                raise ProtocolError(409, f"{memory_id} is already resolved (by {item.get('resolvedBy')})", item=self.view(item))
            if item.get("_busy"):
                raise ProtocolError(409, f"{memory_id} is being resolved")
            answer = gb.clean_answer(text or "")
            if not answer:
                raise ProtocolError(400, "an answer needs text")
            by = gb.clean_answer(by or "human", 80) or "human"
            item["_busy"] = True
        try:
            # Slow I/O outside the protocol lock: page write, gbrain put, Slack.
            try:
                write = gb.write_answer(p.brain.brain_dir, memory, answer, by=by, question=item["question"], judge=judge, gbrain=self.gbrain, sync=self.sync_gbrain)
            except ValueError as e:
                raise ProtocolError(400, str(e)) from e
            overlay = Path(p.brain.overlay_dir) / (memory.get("path") or f"{memory_id}.md")
            if overlay.exists():  # a legacy /writeback overlay would shadow the real page on the next visit
                overlay.unlink()
                write["overlayRemoved"] = str(overlay)
            rel = _rel(write["path"])
            gstat = write["gbrain"]["status"]
            where = f"{rel}" + (" and the isolated GBrain" if gstat == "put" else f" (GBrain {gstat})")
            notify = self.deliver(item["team"], self._message(item, "resolved", answer, by, where), "resolved")
        finally:
            with p.lock:
                item.pop("_busy", None)

        with p.lock:
            item.update(
                status="resolved",
                answer=answer,
                resolvedBy=by,
                resolvedAt=_now(),
                write={"path": rel, "change": write["change"], "strategy": write["strategy"], "updated": write["updated"], "created": write["created"]},
                gbrain=write["gbrain"],
                channel=notify["channel"],
                verified=False,
            )
            item.pop("recheck", None)
            le = p.loose_ends.get(memory_id)
            if le:
                le["status"], le["answeredBy"] = "answered", by
            run = p.run(None)
            agent = self._rechecker(item)
            ev = p.emit(run, {"agent": agent, "type": "resolved", "memoryId": memory_id, "by": by, "text": answer, "channel": notify["channel"]})
            self._save()
            result: dict[str, Any] = {"pending": "the next visit re-judges the page"}
            if recheck and agent in p.agents and p.can_enter(agent, memory_id):
                try:
                    v = p.visit(agent, memory_id, run.id, item["question"], evidence=_answer_line(write["path"], answer))
                    result = {"agent": agent, "verdict": v.get("verdict") or ("wait" if v.get("wait") else None), "note": v.get("note"), "heldBy": v.get("heldBy")}
                except ProtocolError as e:
                    result = {"agent": agent, "error": e.payload.get("error")}
            if not item.get("recheck"):
                item["recheck"] = result
            self._save()
            # A re-check that still reads as a gap/stale has already reopened a fresh item: return that.
            cur = self.items.get(memory_id, item)
            return {"ok": True, "item": self.view(cur), "write": write, "gbrain": write["gbrain"], "notify": notify, "event": ev, "recheck": result}

    def _rechecker(self, item: dict) -> str:
        """The owning team's agent re-checks; shared pages go back to whoever found the gap."""
        p = self.proto
        if item["team"] != "shared":
            a = p.agent_for_team(item["team"])
            if a:
                return a
        if item.get("foundBy") in p.agents:
            return item["foundBy"]
        return next(iter(p.agents), "human")

    # ---- reset

    def reset(self, brain: bool = False) -> dict:
        out: dict[str, Any] = {"ok": True}
        with self.proto.lock:
            if brain:
                if not self.repo_brain:
                    raise ProtocolError(400, "brain reset only runs against the repo's fixtures/seed-brain")
                from gbrain.reset import reset_brain

                out["brain"] = reset_brain(REPO, gbrain=self.gbrain, state_dir=self.state_dir, outbox_dir=self.outbox_dir, overlay_dir=Path(self.proto.brain.overlay_dir), sync=self.sync_gbrain)
            out["cleared"] = len(self.items)
            self.items.clear()
            self.proto.loose_ends.clear()
            self._save()
        return out


def _answer_line(path: str, answer: str, limit: int = 180) -> str | None:
    """The page line where the answer now lives (not the ## Answers log): the re-check's evidence."""
    try:
        _, body = strip_frontmatter(Path(path).read_text("utf8"))
    except OSError:
        return None
    needle = answer.rstrip(".").replace("|", "/")[:40]
    for part in (body.split("\n## Answers")[0], body):  # prefer the page text, else the answers log
        for line in part.splitlines():
            if needle and needle in line:
                line = line.strip(" |-")
                return line if len(line) <= limit else line[: limit - 1] + "…"
    return None


def _rel(path: str) -> str:
    try:
        return str(Path(path).resolve().relative_to(REPO))
    except ValueError:
        return path


# ---------------------------------------------------------------- wiring


def attach(
    proto: Protocol,
    *,
    state_dir: Path | str | None = None,
    outbox_dir: Path | str | None = None,
    webhook: str | None = None,
    load_env: bool = True,
    gbrain: gb.GBrain | None = None,
    sync_gbrain: bool | None = None,
) -> Inbox:
    """Give `proto` a Loose Ends inbox (idempotent). Defaults: state in server/protocol/.loose-ends,
    outbox in server/protocol/.outbox, Slack from SLACK_WEBHOOK_URL (env, then <repo>/.env), gbrain put
    only when the protocol reads the repo's own fixtures/seed-brain (MP_GBRAIN_SYNC=0 turns it off)."""
    existing = getattr(proto, "loose_end_inbox", None)
    if existing is not None:
        return existing
    if webhook is None:
        webhook = os.environ.get("SLACK_WEBHOOK_URL") or (read_dotenv(REPO / ".env", "SLACK_WEBHOOK_URL") if load_env else None)
    repo_brain = Path(proto.brain.brain_dir).resolve() == DEFAULT_BRAIN.resolve()
    if sync_gbrain is None:
        sync_gbrain = repo_brain and os.environ.get("MP_GBRAIN_SYNC", "1") != "0"
    if not isinstance(proto.brain, FreshBrain):
        proto.brain = FreshBrain(proto.brain)
    inbox = Inbox(
        proto,
        state_dir=Path(state_dir or os.environ.get("MP_LOOSE_ENDS_DIR") or DEFAULT_STATE),
        outbox_dir=Path(outbox_dir or os.environ.get("MP_OUTBOX_DIR") or DEFAULT_OUTBOX),
        webhook=webhook or None,
        gbrain=gbrain or gb.GBrain(),
        sync_gbrain=bool(sync_gbrain),
        repo_brain=repo_brain,
    )
    with proto.lock:
        proto.listeners.append(inbox.on_event)
    proto.loose_end_inbox = inbox  # type: ignore[attr-defined]
    return inbox


def route(proto: Protocol, method: str, path: str, query: dict, body: dict | None) -> tuple[int, Any] | None:
    """HTTP hook for service.py. None = not ours (or no inbox attached): fall through."""
    inbox: Inbox | None = getattr(proto, "loose_end_inbox", None)
    if inbox is None or not (path == "/loose-ends" or path.startswith("/loose-ends/")):
        return None
    rest = unquote(path[len("/loose-ends/"):]) if path.startswith("/loose-ends/") else ""
    b = body or {}
    try:
        if method == "GET":
            if not rest:
                return 200, inbox.list(query.get("status"), query.get("team"))
            if rest == "config":
                return 200, inbox.config()
            return 200, inbox.get(rest)
        if method == "POST":
            if rest == "reset":
                return 200, inbox.reset(bool(b.get("brain")))
            if rest.endswith("/resolve"):
                text = b.get("text") or b.get("answer") or b.get("content") or ""
                return 200, inbox.resolve(rest[: -len("/resolve")], text, b.get("by") or "human", b.get("recheck", True) is not False)
        return 404, {"ok": False, "error": f"no route {method} {path}"}
    except ProtocolError as e:
        return e.status, e.payload
