"""Patch a seed-brain page with a human's answer to a Loose End.

Pure text in, text out (no I/O), so the rules are easy to test:

  - the missing key field is filled in place ("Owner: not recorded" -> "Owner: <answer>", and the
    same field in a "| Owner | (none recorded) |" table row);
  - a page whose lead paragraph says the thing is not on record gets the answer as its new lead;
  - an empty page gets the answer as its body;
  - anything else (a stale page) gets the answer appended;
  - every write also adds a dated line under "## Answers" (provenance: who answered, which question);
  - frontmatter `updated:` is bumped to today, which is what makes the page fresh again.

The field/lead patterns mirror `judge()` in server/protocol/loci.py, and `apply_answer` re-judges its
own output, so a patch that would still read as a gap falls through to the next strategy.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable

BLANK = r"(?:not recorded|none recorded|none|unknown|tbd|unassigned|n/a)"
FIELDS = r"(?:owner|assignee|approver|signatory|dri)"
# "Owner: not recorded" / "| Owner | (none recorded) |" on a line of its own (loci FIELD_BLANK, alt 1).
FIELD_LINE = re.compile(
    rf"^(?P<pre>\W*(?P<field>{FIELDS})\s*(?P<sep>:|\|)\s*)\(?\s*{BLANK}\s*\)?(?P<post>\W*)$",
    re.I | re.M,
)
# "... program owner. Owner: not recorded." inside a sentence (loci FIELD_BLANK, alt 2).
FIELD_INLINE = re.compile(r"\b(?P<field>owner|assignee|approver|signatory)(?P<sep>\s*:\s*)(?:not recorded|none recorded|unassigned)\b", re.I)
LEAD_SILENT = re.compile(r"\b(?:not|none|never)\s+(?:yet\s+)?recorded\b|\bno\s+(?:\w+\s+){0,2}(?:is\s+)?(?:recorded|on\s+record)\b", re.I)
SILENT = re.compile(
    r"\bno\s+(?:\w+\s+){0,2}(?:is\s+|has\s+been\s+)?(?:recorded|assigned|named|listed|documented)\b"
    r"|\b(?:tbd|tbc|todo|unknown|unassigned|not\s+yet\s+(?:assigned|recorded|decided))\b|\bnobody\b",
    re.I,
)
ANSWERS_HEADING = "## Answers"


@dataclass
class Patch:
    text: str  # the full new page (frontmatter + body)
    change: str  # what was done, for humans: "filled owner field (2 places)"
    strategy: str  # field | lead | body | append


def clean_answer(text: str, limit: int = 1200) -> str:
    """One tidy line: no wikilinks (fixtures require every body wikilink under ## Links), no headings,
    no pipes that would break a table row."""
    t = re.sub(r"\[\[[^\]|]+\|([^\]]+)\]\]", r"\1", text)
    t = re.sub(r"\[\[([^\]]+)\]\]", r"\1", t)
    t = re.sub(r"\s+", " ", t).strip().lstrip("#").strip()
    return t[:limit].rstrip()


def split_page(text: str) -> tuple[str, str]:
    """-> (frontmatter block including both --- lines and trailing newline, body)."""
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            nl = text.find("\n", end + 4)
            cut = len(text) if nl == -1 else nl + 1
            return text[:cut], text[cut:]
    return "", text


def set_updated(front: str, day: str, title: str | None = None) -> str:
    if not front:
        return f"---\ntitle: {title or 'Untitled'}\nupdated: {day}\n---\n"
    if re.search(r"^updated:.*$", front, re.M):
        return re.sub(r"^updated:.*$", f"updated: {day}", front, count=1, flags=re.M)
    return re.sub(r"\n---\n?$", f"\nupdated: {day}\n---\n", front, count=1)


def split_links(body: str) -> tuple[str, str]:
    """-> (content above the first trailing section we keep last, the ## Links tail)."""
    m = re.search(r"^## Links\s*$", body, re.M)
    if not m:
        return body.rstrip() + "\n", ""
    return body[: m.start()].rstrip() + "\n", body[m.start():]


def add_answer_log(content: str, line: str) -> str:
    """Append `line` under ## Answers (created just above ## Links if missing)."""
    if re.search(rf"^{re.escape(ANSWERS_HEADING)}\s*$", content, re.M):
        return content.rstrip() + f"\n{line}\n"
    return content.rstrip() + f"\n\n{ANSWERS_HEADING}\n{line}\n"


def _paragraphs(text: str) -> list[str]:
    return [p for p in re.split(r"\n\s*\n", text) if p.strip()]


def _lead_index(content: str) -> int | None:
    """Index (in _paragraphs) of the lead paragraph as judge() sees it (headings ignored)."""
    for i, p in enumerate(_paragraphs(content)):
        if any(not l.lstrip().startswith("#") and l.strip() for l in p.splitlines()):
            return i
    return None


def fill_fields(content: str, answer: str) -> tuple[str, int]:
    one = answer.rstrip(".").replace("|", "/")
    n = 0

    def line(m: re.Match) -> str:
        nonlocal n
        n += 1
        if m.group("sep") == "|":
            return f"{m.group('pre')}{one} |"
        return f"{m.group('pre')}{one}{'.' if m.group('post').strip().endswith('.') else ''}"

    content = FIELD_LINE.sub(line, content)

    def inline(m: re.Match) -> str:
        nonlocal n
        n += 1
        return f"{m.group('field')}{m.group('sep')}{one}"

    content = FIELD_INLINE.sub(inline, content)
    return content, n


def replace_lead(content: str, answer: str) -> str:
    paras = _paragraphs(content)
    i = _lead_index(content)
    if i is None:
        return answer + "\n"
    paras[i] = answer
    return "\n\n".join(paras) + "\n"


def apply_answer(
    page: str,
    answer: str,
    *,
    day: str,
    by: str,
    question: str | None = None,
    title: str | None = None,
    judge: Callable[[dict], tuple[str, str | None]] | None = None,
) -> Patch:
    """Write `answer` into `page`. `judge` (loci.judge) re-checks the result; a patch that still reads
    as a gap falls back to replacing the lead, then to the answer as the whole content."""
    answer = clean_answer(answer)
    if not answer:
        raise ValueError("empty answer")
    front, body = split_page(page)
    content, links = split_links(body)
    visible = "\n".join(l for l in content.splitlines() if not l.lstrip().startswith("#")).strip()
    q = clean_answer(question or "", 200)
    log = f"- {day}: {answer} (answered by {clean_answer(by, 80) or 'human'} via Loose Ends" + (f"; question: {q}" if q else "") + ")"

    candidates: list[tuple[str, str, str]] = []  # (strategy, content, change)
    if not visible:
        candidates.append(("body", answer + "\n", "page was empty; answer is now its body"))
    filled, n = fill_fields(content, answer)
    if n:
        lead_ix = _lead_index(filled)
        lead = _paragraphs(filled)[lead_ix] if lead_ix is not None else ""
        if LEAD_SILENT.search(lead):
            filled = replace_lead(filled, answer)
            candidates.append(("field", filled, f"filled the blank field ({n} place{'s' if n > 1 else ''}) and replaced the silent lead"))
        else:
            candidates.append(("field", filled, f"filled the blank field ({n} place{'s' if n > 1 else ''})"))
    lead_ix = _lead_index(content)
    lead = _paragraphs(content)[lead_ix] if lead_ix is not None else ""
    if visible and (LEAD_SILENT.search(lead) or (len(visible) < 240 and SILENT.search(visible))):
        candidates.append(("lead", replace_lead(content, answer), "replaced the silent lead paragraph with the answer"))
    if visible:
        candidates.append(("append", content, "appended the answer"))
    candidates.append(("body", answer + "\n", "replaced the page body with the answer"))

    for strategy, new_content, change in candidates:
        new_content = add_answer_log(new_content, log)
        new_body = new_content.rstrip() + "\n" + (f"\n{links.rstrip()}\n" if links else "")
        if judge is not None:
            verdict, _ = judge({"body": new_body.strip(), "freshness": 1.0})
            if verdict == "gap":
                continue
        return Patch(text=set_updated(front, day, title) + new_body, change=change + f"; updated: {day}", strategy=strategy)
    raise ValueError("no patch strategy produced a page that is not a gap")
