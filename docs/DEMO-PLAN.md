# Demo plan: build list and 90-second script

For the integrator agent. Implement the build list, then help rehearse. Written at 3:20 PM from an Opus review of HEAD `512f670` plus earlier Astra (gpt-6-astra) reviews. **HEAD has moved since then (`170ac1f` added the Marketing wing, 103 memories): re-check every number and room reference below against the current `fixtures/palace.json` before relying on it.**

Update 15:30 (integrator): items A, B, C are done and committed; `quest-security-questionnaire.jsonl` was recorded live (4 departments, 20 handoffs, 2 gaps, 4 stale, 13 -> 7 stations) and should replace onboarding as the Commission beat. The time freeze was lifted by the user: round 3 builds real LLM verification + claim-level grounding, Loose Ends write-back to GBrain, true QM multiplayer, a River-served Legal agent, and doc import. Present from `?demo` replays; live is optional.

## The pitch

The job a startup hires this for: *"Before we commit to something, show me what has been checked, which team still owes an answer, and what nobody owns."* (Signing a contract, renewing SOC 2.)

The one line: **"An agent can't cite a room it never walked into."**

Don't claim:
- "verified means correct". `server/protocol/loci.py:129` (`judge()`) only checks blank fields with regexes and freshness; it never compares the page to the question.
- that position affects retrieval. `server/layout.ts` places pages by team and sorting, and the `/` ask walk animates a search that already finished (`server/ask.ts:229`).
- Memorable (see Sponsors).

## Build list (in order, before 4:15)

Run `bun run validate` after each item. If validate fails on room or memory references, the palace changed under the recording: stop and report, don't hand-edit the replay.

### A. Real QM blocked-answer replay (5 min, low risk)

The hero beat. In a real QM run (3 scoped agents on claude-sonnet-5), Legal's first answer was blocked at t=13.95 for citing the approvals log before visiting it, then it walked to `legal/approvals` at 17.32 and re-answered cleanly at 24.97.

```sh
cp /Users/preritoberai/Desktop/projects/own-your-intelligence/own-your-intelligence/.claude/worktrees/agent-a9305f8b7b2c4c783/fixtures/replays/run-2026-09-27T21-22-19-733.jsonl \
   fixtures/replays/qm-contract.jsonl
bun run validate
rg -n '"blocked":true' fixtures/replays/qm-contract.jsonl   # expect the Legal answer around line 38
```

The answer schema already carries `blocked` (`server/schema.ts:94`), and the UI draws the ✕ (`web/src/ui/index.ts:260`, `web/src/agents/index.ts:211`). Check that `?demo=qm-contract&hold` plays it, and that the blocked ✕ is readable in the overview camera.

### B. Quest replay with the SOC 2 gap (5 min, low risk)

The current `quest-onboarding.jsonl` has zero gap verdicts, which breaks a never-cut beat. `run-2026-09-27T21-57-57-612.jsonl` has the SOC 2 gap (around line 46), handoffs and the artifact.

```sh
cp fixtures/replays/quest-onboarding.jsonl fixtures/replays/quest-onboarding.prev.jsonl
cp fixtures/replays/run-2026-09-27T21-57-57-612.jsonl fixtures/replays/quest-onboarding.jsonl
bun run validate
rg -c '"verdict":"gap"' fixtures/replays/quest-onboarding.jsonl   # expect >= 1
```

Confirm the Commission button still plays it end to end (spawn → phases → artifact → answer) and the new page is clickable. If it regresses, restore the `.prev` copy.

### C. UFO replay (5 min, low risk)

```sh
cp server/protocol/examples/ufo-claude-contract-signoff.jsonl fixtures/replays/ufo-contract.jsonl
bun run validate
```

Used in the extended cut: "same protocol, different harness."

### D. GBrain-backed ask (10 min, medium risk)

Start the ask server with the isolated brain so `/` really queries GBrain (`server/ask.ts:98`); each hop's reason then reads "gbrain query: ranked result #N" (`server/ask.ts:145`). Use the isolated brain from `NOTES-seed.md`, never `~/.gbrain`. If the query hangs, it falls back to keyword search; note that and move on.

### E. Gym auto-play (5 min, low risk)

The Gym auto-plays about 2 s after page load (`web/src/rooms/gym.ts:233`). Make it wait (for example a `&gymDelay=` or hold-aware start) so it plays when we walk in, not during the intro.

### F. Freeze fixtures at 4:00

