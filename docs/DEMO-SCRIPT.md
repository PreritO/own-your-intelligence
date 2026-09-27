# Mind Palace: walkthrough script (2:33)

Timed to `mind-palace-walkthrough.mp4` (in `~/Desktop/projects/own-your-intelligence/`). Read it as a voiceover over that file, or perform it live using the **Do** column. It's about 380 words at a relaxed pace. Every number on screen comes from a real run.

Before recording live: services up (`bun run dev`, `bun run protocol`, `bun run bridge`), and the Loose Ends board reset with `curl -XPOST localhost:8790/loose-ends/reset -d '{"brain":true}'`.

| Time | Do | Say |
|---|---|---|
| **0:00** | Open `localhost:5173/?demo&hold`. Let the overview sit. | "This is Acme Robotics' company brain as a place. Eight departments, one wing each: Legal, Finance, Eng, Sales, Support, Ops, Marketing, People. Every lectern is a real page in GBrain, with typed links." |
| **0:09** | Click a book (Gripworks MSA). | "Click any one and you get the page and what it links to." |
| **0:16** | Open `?demo=qm-contract` (auto-plays). | "Harnesses like QM and UFO run your agents. We asked: can a *team* of agents be trusted? This is a real run: three Claude agents in QM, each scoped to its own department." |
| **0:27** | Beam from Legal to Finance. | "Legal needs a budget number, but Budgets is Finance's room. It can't read around the permission. It has to ask the owner." |
| **0:31** | **Legal shows ✕ blocked.** | "Here Legal tried to answer citing the approvals log, a page it never walked into. The harness refused the answer." |
| **0:38** | Legal walks to Approvals. | "So it goes and reads it." |
| **0:48** | SOC 2 lectern glows amber. | "Meanwhile Eng hits a page where the answer should be: nobody owns SOC 2. It says that, instead of guessing." |
| **0:56** | New page `?demo&hold`, ▾ Example quests, click **Answer Northwind Logistics' security questionnaire**. | "Now a job a startup actually has. A prospect sent a security questionnaire. Type it in and commission it." |
| **1:06** | New agent appears in the Hall of Quests. | "A new agent spawns. Claude breaks the job into five subtasks across Sales, Eng, Legal and Support." |
| **1:14** | Follow it through the wings. | "It walks the palace, and at every department it asks the owner. Twenty handoffs, each answered from that team's own pages." |
| **1:30** | Amber gap cards. | "It finds what the company doesn't know: nobody owns the DPA request, nobody owns SOC 2. It flags four pages as stale, including last year's SOC 2 report." |
| **1:38** | It walks into the Gym. | "Then it goes to the Gym and trains on its own run…" |
| **1:46** | Learned route. | "…and walks back on a learned route. Thirteen stations become seven. That route is stored in Memorable, so next time a paraphrase of this task recalls it." |
| **1:58** | **Quest complete** banner. | "It writes the response-status page, citing every page it used and leaving the gaps for a human." |
| **2:06** | Press **G** (Task flow). | "Was it right? Task flow shows every step. Seven of seven hops were useful, the answer is grounded, and run one versus run two: forty-four percent fewer tool calls. Every claim in the answer has to match an exact quote from a page it verified; if not, it's blocked." |
| **2:15** | Click **🏋 Gym**. | "And the agents get better. Each department agent trains on River AI from its own verified runs, and the palace's grounding check is the reward." |
| **2:24** | Scroll to River jobs. | "Our first Legal fine-tune got the answers right but stopped quoting its sources: grounding dropped from ninety to twenty percent. The Gym caught it and refused to promote it. Gen two is training on River now." |
| **2:30** | Hold. | "Mind Palace: agents that can't bluff, and a company that can see what it knows." |

## Lines to keep honest

- In-quest Gym steps are a **local simulation**, labelled on screen. The real River numbers are on the leaderboard (SFT loss 134 → 9.5; gen1 regression; gen2 training).
- The QM beat is a **recording of a real run**. The quest is a recording of a real live run, replayed at 2.5×.
- If asked "is it live?": `curl -XPOST localhost:8788/commission -d '{"questId":"security-questionnaire"}'` runs it live (~2 min).

## 20-second extras (if time allows)

- **Loose Ends:** fly to the board, click the SOC 2 card, answer "Priya Nand, VP Engineering". The page is written back to GBrain and re-verifies green. (Live only, not `?demo`.)
- **Memorable:** `bun run memorable:demo "Fill out the security review Northwind sent us"` recalls the 7-station route from Memorable.
- **GBrain:** `bun run gbrain:stats` shows 96 pages and 180 typed links in the isolated brain.
- **UFO:** `?demo=ufo-contract`, "same protocol, different harness."
