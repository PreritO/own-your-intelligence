// The model's jobs: (1) keep only decision/owner messages from Slack, (2) turn each doc into
// GBrain pages (department, room, type, title, verbatim body, owner), (3) type the links between
// pages, (4) tidy room names per department. Everything else (slugs, entity pages, owner gaps,
// dates, verbatim checks) is deterministic code in pipeline.ts.
import { WINGS } from "../layout";
import { llmJson, type LlmOptions } from "./llm";
import type { SlackSource, Source } from "./extract";

export const DEPARTMENTS = [...WINGS.map((w) => w.id), "shared"] as const;
export type Department = (typeof DEPARTMENTS)[number];

const str = { type: "string" } as const;
const nullable = (s: object) => ({ anyOf: [s, { type: "null" }] });
const obj = (properties: Record<string, object>) => ({
  type: "object", properties, required: Object.keys(properties), additionalProperties: false,
});

// ---------- 1. Slack: decisions and owners only ----------

export interface SlackKeep { i: number; why: "decision" | "owner" }

const SLACK_SCHEMA = obj({ keep: { type: "array", items: obj({ i: { type: "integer" }, why: { type: "string", enum: ["decision", "owner"] } }) } });

const SLACK_SYSTEM = `You filter a Slack channel export for a company knowledge base.
Keep ONLY messages that themselves state:
- a decision: something decided, agreed, approved, or confirmed as final (including "X stays as it is"), or
- an owner: someone is assigned, or accepts, ownership of a task, doc, process or deadline. When an assignment is
  asked and accepted ("X, can you own Y?" then "Yes, I'll own it"), keep both messages.
Drop everything else: proposals, analysis, questions, reminders, links, jokes, logistics, emoji-only replies,
and acknowledgements ("+1", "on it") unless that same message names what was decided or who owns what.
Answer with the message numbers [n] to keep and why.`;

export async function filterSlack(src: SlackSource, llm: LlmOptions): Promise<SlackKeep[]> {
  const out = await llmJson<{ keep: SlackKeep[] }>(llm, `slack-${src.channel}`, SLACK_SYSTEM,
    `Channel #${src.channel}. Messages (oldest first):\n\n${src.text}`, SLACK_SCHEMA, 4000);
  const valid = new Set(src.messages.map((m) => m.i));
  const seen = new Set<number>();
  return out.keep.filter((k) => valid.has(k.i) && !seen.has(k.i) && seen.add(k.i)).sort((a, b) => a.i - b.i);
}

// ---------- 2. Doc -> pages ----------

export interface PlannedPage {
  key: string;
  title: string;
  type: string;
  department: Department;
  room: string;
  summary: string;
  body: string;
  is_policy_or_process: boolean;
  owner: string | null;
  owner_person: string | null;
  gaps: string[];
}
export interface PlannedEntity { name: string; kind: "person" | "company"; role: string | null; quote: string }
export interface DocPlan { doc_date: string | null; pages: PlannedPage[]; entities: PlannedEntity[] }

const PLAN_SCHEMA = obj({
  doc_date: nullable(str),
  pages: {
    type: "array",
    items: obj({
      key: str, title: str, type: str,
      department: { type: "string", enum: [...DEPARTMENTS] },
      room: str, summary: str, body: str,
      is_policy_or_process: { type: "boolean" },
      owner: nullable(str), owner_person: nullable(str),
      gaps: { type: "array", items: str },
    }),
  },
  entities: {
    type: "array",
    items: obj({ name: str, kind: { type: "string", enum: ["person", "company"] }, role: nullable(str), quote: str }),
  },
});

export const PLAN_SYSTEM = `You convert one document from a startup's messy internal doc dump into pages for the company brain
(GBrain, a Markdown wiki that AI agents answer questions from). Agents can only answer from what the pages say, so:

FACTS ARE VERBATIM. Numbers, prices, dates, deadlines, names, limits, percentages and rules must be copied exactly as
written. Never invent, infer, round, update or "fix" a fact, and never merge in outside knowledge. You may drop
chit-chat, greetings, emoji, formatting debris, navigation text and duplicated boilerplate. Keep tables as tables.

Per page:
- department: which team's wing owns the knowledge. people = HR, handbook, benefits, time off, hiring, culture;
  legal = contracts, counsel, DPAs, signature authority; finance = money, budgets, expenses, board meetings and
  fundraising; eng = engineering, infrastructure, incidents, on-call, security; marketing = launches, positioning,
  campaigns, brand; sales = selling, pricing and discounting as used by sales, deals; ops = vendors, tooling, revenue
  operations, facilities; support = customer success, SLAs, refunds, onboarding customers; shared = company-wide
  material that no single team owns (all-hands notes, team directory, company overview).
- room: a short Title Case group inside the department, 1-2 words (e.g. Handbook, Policies, Pricing, Board, Contracts,
  Incidents, On-call, Playbooks, Launches, Vendors, SLAs, Decisions).
- type: one lowercase word, e.g. policy, process, guide, playbook, runbook, contract, pricing, plan, meeting, decision,
  postmortem, directory, brief, report, reference.
- key: a short kebab-case slug for the page (no department prefix, no dates unless they identify it).
- title: a clear page title.
- summary: ONE sentence under 160 characters with the page's most important fact, in the document's own words.
- body: the page content as clean GitHub Markdown. No H1 (the title is separate), no [[wikilinks]], and no "Owner:"
  line (added separately). Keep every fact from the part of the document this page covers.
- owner: who owns or maintains THIS page's content, exactly as the document states it (an "Owner:" field, "maintained
  by", "kept by", "owns ..."). An author or note-taker is not an owner. null if the document names no owner or says
  there is none. Never guess an owner from someone's job title.
- owner_person: the owner's full name if the owner is a person (use the full name if the document gives it), else null.
- is_policy_or_process: true only if the page sets rules or says how something must be done: a policy, process,
  procedure, playbook, runbook or rotation that someone has to own and keep current. false for meeting notes, board
  decks, decision records, directories, reports, postmortems, launch briefs, price lists and reference sheets.
- gaps: things this part of the document itself says are currently missing, unowned, unassigned, unsigned,
  undecided, out of date or TBD, near-verbatim. Not general advice ("if you can't find X, ask"). [] if none.

Documents under about 400 words stay ONE page, even if they have headings. Split a longer document only into
sections that people would look up separately and that each hold several facts (e.g. a handbook with a code of
conduct, remote-work rules and onboarding steps). Pages of one document stay in the same department unless a
section plainly belongs to another team. At most 6 pages. Every page must make sense on its own.

doc_date: when the document says it was last updated, issued, effective or held (YYYY-MM-DD), else null.

entities: people and outside organizations named in the document that someone might look up. People: employees,
founders, board members, advisors (role as stated, e.g. "Head of Finance", or null). Organizations: customers,
prospects, vendors, investors, competitors, law firms (role = the relationship as stated, e.g. "billing vendor").
Skip software tools that are only mentioned in passing and people known only by a first name unless the document
makes the full name clear. quote: one sentence or table row from the document mentioning them, copied exactly.`;

