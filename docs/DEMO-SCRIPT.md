# Agent Palace: Loom talk-through (≈5 minutes)

A script you can read while recording. Each beat has **Do** (clicks), **You'll see** (what should appear, so you know when to talk), and **Say** (spoken lines). Say it in your own words if you like; the numbers are all real.

---

## Before you hit record (2 minutes)

**Services** (already running if nothing was restarted):

```sh
bun run dev        # palace        http://localhost:5173
bun run protocol   # loci service  :8790
bun run bridge     # events        :8788
```

**Open three browser tabs, in this order:**

1. `http://localhost:5173/?demo&hold&speed=2.5`: the overview and the recorded quest.
2. `http://localhost:5173/?demo=qm-contract`: the real QM run. **Don't open it until beat 3**; it auto-plays on load.
3. `http://localhost:5173/?rooms`: live mode, for answering a Loose End.

**Open one terminal** in the repo, sized so it's readable in the recording.

**Loose Ends inbox:** it already holds real gaps from your live run (`quest-4`). Leave it. If you answer a card during a take and want to retake, reset and refill it:

```sh
curl -XPOST localhost:8790/loose-ends/reset -d '{"brain":true}'
curl -XPOST localhost:8788/commission -d '{"questId":"security-questionnaire"}'   # ~2.5 min, refills the inbox
```

Close other windows, set the browser to full screen, start Loom on the browser tab plus camera.

---

## 1. The problem (0:00 – 0:30)

**Do:** Tab 1. Don't touch anything.
**You'll see:** the block palace from above: eight department wings, trees around the edges, the Agent Palace panel on the left.

**Say:**
> "Every startup is starting to hand real work to AI agents: answering customer questionnaires, preparing renewals, triaging incidents. The problem isn't getting an agent to produce an answer. It's knowing whether you can trust it. What did it actually check? Which team should have been asked? And what does nobody at the company actually know?
>
> This is Agent Palace. It makes teams of agents auditable. Harnesses like QM and UFO run your agents; Agent Palace makes sure they can't bluff, and shows you exactly how they got the answer."

---

## 2. The company brain (0:30 – 1:00)

**Do:** Slowly drag to pan across the wings. Then click a glowing book in the purple Legal wing (e.g. the Gripworks MSA).
**You'll see:** a side panel with the page title, its text and its links.

**Say:**
> "This is a fictional company, Acme Robotics, laid out as a building. Every department gets a wing: Legal, Finance, Eng, People, and on the outer ring Sales, Support, Ops and Marketing. Every book on a lectern is a real page in GBrain, the company's memory, with typed links between them. About a hundred pages.
>
> The layout isn't decoration. Every room has an owner. Legal owns contracts, Finance owns budgets. That ownership is the rule the agents have to follow."

**Do:** Press **Esc** to close the panel.

---

## 3. Multiplayer agents that can't bluff: a real QM run (1:00 – 2:00)

**Do:** Switch to **Tab 2** (`?demo=qm-contract`). It starts playing on its own.
**You'll see:** three blocky agents (Legal, Finance, Eng) leave their rooms; claim rings appear on lecterns; the quest log fills on the left.

**Say:**
> "This is a recording of a real run: three Claude agents running inside QM, YC's agent harness, each one scoped to its own department. The question is: can we sign the Gripworks contract this week?"

**You'll see (≈10 s):** Legal stops at the door of Finance's Budgets room; a beam to Finance with the question *"Is the Gripworks contract within the Q4 budget?"*

**Say:**
> "Legal needs a budget number, but Budgets belongs to Finance. It's not allowed to read another team's room, so it has to stop at the door and ask the owner. That's a handoff, and Finance's own agent answers it."

**You'll see (≈15 s):** a red **✕ blocked** tag over Legal; the party bar at the bottom says *Legal: blocked*.

