# Agent Palace: Loom script (~4 min)

## Setup (before recording)

- Services running: `bun run dev` (:5173), `bun run protocol` (:8790), `bun run bridge` (:8788).
- **Tab 1:** `localhost:5173/?demo&hold&speed=2.5`
- **Tab 2:** `localhost:5173/?demo=qm-contract`. Open it only at beat 3; it auto-plays.
- **Tab 3:** `localhost:5173/?rooms` (live; Loose Ends already has real gaps from your live run).
- **Terminal** in the repo, font large enough to read.
- Retake reset: `curl -XPOST localhost:8790/loose-ends/reset -d '{"brain":true}'`, then refill with `curl -XPOST localhost:8788/commission -d '{"questId":"security-questionnaire"}'` (~2.5 min).

---

## 1. Hook · 0:00 (Tab 1, don't touch anything)

> "Startups are handing real work to AI agents. The hard part isn't getting an answer; it's trusting it. What did the agent actually check? Which team should it have asked? What does nobody at the company know? Agent Palace makes teams of agents auditable. QM and UFO run your agents; Agent Palace makes sure they can't bluff, and shows you how they got there."

## 2. The company brain · 0:25

**Do:** drag across the wings, click a book in the purple Legal wing, then **Esc**.

> "This is a fictional company, Acme Robotics, as a building. One wing per department: Legal, Finance, Eng, People, then Sales, Support, Ops and Marketing. Every book is a real page in GBrain, the company's memory. And every room has an owner. That ownership is the rule agents have to follow."

## 3. Real QM run: blocked · 0:50

**Do:** switch to **Tab 2** (it auto-plays).

> "This is a recording of a real run: three Claude agents in QM, each scoped to its own department. The question: can we sign the Gripworks contract this week?"

**When** Legal stops at Finance's door and a beam appears (~10 s):

> "Legal needs a budget number, but Budgets belongs to Finance. It can't read another team's room, so it has to ask the owner."

**When** **✕ blocked** appears over Legal (~15 s). Slow down here:

> "Here's the key moment. Legal tried to answer citing the approvals log, a page it never walked into. The harness refused. Blocked."

**When** Legal walks to Approvals and the SOC 2 lectern glows amber (~20–30 s):

> "So it goes and reads it, and answers again, grounded. Meanwhile Eng finds that nobody owns SOC 2, and says so instead of guessing."

## 4. A real job: security questionnaire · 1:45

**Do:** **Tab 1** → **▾ Example quests** → **Answer Northwind Logistics' security questionnaire**.

> "Now a job startups actually get: a prospect sent a security questionnaire. I give it to the company. A new agent spawns, and Claude breaks the job into five subtasks across Sales, Eng, Legal and Support."

**While** it walks between wings (beams, checklist on the right):

> "At every department it asks the owner: twenty handoffs. At every stop, a judge checks the page actually answers the question, with an exact quote."

**When** amber gap cards appear:

> "And it finds what the company doesn't know: nobody owns the DPA Northwind asked for, nobody owns SOC 2, and four pages are stale, including last year's SOC 2 report."

**When** it walks into the Gym, then back out:

> "It trains on its own run in the Gym, then redoes the job on a learned route: thirteen stations down to seven. That route is stored in Memorable for next time."

**When** **Quest complete** appears:

> "It wrote the response page, cited every source, and left the gaps for a human."

## 5. Was it right? · 2:50

**Do:** close the banner (×), press **G**, then **G** again to close.

> "Task flow shows every step and whether each page supported the answer. Every claim has to match an exact quote from a page it verified, or it's blocked. Seven of seven hops useful, grounded, and forty-four percent fewer tool calls on the learned route."

## 6. Humans close the gaps · 3:10

**Do:** **Tab 3** → **Loose Ends board** (bottom right) → click the **SOC 2** card → type *"Priya Nand, VP Engineering"* → submit.

> "Every gap lands here, routed to the team that owns it. Answer it, and it's written back into GBrain; the next agent that visits finds it verified."

## 7. It gets better · 3:30

**Do:** terminal: `bun run memorable:demo "Fill out the security review Northwind sent us"`

> "A differently worded request recalls the same learned route from Memorable."

**Do:** **Tab 1** → **🏋 Gym**.

> "Each department agent can run on its own model, fine-tuned on River from its own verified runs, scored by the palace's grounding check. Our first Legal fine-tune got answers right but stopped quoting sources: grounding fell from ninety to twenty percent. The Gym caught it and didn't promote it. Gen two is training on River now."

## 8. Close · 4:00

**Do:** **⌂ Map**.

> "That's Agent Palace: multiplayer agents that respect who owns what, can't cite what they didn't read, say what the company doesn't know, and get better every run. Built on QM and UFO, GBrain, Memorable and River. Thanks for watching."

---

**If something breaks:** QM replay stuck → reload Tab 2. Loose Ends card won't open → narrate over the board. Memorable slow → it falls back to the local route store after 3 s; keep going.

**Keep it honest:** the QM run and the quest are recordings of real runs (the quest sped up). In-quest Gym steps are a labelled local sim; the River leaderboard numbers are real jobs; gen2 isn't scored yet.