export async function planDoc(src: Source, llm: LlmOptions): Promise<DocPlan> {
  const user = [
    `Source file: ${src.path} (${src.format})`,
    `Title from the file: ${src.title}`,
    `File last modified: ${src.mtime}`,
    "",
    "<document>",
    src.text,
    "</document>",
  ].join("\n");
  return llmJson<DocPlan>(llm, `plan-${src.path}`, PLAN_SYSTEM, user, PLAN_SCHEMA);
}

// ---------- 3. Typed links ----------

export interface CatalogRow { slug: string; title: string; type: string; department: string; summary: string }
export interface LinkPageInput { slug: string; title: string; body: string }
export interface PlannedLink { from: string; to: string; kind: string; evidence: string }

const LINK_SCHEMA = obj({ links: { type: "array", items: obj({ from: str, to: str, kind: str, evidence: str }) } });

export const LINK_SYSTEM = `You add typed links between pages of a company brain so agents can walk from one page to the
pages it depends on. You get the catalog of every page and the full text of a few pages; return links FROM those pages.

- Link only when the page's text actually refers to the target: names it, cites it, depends on it, is governed by it,
  decides or changes it, contradicts or supersedes it, or names the person or organization. Never link to a person
  or organization the page does not name, and never infer a relationship the text doesn't state.
- kind: snake_case, from the linking page's point of view. Prefer: owned_by, governed_by, governs, requires,
  references, part_of, supersedes, superseded_by, decided_in, changes, conflicts_with, approved_by, signed_by,
  reports_to, manages, counterparty, vendor, customer, investor, competitor, mentions, follows, precedes, depends_on.
- to must be a slug copied exactly from the catalog. Never link a page to itself.
- evidence: the few words from the linking page that justify the link.
- Typically 2-8 links per page. Pages that contradict each other (e.g. an old price vs a newer decision) must be linked
  with supersedes / superseded_by or conflicts_with.`;

export async function planLinks(batchName: string, catalog: CatalogRow[], pages: LinkPageInput[], llm: LlmOptions): Promise<PlannedLink[]> {
  const cat = catalog.map((c) => `${c.slug} | ${c.type} | ${c.department} | ${c.title} | ${c.summary}`).join("\n");
  const body = pages.map((p) => `<page slug="${p.slug}" title="${p.title.replace(/"/g, "'")}">\n${p.body}\n</page>`).join("\n\n");
  const user = `Catalog (slug | type | department | title | summary):\n${cat}\n\nPages to link from:\n\n${body}`;
  const out = await llmJson<{ links: PlannedLink[] }>(llm, `links-${batchName}`, LINK_SYSTEM, user, LINK_SCHEMA);
  return out.links;
}

// ---------- 4. Room names ----------

export interface RoomMap { department: string; from: string; to: string }
const ROOM_SCHEMA = obj({ rooms: { type: "array", items: obj({ department: str, from: str, to: str }) } });

const ROOM_SYSTEM = `You tidy the room names of a company knowledge palace. Each department wing holds rooms of up to 12
pages. Given each department's current room labels with their page titles, map every label to a final label so that
synonyms merge (e.g. "Policy" and "Policies"), a department has 1-3 rooms, and no room exceeds 12 pages.
Final labels are Title Case, 1-2 words. Return one row per (department, current label).`;

export async function planRooms(groups: { department: string; room: string; titles: string[] }[], llm: LlmOptions): Promise<RoomMap[]> {
  const user = groups.map((g) => `${g.department} / ${g.room} (${g.titles.length}): ${g.titles.join("; ")}`).join("\n");
  const out = await llmJson<{ rooms: RoomMap[] }>(llm, "rooms", ROOM_SYSTEM, user, ROOM_SCHEMA, 4000);
  return out.rooms;
}
