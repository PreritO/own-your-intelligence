// OWNED BY: presence. Single-trace retrieval walk (the ask-bar cinematic). See skill retrieval-walk.
// Ask → POST :8787/ask (or the canned trace) → a guide orb flies hop to hop through doorways while the
// camera follows; each hop flares with "<step>. <reason>", rooms stay lit, a light trail fades behind.
import * as THREE from "three";
import { PORTS, Trace, type Trace as TraceT } from "../../server/schema";
import { UI_EVENTS, type Plugin, type PalaceRuntime } from "./api";
import { director } from "./agents/camera";
import { disposeTree, makeGlow, makeLabel, type Label } from "./agents/fx";
import { pathBetween, roomAt, roomById } from "./nav";
import { walkUI } from "./ui";

const GOLD = "#ffd98a";
const Y = 1.7;
const TRAIL = 400;

async function fetchTrace(question: string): Promise<{ trace: TraceT; source: string }> {
  const canned = async (why: string) => ({
    trace: Trace.parse(await (await fetch("/traces/demo-1.json")).json()),
    source: why,
  });
  if (new URLSearchParams(location.search).has("demo")) return canned("canned trace");
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(`http://localhost:${PORTS.ask}/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
      signal: ctl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { trace: Trace.parse(await res.json()), source: "live GBrain" };
  } catch {
    return canned("canned trace (ask server offline)");
  }
}

export const mountWalk: Plugin = (rt) => {
  let stop: (() => void) | null = null;
  let seq = 0;

  const onAsk = async (ev: Event) => {
    const question = String((ev as CustomEvent).detail?.question ?? "").trim();
    if (!question) return;
    const my = ++seq;
    stop?.();
    walkUI.showHop(`Asking the palace: “${question}”`);
    const { trace, source } = await fetchTrace(question);
    if (my !== seq) return;
    stop = play(rt, trace, source, () => (stop = null));
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape" && stop) stop();
  };
  addEventListener(UI_EVENTS.ask, onAsk);
  addEventListener("keydown", onKey);
  (window as any).walk = { play: (t: TraceT) => ((stop?.(), (stop = play(rt, t, "manual", () => (stop = null))))) };

  return () => {
    removeEventListener(UI_EVENTS.ask, onAsk);
    removeEventListener("keydown", onKey);
    stop?.();
  };
};

/** Start the cinematic; returns a stop function (Esc). */
function play(rt: PalaceRuntime, trace: TraceT, source: string, onEnd: () => void): () => void {
  const palace = rt.palace;
  const hops = trace.hops
    .slice()
    .sort((a, b) => a.step - b.step)
    .filter((hp) => rt.memoryPosition(hp.memoryId) && palace.memories.some((m) => m.id === hp.memoryId));
  if (!hops.length) {
    walkUI.showAnswer(trace, source);
    return () => walkUI.hide();
  }

  // ---- path: start → (doors…) → hop 1 → (doors…) → hop 2 …
  const cam = rt.camera.position;
  const inside = roomAt(palace, cam) && cam.y < 6;
  const foyer = roomById(palace, "foyer") ?? palace.rooms[0];
  const start = inside ? new THREE.Vector3(cam.x, Y, cam.z) : new THREE.Vector3(foyer.center[0], Y, foyer.center[2]);
  const pts: THREE.Vector3[] = [start];
  const hopIdx: number[] = [];
  for (const hp of hops) {
    const mem = palace.memories.find((m) => m.id === hp.memoryId)!;
    const at = rt.memoryPosition(hp.memoryId)!.clone().add(new THREE.Vector3(0, 0.85, 0));
    const leg = pathBetween(palace, pts[pts.length - 1], { room: mem.room, point: at }, { y: Y });
    pts.push(...leg);
    hopIdx.push(pts.length - 1);
  }
  if (pts.length < 2) pts.push(pts[0].clone().add(new THREE.Vector3(0, 0.01, 0)));
  const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  const DIV = 2000;
  const lengths = curve.getLengths(DIV);
  const total = lengths[DIV];
  const hopU = hopIdx.map((i) => lengths[Math.round((i / (pts.length - 1)) * DIV)] / total);

  const duration = Math.min(15, Math.max(8, 1.9 * hops.length + 2.5));
  const seg = duration / hops.length;

  // ---- actors
  const group = new THREE.Group();
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 14), new THREE.MeshBasicMaterial({ color: "#fff6dd" }));
  const halo = makeGlow(GOLD, 2.4, 0.9);
  const light = new THREE.PointLight(GOLD, 14, 12, 1.5);
  const guide = new THREE.Group();
  guide.add(orb, halo, light);
  group.add(guide);

  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
  trailGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
  const trailLine = new THREE.Line(
    trailGeo,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  trailLine.frustumCulled = false;
  group.add(trailLine);
  const trail: { p: THREE.Vector3; t: number }[] = [];
  const gold = new THREE.Color(GOLD);

  const labels: Label[] = [];
  const flares: { s: THREE.Sprite; t: number }[] = [];
  rt.scene.add(group);

  rt.setPalaceDim(0.3);
  const lit = new Set<string>();
  const glowing = new Set<string>();

  // ---- timeline
  let t = -0.6; // brief lead-in while the camera swings to the start
  let reached = -1;
  let answered = false;
  const orbPos = new THREE.Vector3();
  const behind = new THREE.Vector3();
  const ease = (x: number) => x * x * (3 - 2 * x);

  function uAt(time: number) {
    if (time <= 0) return 0;
    const i = Math.min(hops.length - 1, Math.floor(time / seg));
    const k = Math.min(1, (time - i * seg) / seg);
    const u0 = i === 0 ? 0 : hopU[i - 1];
    return u0 + (hopU[i] - u0) * ease(k);
  }

  function arrive(i: number) {
    const hp = hops[i];
    const mem = palace.memories.find((m) => m.id === hp.memoryId)!;
    rt.setMemoryGlow(hp.memoryId, 4);
    glowing.add(hp.memoryId);
    rt.setRoomLit(mem.room, true);
    lit.add(mem.room);
    const lbl = makeLabel(`${hp.step}. ${hp.reason}`, { color: "#1b1405", bg: GOLD, px: 40, screen: 24, onTop: true });
    lbl.sprite.position.copy(rt.memoryPosition(hp.memoryId)!).add(new THREE.Vector3(0, 1.2, 0));
    lbl.sprite.center.set(0.5, -0.3);
    group.add(lbl.sprite);
    labels.push(lbl);
    const fl = makeGlow(GOLD, 0.5, 1);
    fl.position.copy(rt.memoryPosition(hp.memoryId)!);
    group.add(fl);
    flares.push({ s: fl, t: 0 });
    walkUI.showHop(`${hp.step}/${hops.length} · ${mem.title} — ${hp.reason}`);
  }

  const offFrame = rt.onFrame((dt) => {
    t += dt;
    const u = uAt(t);
    curve.getPointAt(u, orbPos);
    guide.position.copy(orbPos);
    halo.scale.setScalar(2.2 + 0.3 * Math.sin(t * 6));

    for (let i = reached + 1; i < hops.length; i++) {
      if (t >= (i + 1) * seg - 0.05) (reached = i), arrive(i);
      else break;
    }
    if (!answered && reached === hops.length - 1 && t >= duration + 0.5) {
      answered = true;
      walkUI.showAnswer(trace, source);
      trace.answerMemoryIds.forEach((id) => {
        if (!glowing.has(id)) glowing.add(id);
        rt.setMemoryGlow(id, 5);
      });
    }

    // trail
    const last = trail[trail.length - 1];
    if (!last || last.p.distanceTo(orbPos) > 0.08) trail.push({ p: orbPos.clone(), t });
    while (trail.length > TRAIL || (trail.length && t - trail[0].t > 7)) trail.shift();
    const pa = trailGeo.getAttribute("position") as THREE.BufferAttribute;
    const ca = trailGeo.getAttribute("color") as THREE.BufferAttribute;
    trail.forEach((s, i) => {
      const k = Math.max(0, 1 - (t - s.t) / 7);
      pa.setXYZ(i, s.p.x, s.p.y, s.p.z);
      ca.setXYZ(i, gold.r * k, gold.g * k, gold.b * k);
    });
    pa.needsUpdate = ca.needsUpdate = true;
    trailGeo.setDrawRange(0, trail.length);

    for (const f of flares) {
      f.t += dt;
      const k = Math.min(1, f.t / 1.1);
      f.s.scale.setScalar(0.5 + 5 * k);
      f.s.material.opacity = 1 - k;
    }
  });

  // camera: trail the orb by ~4.5 m along the path, a little above it, looking at it
  const cd = director(rt);
  cd.hold("walk", 2, () => {
    const back = Math.max(0, uAt(t) - 4.5 / total);
    curve.getPointAt(back, behind);
    const pos = behind.clone().add(new THREE.Vector3(0, 1.9, 0));
    if (pos.distanceTo(orbPos) < 1.5) pos.add(new THREE.Vector3(0, 0.8, 1.2)); // at the very start
    return { pos, look: orbPos.clone(), rate: t < 0 ? 2.5 : 5 };
  });

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    offFrame();
    cd.drop("walk");
    rt.setPalaceDim(1);
    glowing.forEach((id) => rt.setMemoryGlow(id, null));
    lit.forEach((r) => rt.setRoomLit(r, false));
    labels.forEach((l) => l.dispose());
    disposeTree(group);
    walkUI.hide();
    onEnd();
  };
}

