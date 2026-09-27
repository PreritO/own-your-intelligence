---
name: loose-ends-lessons
description: Lessons from the loose-ends workspace - the Loose Ends inbox (server/protocol/loose_ends.py), GBrain write-back of human answers (server/gbrain), and the click-to-answer board (web/src/rooms/looseEnds.ts). Load before changing how gaps are routed, answered or written back to GBrain.
---

# Loose Ends lessons

- **Attach, don't embed.**
  - The inbox is a `Protocol` listener plus a `route()` hook, attached only in `service.py main()`.
  - Tests that build `Protocol`/`serve_in_thread` directly (other workspaces', and UFO's) keep the legacy behaviour and can never write the repo seed brain.
  - The UFO test calls `/writeback` against the real seed brain, so hijacking that route would have edited `fixtures/` during tests.
- **Freshness is the silent blocker.**
  - Filling `Owner:` on `eng/soc2-owner` alone gives `stale`, not `verified`, because palace.json freshness is 0.11.
  - `FreshBrain` lets the page's `updated:` raise (never lower) the palace value, so only answered pages change.
- **Listener order:** `Protocol.emit` calls listeners before `visit()` records loci's own loose end, so the visit's `question` is merged lazily at read time.
- **Who asked:** in quests the team agent visits on a quest agent's behalf. The real asker is the handoff (`toAgent|memoryId`) sender, and the question is the handoff question.
- **Re-judge your own patch** with `loci.judge` before writing, and fall back to another strategy if it still reads as a gap.
- **Slow I/O** (gbrain put, Slack) runs outside `proto.lock`. Take the lock only to mutate items and to emit/visit.
- **Isolated gbrain:**
  - Set `GBRAIN_HOME=<repo>` and delete `DATABASE_URL`/`GBRAIN_DATABASE_URL` from the child environment (empty isn't enough in general).
  - Refuse if the home resolves to `~/.gbrain`.
  - Test with a fake `gbrain` script that records argv, env and stdin.
- **Board picking:** raycast the board mesh, map uv to canvas pixels, and hit-test the card rects saved during `redraw()`. `cardScreen(id)` projects a card for deterministic headless clicks.
- **Worktree guard:** no `cd … && git`, no `env -u`, no heredoc Python. Use absolute paths and put scripts in files.
- **Next time:** ask ui early for a hook to collapse `.mp-top` when a room is framed, because it hides the board in the fly-to pose.
