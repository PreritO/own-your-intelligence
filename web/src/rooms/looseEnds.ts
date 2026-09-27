// OWNED BY: training. The Loose Ends room (Tier 1): every gap/stale verdict any agent hits
// lands on a board as a glowing card, grouped by the memory's owning team, live from rt.events.
import type { PalaceEvent } from "../../../server/schema";
import type { PalaceRuntime } from "../api";
import { buildShell, framePose, makeBoard, memoryOwner, mountOnFarWall, roundRect, teamColor, wrapText, type Placement } from "./layout";

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
  mountOnFarWall(pl, board.mesh, 3.2);
  g.add(board.mesh);

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
        ctx.font = "700 44px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(TEAM_LABEL[team] ?? team, x, 190);
        ctx.fillRect(x, 246, colW, 5);
        const list = [...cards.values()].filter((c) => c.team === team).sort((a, b) => a.t - b.t);
        let y = 276;
        for (const c of list) {
          const h = 230;
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
          ctx.lineWidth = 3 + 5 * glow;
          roundRect(ctx, x, y, colW, h, 22);
          ctx.stroke();
          // badge
          ctx.fillStyle = vc;
          roundRect(ctx, x + 22, y + 22, 150, 50, 12);
          ctx.fill();
          ctx.fillStyle = "#11131a";
          ctx.font = "800 32px ui-sans-serif, system-ui, sans-serif";
          ctx.fillText(c.resolvedAt ? "CLOSED" : c.verdict.toUpperCase(), x + 38, y + 30);
          ctx.fillStyle = "#e6e8ef";
          ctx.font = "700 36px ui-sans-serif, system-ui, sans-serif";
          ctx.fillText(wrapText(ctx, c.title, colW - 210, 1)[0] ?? "", x + 190, y + 30);
          ctx.font = "500 34px ui-sans-serif, system-ui, sans-serif";
          ctx.fillStyle = "#cfd3e0";
          const lines = wrapText(ctx, `${TEAM_LABEL[c.team] ?? c.team}: ${c.note}`, colW - 44, 2);
          lines.forEach((l, k) => ctx.fillText(l, x + 22, y + 94 + k * 42));
          ctx.font = "400 24px ui-monospace, SFMono-Regular, monospace";
          ctx.fillStyle = "#8a90a6";
          ctx.fillText(wrapText(ctx, `${c.memoryId} · found by ${c.agent} @ ${c.t.toFixed(1)}s`, colW - 44, 1)[0] ?? "", x + 22, y + h - 44);
          y += h + 22;
        }
        if (!list.length) {
          ctx.font = "italic 400 30px ui-sans-serif, system-ui, sans-serif";
          ctx.fillStyle = "#5c6278";
          ctx.fillText("nothing open", x, 290);
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
    pose: () => framePose(pl, board.mesh, 9, 0.8),
    dispose() { off(); offFrame(); rt.scene.remove(g); },
  };
}
