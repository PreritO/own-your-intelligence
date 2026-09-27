// OWNED BY: ui-v2. Quest board: six company quests as cards (title, department chips in wing colours, one-line
// "why"). Read from /quests.json (fixtures is Vite's publicDir); falls back to a built-in list until the seed
// lands it. Clicking a card commissions it (presence decides live POST vs recorded replay).
import type { Palace } from "../../../server/schema";
import { PRESENCE_EVENTS } from "../agents/run";

export interface QuestDef {
  id: string;
  title: string;
  prompt: string;
  departments: string[];
  expectedGaps?: string[];
  why: string;
}

/** Used until fixtures/quests.json exists. Ids match fixtures/replays/quest-<id>.jsonl. */
export const FALLBACK_QUESTS: QuestDef[] = [
  { id: "onboarding", title: "Onboard a new engineer", prompt: "Create an onboarding page for new engineers", departments: ["people", "eng", "legal"], why: "Three wings own a piece. Nobody has all of it." },
  { id: "enterprise-deal", title: "Quote a 500-seat deal", prompt: "Draft a quote for a 500-seat enterprise deal with standard terms", departments: ["sales", "finance", "legal"], why: "Sales can't promise a discount Finance hasn't approved." },
  { id: "launch", title: "Plan the arm launch", prompt: "Plan the launch of the new robot arm: date, message, stock", departments: ["marketing", "eng", "ops"], why: "Marketing can't announce a date Eng hasn't committed to." },
  { id: "outage-reply", title: "Answer an outage ticket", prompt: "Reply to a customer ticket about last week's outage", departments: ["support", "eng", "legal"], why: "Support must ask Eng what broke before it promises anything." },
  { id: "soc2", title: "Prep the SOC 2 audit", prompt: "Prepare an evidence checklist for the SOC 2 audit", departments: ["eng", "legal", "ops"], why: "A known gap: the agent must say so, not bluff." },
  { id: "hiring-budget", title: "Draft the hiring budget", prompt: "Draft next quarter's hiring budget for Eng and Support", departments: ["finance", "people", "support"], why: "Headcount lives in People, money in Finance." },
];

async function loadQuests(): Promise<QuestDef[]> {
  try {
    const res = await fetch("/quests.json", { cache: "no-store" });
    if (!res.ok) return FALLBACK_QUESTS;
    const text = await res.text();
    if (text.trimStart().startsWith("<")) return FALLBACK_QUESTS; // Vite's index.html fallback
    const raw = JSON.parse(text);
    const list: unknown[] = Array.isArray(raw) ? raw : Array.isArray(raw?.quests) ? raw.quests : [];
    const qs = list
      .filter((q): q is QuestDef => !!q && typeof (q as QuestDef).id === "string" && typeof (q as QuestDef).title === "string")
      .map((q) => ({ ...q, prompt: q.prompt || q.title, departments: Array.isArray(q.departments) ? q.departments : [], why: q.why ?? "" }));
    return qs.length ? qs : FALLBACK_QUESTS;
  } catch {
    return FALLBACK_QUESTS;
  }
}

export function commissionQuest(task: string, questId?: string) {
  window.dispatchEvent(new CustomEvent(PRESENCE_EVENTS.commission, { detail: { task, questId } }));
}

/** Renders the card row into `el`. Returns the loaded quests (for key bindings / QA). */
export async function mountQuestBoard(el: HTMLElement, palace: Palace): Promise<QuestDef[]> {
  const wing = new Map(palace.wings.map((w) => [w.id, w]));
  const quests = await loadQuests();
  el.replaceChildren();
  for (const q of quests.slice(0, 6)) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "mp-qcard";
    card.title = `Commission: ${q.prompt}`;
    const first = wing.get(q.departments[0]);
    card.style.setProperty("--c", first?.color ?? "#ffd35a");
    const t = document.createElement("div");
    t.className = "t";
    t.textContent = q.title;
    const chips = document.createElement("div");
    chips.className = "deps";
    for (const d of q.departments) {
      const w = wing.get(d);
      const c = document.createElement("span");
      c.className = "dep";
      c.style.setProperty("--c", w?.color ?? "#aaa292");
      c.textContent = w?.label ?? d.charAt(0).toUpperCase() + d.slice(1);
      chips.appendChild(c);
    }
    const why = document.createElement("div");
    why.className = "why";
    why.textContent = q.why;
    card.append(t, chips, why);
    card.onclick = () => commissionQuest(q.prompt, q.id);
    el.appendChild(card);
  }
  return quests;
}