**Say (slow down here, it's the key moment):**
> "And here's the part I care about most. Legal tried to answer. But it cited the approvals log, a page it had never actually walked into. So the harness refused the answer. Blocked. It has to go do the work."

**You'll see (≈20–30 s):** Legal walks to the approvals page, then re-answers; over in Eng, the SOC 2 Owner lectern glows amber: *gap: no owner recorded*.

**Say:**
> "So it walks over, reads it, and answers again, this time grounded. Meanwhile the Eng agent hit a page where the answer should be, and there's nothing there: nobody owns SOC 2. Instead of guessing, it says so. That amber marker is the company not knowing something, made visible."

---

## 4. Give the company a real job (2:00 – 3:15)

**Do:** Switch to **Tab 1**. Click **▾ Example quests**, then click **Answer Northwind Logistics' security questionnaire**.
**You'll see:** a new agent ("Answer") appears in the Hall of Quests at the centre; the quest card shows *Plan → Explore → Gym → Execute → Done*.

**Say:**
> "Now a job a startup actually gets. A prospect, Northwind Logistics, sent us a security questionnaire. I just give the company the task.
>
> A brand-new agent spawns for it. First it plans: Claude breaks the job into five subtasks across Sales, Eng, Legal and Support."

**You'll see:** the agent walks wing to wing; beams to each department agent; the checklist on the right fills with *✓ answered by the owner (handoff)*.

**Say:**
> "Then it tours the company. At every department it asks the owner rather than reading around them: twenty handoffs in this run. And at every stop, a judge checks whether that page actually answers the question, with an exact quote, not just whether the page exists."

**You'll see:** amber cards appear: *Northwind DPA Request: gap*, *SOC 2 Owner: gap*, plus stale pages.

**Say:**
> "And it finds what the company doesn't know. Nobody owns the data processing agreement Northwind asked for. Nobody owns SOC 2. And four pages are stale, including last year's SOC 2 report. You'd want to know that before you send a security questionnaire to a customer."

**You'll see:** the agent walks into the Gym (red rubber floor); the River leaderboard may pop up.

**Say:**
> "Then it goes to the Gym and trains on its own run…"

**Do:** Click **⌂ Map** once it leaves the Gym, to clear the leaderboard.

**You'll see:** it walks a shorter path; the card shows *explore 13 → learned 7*.

**Say:**
> "…and does the job again on a learned route. Thirteen stations become seven. That route gets stored in Memorable, so next time someone asks a similar question in different words, the agent already knows where to go."

**You'll see:** **Quest complete** banner: the new page it wrote, green citations, amber gaps and stale pages.

**Say:**
> "Done. It wrote the response-status page, cited every page it used, and left the gaps for a human instead of papering over them."

---

## 5. Was it right? (3:15 – 3:45)

**Do:** Close the banner (×), then press **G**.
**You'll see:** the Task flow panel: subtasks across the top, each step with a verdict, a scorecard (*7/7 useful hops*, *grounded ✓*), and *Run 1 vs Run 2: hops 13 → 7, tool calls −44%*.

**Say:**
> "This is the part you'd actually use at work. The task flow shows every step the agent took, whether each page supported the answer, and which steps were wasted. Every claim in the final answer has to match an exact quote from a page it verified. If it doesn't, the answer is blocked. And you can compare run one against run two: forty-four percent fewer tool calls on the learned route."

**Do:** Press **G** again to close.

---

## 6. Close the loop: humans fill the gaps (3:45 – 4:15)

**Do:** Switch to **Tab 3** (`?rooms`, live). Click **Loose Ends board** (bottom right). Click the **SOC 2** or **Security Policy** card, type an answer, e.g. *"Priya Nand, VP Engineering, owns SOC 2"*, and submit.
**You'll see:** the card flips to **RESOLVED** with confetti.

**Say:**
> "Every gap an agent finds lands here, on the Loose Ends board, routed to the team that owns it. When someone answers, it's written straight back into the company brain, into GBrain, and the next agent that visits that page finds it verified. Your agents find out what your company doesn't know, and your team closes the gaps."

*(If the card doesn't open: skip the typing and say the same lines over the board.)*

---

## 7. It gets better: Memorable and River (4:15 – 5:00)

**Do:** Switch to the **terminal** and run:

```sh
bun run memorable:demo "Fill out the security review Northwind sent us"
```

**You'll see:** *via memorable: … semantic 0.81* and the 7 stations.

**Say:**
> "Here's the learned route coming back from Memorable, for a question phrased completely differently. That's how repeat work gets cheaper."

**Do:** Back to **Tab 1**, click **🏋 Gym**.
**You'll see:** the **River leaderboard**: *What the Gym bought us*; the Legal agent's ladder (*base 90% grounded · gen1 20%, not promoted · gen2 training on River*); Claude as a dashed reference line; real River job curves.

**Say:**
> "And each department agent can run on its own model. We fine-tune specialists on River from each agent's own verified runs, and the palace's grounding check is the score. Look at this: our first Legal fine-tune still got the answers right, but it stopped quoting its sources. Grounding fell from ninety percent to twenty. The Gym caught it and refused to promote it. Generation two is training on River right now on the agent's own grounded replies. That's owning your intelligence: a model the company trains on how it actually works, held to a standard it can check."

---

## 8. Close (5:00 – 5:20)

**Do:** Click **⌂ Map** to return to the overview.

**Say:**
> "So that's Agent Palace. Multiplayer agents that respect who owns what, can't cite what they didn't read, say out loud what the company doesn't know, and get better every time they run. It works across harnesses (QM and UFO both drive it), with GBrain as the memory, Memorable for learned routes and River for the models. Thanks for watching."

---

## If something goes wrong

- **The QM replay doesn't play:** reload Tab 2. It auto-plays on load.
- **The leaderboard covers the screen:** click **×** on it, or **⌂ Map**.
- **The quest looks too fast or slow:** Tab 1's `&speed=2.5` sets it. Remove it for the stage pace.
- **Loose Ends answer fails:** narrate over the board; the write-back is shown in PR #19.
- **Terminal command hangs:** Memorable recall times out after 3 s and prints the local fallback. Say "it falls back to the local route store" and move on.

## Don't overclaim

- The QM beat and the quest are **recordings of real runs** (the quest replayed faster).
- The Gym steps *inside* the quest are a **local simulation** (labelled on screen). The **River** numbers on the leaderboard are real jobs.
- River gen2 has **no score yet**; it's training.
