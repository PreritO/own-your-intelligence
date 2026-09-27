// OWNED BY: training. The Loose Ends room (Tier 1): every gap/stale verdict any agent hits
// lands on a board as a glowing card, grouped by the memory's owning team, live from rt.events.
import type { PalaceEvent } from "../../../server/schema";
import type { PalaceRuntime } from "../api";
import { buildShell, signAbove,framePose, makeBoard, memoryOwner, mountOnFarWall, roundRect, teamColor, wrapText, type Placement } from "./layout";

export interface LooseEnd {
  memoryId: string;
  title: string;
  verdict: "gap" | "stale";
  note: string;
  agent: string;
  team: string; // owning team of the memory
  t: number;
  born: number; // performance.now() when it landed
  resolvedAt?: number;
}

const VERDICT_COLOR = { gap: "#f7768e", stale: "#e0af68" } as const;
const TEAM_LABEL: Record<string, string> = { eng: "Eng", legal: "Legal", finance: "Finance", shared: "Shared" };
const COLUMNS = ["eng", "legal", "finance"];
const GLOW_MS = 3500;
const RESOLVED_MS = 6000;

export function mountLooseEnds(rt: PalaceRuntime, pl: Placement) {
  const g = buildShell(rt, pl, "Loose Ends", "#f7768e");
  const board = makeBoard(10, 5.6, 2048);
  mountOnFarWall(pl, board.mesh, 5.6);
  g.add(board.mesh);
  signAbove(g, board.mesh, 5.6);

  const cards = new Map<string, LooseEnd>();
  const listeners = new Set<(n: number) => void>();
  const titleOf = (id: string) => rt.palace.memories.find((m) => m.id === id)?.title ?? id;

  function upsert(memoryId: string, verdict: "gap" | "stale", note: string | undefined, e: PalaceEvent) {
    const prev = cards.get(memoryId);
    // A gap outranks stale; keep the first note unless a better one shows up.
    if (prev && !prev.resolvedAt && (prev.verdict === "gap" || verdict === "stale") && (prev.note || !note)) return;
    cards.set(memoryId, {
      memoryId, verdict,
      title: titleOf(memoryId),
      note: note ?? prev?.note ?? (verdict === "gap" ? "nothing recorded" : "needs review"),
      agent: e.agent,
      team: memoryOwner(rt.palace, memoryId),
      t: e.t,
      born: prev && !prev.resolvedAt ? prev.born : performance.now(),
    });
    changed();
  }

  function changed() {
    const open = [...cards.values()].filter((c) => !c.resolvedAt).length;
    listeners.forEach((l) => l(open));
    redraw();
  }

  const off = rt.events.subscribe((e) => {
    if (e.type === "visit") {
      if (e.verdict === "gap" || e.verdict === "stale") upsert(e.memoryId, e.verdict, e.note, e);
      else {
        // A verified visit after a gap = the loose end was closed (page written back).
        const c = cards.get(e.memoryId);
        if (c && !c.resolvedAt && e.t >= c.t) { c.resolvedAt = performance.now(); changed(); }
      }
    } else if (e.type === "answer") {
      for (const id of e.gaps ?? []) if (!cards.has(id)) upsert(id, "gap", undefined, e);
      for (const id of e.stale ?? []) if (!cards.has(id)) upsert(id, "stale", undefined, e);
    }
  });

  function redraw() {
    const now = performance.now();
    board.draw((ctx, W, H) => {
      ctx.fillStyle = "rgba(14,16,24,0.94)";
      roundRect(ctx, 0, 0, W, H, 36);
      ctx.fill();
      ctx.strokeStyle = "rgba(247,118,142,0.55)";
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.fillStyle = "#e6e8ef";
      ctx.font = "700 64px ui-sans-serif, system-ui, sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText("LOOSE ENDS", 56, 40);
      ctx.font = "400 34px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "#9aa0b4";
      const open = [...cards.values()].filter((c) => !c.resolvedAt);
      ctx.fillText(`what the company doesn't know yet · ${open.length} open`, 56, 116);

      const teams = [...COLUMNS];
      if ([...cards.values()].some((c) => c.team === "shared")) teams.push("shared");
      const colW = (W - 56 * 2 - 32 * (teams.length - 1)) / teams.length;
      teams.forEach((team, i) => {
        const x = 56 + i * (colW + 32);
        const color = teamColor(rt.palace, team);
        ctx.fillStyle = color;
        ctx.font = "800 60px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(TEAM_LABEL[team] ?? team, x, 180);
        ctx.fillRect(x, 252, colW, 8);
        const list = [...cards.values()].filter((c) => c.team === team).sort((a, b) => a.t - b.t);
        let y = 284;
        for (const c of list) {
          const h = 300;
          if (y + h > H - 30) break;
          const age = now - c.born;
          const glow = age < GLOW_MS ? 1 - age / GLOW_MS : 0;
          const vc = c.resolvedAt ? "#9ece6a" : VERDICT_COLOR[c.verdict];
          ctx.save();
          ctx.shadowColor = vc;
          ctx.shadowBlur = 18 + 50 * glow;
          ctx.fillStyle = c.resolvedAt ? "rgba(30,44,30,0.95)" : "rgba(30,33,46,0.97)";
          roundRect(ctx, x, y, colW, h, 22);
          ctx.fill();
          ctx.restore();
          ctx.strokeStyle = vc;
          ctx.lineWidth = 5 + 6 * glow;
          roundRect(ctx, x, y, colW, h, 22);
          ctx.stroke();
          // team colour accent bar
          ctx.fillStyle = color;
          roundRect(ctx, x + 10, y + 16, 12, h - 32, 6);
          ctx.fill();
          // big verdict badge
          ctx.fillStyle = vc;
          roundRect(ctx, x + 40, y + 24, 210, 68, 14);
          ctx.fill();
          ctx.fillStyle = "#11131a";
          ctx.font = "900 46px ui-sans-serif, system-ui, sans-serif";
          ctx.fillText(c.resolvedAt ? "CLOSED" : c.verdict.toUpperCase(), x + 58, y + 34);
          ctx.fillStyle = "#f2f3f7";
          ctx.font = "800 52px ui-sans-serif, system-ui, sans-serif";
          ctx.fillText(wrapText(ctx, c.title, colW - 70, 1)[0] ?? "", x + 40, y + 112);
          ctx.font = "600 42px ui-sans-serif, system-ui, sans-serif";
          ctx.fillStyle = "#d5d9e4";
          const lines = wrapText(ctx, `${TEAM_LABEL[c.team] ?? c.team}: ${c.note}`, colW - 70, 2);
          lines.forEach((l, k) => ctx.fillText(l, x + 40, y + 180 + k * 50));
          y += h + 24;
        }
        if (!list.length) {
          ctx.font = "italic 500 40px ui-sans-serif, system-ui, sans-serif";
          ctx.fillStyle = "#5c6278";
          ctx.fillText("nothing open", x, 300);
        }
      });
    });
  }

  // Keep glowing cards animated; drop closed cards after a while.
  let acc = 0;
  const offFrame = rt.onFrame((dt) => {
    const now = performance.now();
    let dirty = false;
    for (const [id, c] of cards) {
      if (c.resolvedAt && now - c.resolvedAt > RESOLVED_MS) { cards.delete(id); dirty = true; }
    }
    const animating = [...cards.values()].some((c) => now - c.born < GLOW_MS);
    acc += dt;
    if (dirty) changed();
    else if (animating && acc > 1 / 20) { acc = 0; redraw(); }
  });
  redraw();

  return {
    group: g,
    cards,
    onCount(cb: (n: number) => void) { listeners.add(cb); cb([...cards.values()].filter((c) => !c.resolvedAt).length); },
    pose: () => framePose(pl, board.mesh, 9.5),
    dispose() { off(); offFrame(); rt.scene.remove(g); },
  };
}
