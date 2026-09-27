// OWNED BY: training. The Workshop (Memorable, Tier 1): learned routes as lit floor paths between
// their stations (width by reuse count), and a run 1 vs run 2 hops + tool-calls counter from rt.events.
import * as THREE from "three";
import type { PalaceEvent } from "../../../server/schema";
import type { PalaceRuntime } from "../api";
import { buildShell, fetchJsonOptional, fetchTextOptional, framePose, makeBoard, memoryOwner, mountOnFarWall, roundRect, teamColor, wrapText, type Placement } from "./layout";

/** fixtures/learned-routes.json (seed / qm-fork routes.ts), same shape as Memorable workflows. */
export interface LearnedRoute { routeId: string; task: string; stations: string[]; uses: number }

interface Run { key: string; agent: string; task: string; routeId?: string; source?: string; hops: number; tools: number; order: number; done: boolean }

const TOOL_EVENTS = new Set(["claim", "visit", "handoff", "reply", "answer", "wait"]);

export function mountWorkshop(rt: PalaceRuntime, pl: Placement) {
  const g = buildShell(rt, pl, "Workshop", "#7dcfff");
  const board = makeBoard(10, 5.6, 2048);
  mountOnFarWall(pl, board.mesh, 3.2);
  g.add(board.mesh);

  let routes: LearnedRoute[] = [];
  let routesSource: "learned" | "fallback" = "fallback";
  const paths = new Map<string, { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; dot: THREE.Mesh; curve: THREE.CurvePath<THREE.Vector3>; base: number; pulse: number }>();
  const pathGroup = new THREE.Group();
  pathGroup.name = "workshop-learned-paths";
  rt.scene.add(pathGroup);

  // ---------- floor paths ----------
  function buildPaths() {
    pathGroup.clear();
    paths.clear();
    const maxUses = Math.max(1, ...routes.map((r) => r.uses));
    for (const r of routes) {
      const pts = r.stations.map((id) => rt.memoryPosition(id)).filter((p): p is THREE.Vector3 => !!p).map((p) => new THREE.Vector3(p.x, 0.07, p.z));
      if (pts.length < 2) continue;
      const curve = new THREE.CurvePath<THREE.Vector3>();
      for (let i = 0; i < pts.length - 1; i++) curve.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
      const width = 0.18 + 0.7 * (r.uses / maxUses);
      const color = teamColor(rt.palace, routeTeam(r));
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(ribbon(pts, width), mat);
      mesh.renderOrder = 2;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(width * 0.6, 12, 8), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
      pathGroup.add(mesh, dot);
      paths.set(r.routeId, { mesh, mat, dot, curve, base: 0.35 + 0.35 * (r.uses / maxUses), pulse: 0 });
    }
  }

  function routeTeam(r: LearnedRoute): string {
    const owners = r.stations.map((s) => memoryOwner(rt.palace, s)).filter((o) => o !== "shared");
    const counts = new Map<string, number>();
    owners.forEach((o) => counts.set(o, (counts.get(o) ?? 0) + 1));
    // Prefer the owner of the first owned station (the team that walks it), then the majority.
    return owners[0] ?? [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "shared";
  }

  let clock = 0;
  const offFrame = rt.onFrame((dt) => {
    clock += dt;
    for (const p of paths.values()) {
      p.pulse = Math.max(0, p.pulse - dt / 4);
      p.mat.opacity = Math.min(1, p.base + 0.15 * Math.sin(clock * 2) + 0.6 * p.pulse);
      const u = (clock * 0.12) % 1;
      p.dot.position.copy(p.curve.getPointAt(u)).setY(0.25);
    }
  });

  // ---------- run 1 vs run 2 ----------
  const runs = new Map<string, Run>();
  const current = new Map<string, string>(); // agent -> run key
  let order = 0;
  const offEvents = rt.events.subscribe((e: PalaceEvent) => {
    if (e.type === "train_step") return;
    if (e.type === "task") {
      const key = e.run ?? `${e.agent}#${order}`;
      runs.set(key, { key, agent: e.agent, task: e.text, hops: 0, tools: 0, order: order++, done: false });
      current.set(e.agent, key);
      redraw();
      return;
    }
    const key = e.run && runs.has(e.run) ? e.run : current.get(e.agent);
    const run = key ? runs.get(key) : undefined;
    if (!run) return;
    if (e.type === "route") {
      run.routeId = e.routeId;
      run.source = e.source;
      const p = paths.get(e.routeId);
      if (p && e.source === "learned") p.pulse = 1;
    }
    if (e.type === "visit") run.hops++;
    if (TOOL_EVENTS.has(e.type)) run.tools++;
    if (e.type === "answer") run.done = true;
    redraw();
  });

  function comparison(): { task: string; a: Run; b: Run } | { task: string; a: Run; b?: undefined } | null {
    const byTask = new Map<string, Run[]>();
    for (const r of runs.values()) {
      const k = r.task.trim().toLowerCase();
      byTask.set(k, [...(byTask.get(k) ?? []), r]);
    }
    let best: Run[] | undefined;
    for (const list of byTask.values()) {
      if (!best || list.length > best.length || (list.length === best.length && Math.max(...list.map((r) => r.order)) > Math.max(...best.map((r) => r.order)))) best = list;
    }
    if (!best?.length) return null;
    best.sort((x, y) => x.order - y.order);
    return best.length > 1 ? { task: best[0].task, a: best[0], b: best[best.length - 1] } : { task: best[0].task, a: best[0] };
  }

  function redraw() {
    board.draw((ctx, W, H) => {
      ctx.fillStyle = "rgba(12,18,26,0.94)";
      roundRect(ctx, 0, 0, W, H, 36);
      ctx.fill();
      ctx.strokeStyle = "rgba(125,207,255,0.55)";
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.textBaseline = "top";
      ctx.fillStyle = "#e6e8ef";
      ctx.font = "700 64px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText("WORKSHOP", 56, 40);
      ctx.font = "400 34px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "#9aa0b4";
      ctx.fillText(routesSource === "learned" ? "routes learned from past runs · width = reuse" : "no learned routes yet · showing fallback routes", 56, 116);

      // left: learned routes
      const maxUses = Math.max(1, ...routes.map((r) => r.uses));
      let y = 190;
      const colW = W * 0.48;
      for (const r of routes.slice(0, 6)) {
        const color = teamColor(rt.palace, routeTeam(r));
        ctx.fillStyle = color;
        ctx.font = "700 38px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(r.routeId, 56, y);
        ctx.font = "400 30px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = "#b7bccb";
        ctx.fillText(wrapText(ctx, r.task, colW - 60, 1)[0] ?? "", 56, y + 46);
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        roundRect(ctx, 56, y + 90, colW - 260, 22, 11);
        ctx.fill();
        ctx.fillStyle = color;
        roundRect(ctx, 56, y + 90, Math.max(22, (colW - 260) * (r.uses / maxUses)), 22, 11);
        ctx.fill();
        ctx.fillStyle = "#e6e8ef";
        ctx.font = "600 30px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(`${r.uses}× · ${r.stations.length} stations`, 56 + colW - 240, y + 84);
        y += 150;
        if (y > H - 150) break;
      }

      // right: run 1 vs run 2
      const x0 = W * 0.54;
      const cmp = comparison();
      ctx.fillStyle = "#e6e8ef";
      ctx.font = "700 44px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText("Run 1  vs  Run 2", x0, 190);
      if (!cmp) {
        ctx.font = "italic 400 32px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = "#5c6278";
        ctx.fillText("waiting for a task…", x0, 270);
        return;
      }
      ctx.font = "400 30px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "#b7bccb";
      wrapText(ctx, `“${cmp.task}”`, W - x0 - 60, 2).forEach((l, i) => ctx.fillText(l, x0, 252 + i * 38));
      const learned = cmp.b ? undefined : routes.find((r) => r.routeId === cmp.a.routeId);
      const cols: { label: string; hops: number | string; tools: number | string; sub: string; color: string }[] = [
        { label: "RUN 1", hops: cmp.a.hops, tools: cmp.a.tools, sub: cmp.a.source ?? "…", color: "#f7768e" },
        cmp.b
          ? { label: "RUN 2", hops: cmp.b.hops, tools: cmp.b.tools, sub: cmp.b.source ?? "…", color: "#9ece6a" }
          : { label: "LEARNED", hops: learned ? learned.stations.length : "–", tools: learned ? learned.stations.length * 2 + 1 : "–", sub: learned ? "expected on rerun" : "rerun to compare", color: "#5c6278" },
      ];
      const cw = (W - x0 - 80) / 2;
      cols.forEach((c, i) => {
        const cx = x0 + i * (cw + 24);
        ctx.fillStyle = "rgba(30,33,46,0.97)";
        roundRect(ctx, cx, 350, cw, 520, 24);
        ctx.fill();
        ctx.strokeStyle = c.color;
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.fillStyle = c.color;
        ctx.font = "800 36px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(c.label, cx + 28, 374);
        ctx.fillStyle = "#e6e8ef";
        ctx.font = "800 130px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(String(c.hops), cx + 28, 430);
        ctx.font = "500 30px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = "#9aa0b4";
        ctx.fillText("hops", cx + 30, 572);
        ctx.fillStyle = "#e6e8ef";
        ctx.font = "800 80px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(String(c.tools), cx + 28, 630);
        ctx.font = "500 30px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = "#9aa0b4";
        ctx.fillText("tool calls", cx + 30, 722);
        ctx.fillText(c.sub, cx + 30, 800);
      });
      if (cmp.b && cmp.a.hops > 0) {
        const dh = cmp.a.hops - cmp.b.hops, dt = cmp.a.tools - cmp.b.tools;
        ctx.fillStyle = dh >= 0 ? "#9ece6a" : "#f7768e";
        ctx.font = "700 40px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(`${dh >= 0 ? "saved" : "cost"} ${Math.abs(dh)} hops · ${Math.abs(dt)} tool calls (${Math.round((100 * dh) / cmp.a.hops)}%)`, x0, 900);
      }
    });
  }

  // ---------- data ----------
  (async () => {
    const learned = await fetchJsonOptional<LearnedRoute[]>("/learned-routes.json");
    const valid = Array.isArray(learned) ? learned.filter((r) => r && typeof r.routeId === "string" && Array.isArray(r.stations)) : [];
    if (valid.length) {
      routes = valid.map((r) => ({ routeId: r.routeId, task: r.task ?? "", stations: r.stations, uses: Math.max(1, Number(r.uses) || 1) }));
      routesSource = "learned";
    } else {
      routes = rt.palace.routes.map((r) => ({ routeId: r.id, task: r.label, stations: r.stations, uses: 1 }));
    }
    buildPaths();
    redraw();
  })();
  redraw();

  /** Which canned run-1/run-2 replays exist (seed adds contract-run1/2). */
  async function availableReplays(): Promise<string[]> {
    const names = ["contract-run1", "contract-run2"];
    const ok = await Promise.all(names.map(async (n) => ((await fetchTextOptional(`/replays/${n}.jsonl`)) ? n : null)));
    return ok.filter((n): n is string => !!n);
  }

  return {
    group: g,
    pose: () => framePose(pl, board.mesh, 9, 0.8),
    availableReplays,
    dispose() { offFrame(); offEvents(); rt.scene.remove(g); rt.scene.remove(pathGroup); },
  };
}

/** Flat ribbon along a polyline on the floor. */
function ribbon(pts: THREE.Vector3[], width: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
    const dir = new THREE.Vector3().subVectors(next, prev).setY(0).normalize();
    const n = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(width / 2);
    pos.push(pts[i].x + n.x, pts[i].y, pts[i].z + n.z, pts[i].x - n.x, pts[i].y, pts[i].z - n.z);
    if (i < pts.length - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