No re-exports of `palace.json` after 4:00. A late re-export can change room IDs and every replay's agents stand still. Recovery: `git checkout <last-good-commit> -- fixtures/palace.json`.

### Don't build

- The enforced route gate from the architecture review (touches `loci.py` and `qm/qm-admin.ts`, 60+ min). Replay A makes the same point.
- New wing content that doesn't pass validate by 4:00.

## The 90-second script

Open `http://localhost:5173/?demo=qm-contract&hold` after item A lands. **Play the contract replay before Commission:** Commission changes which replay ↻ Replay plays next (`web/src/agents/index.ts:424`).

| Clock | On screen / do | Say | Proves |
|---|---|---|---|
| 0:00 | Idle overview | "Acme's company brain: one wing per department, every block a real page." (Use the real page count; if some wings are still empty: "the dark wings wrote nothing down.") | GBrain |
| 0:10 | Click a glowing memory, then Esc | "Every block is a real page with its links." | GBrain |
| 0:18 | Click ↻ Replay | "Can we sign Gripworks this week? Three Claude agents on QM, each limited to its own team." | QM |
| 0:25 | Handoff beam; Finance replies | "Legal can't read Finance's room. It has to ask." | QM |
| **0:30** | **Legal turns red ✕ (blocked)** | **"It cited the approvals log without ever entering that room. The harness refused."** | **QM** |
| 0:32 | Eng's SOC 2 station turns amber | "Nobody owns SOC 2. It says so instead of guessing." | |
| 0:38 | Legal walks to Approvals, answers ✓ | "That's a recording of real agents, not a script." | |
| 0:42 | Press N, then ▶ Commission | "Now a job nobody has done yet." | |
| 0:45–1:12 | New agent spawns, tours departments, hands off, hits the SOC 2 gap; card shows explore → learned hops | "It asks each team what it owns, and flags what nobody does." | |
| 1:13 | New page appears; click 📜 View page | "It wrote the page, cited every station, and left the gap for a human." | GBrain |
| 1:22 | Close | "Every answer comes with a route you can walk back." | |

Re-time these against the actual replays in rehearsal; if the quest runs long, trim narration rather than speed.

### Extended cut (45 s)

1. Press R, then R: contract task explores 9 stations, then walks a learned 5-station route. Call it a "learned route", not Memorable.
2. Press G: flow panel scorecard.
3. Terminal: isolated `gbrain stats` (pages, typed links).
4. River fine-tune log: loss 134 → 9.5 and the RL job id from `NOTES-training.md`.
5. `?demo=ufo-contract`: "same protocol, different harness."
6. `git log --merges --oneline | head -15` and the Superset workspace list.

## Sponsors: what to claim

| Sponsor | Claim? | Say | 20-second proof |
|---|---|---|---|
| QM | Yes, the hero | "The harness refused an answer citing a room the agent never visited." | Beat 0:30 |
| GBrain | Yes, narrowly | "The palace is our GBrain: pages and typed links; the ask bar queries it." | `/` hop reason + `gbrain stats` |
| River | Narrowly | "We fine-tuned a Legal specialist on palace routes." Never call the Gym sparkline "learning": quest train steps are `checkpoint:"sim"` (`server/commission/quest.ts:429`) and real RL rewards are noisy. | SFT loss log + job ids |
| UFO | Yes | "Same protocol, different harness." | `?demo=ufo-contract` |
| Memorable | **No** | No CLI or key (`NOTES-qm-fork.md:99-103`); both runs are hand-authored. | — |
| Superset | Narrowly | "Orchestrated from one Superset workspace: an integrator agent ran ~20 parallel Claude Code agents in git worktrees, PRs #1-#14+." (They were Claude Code subagents, not Superset workspaces; Superset CLI login failed.) | Merge log (`git log --merges`) |

Not wired, don't mention: Slack, Finance waking to reply to handoffs via QM, Loose End write-back to GBrain (it writes to `server/protocol/.overlay/`).

## If it breaks on stage

1. **A replay does nothing.** `playReplay` fails silently when the file is missing (`web/src/agents/run.ts:59`). Press T (demo-1 has a handoff and a gap), and have `rg '"blocked":true' fixtures/replays/qm-contract.jsonl` ready in a terminal.
2. **Agents stand still.** Room IDs changed under the replay. Restore the frozen `fixtures/palace.json` (item F).
3. **Scene stutters or crowds.** `&nobloom`, Esc to reframe, reload with `?demo&hold`. Check in rehearsal that the extra idle agents don't crowd the party bar.
