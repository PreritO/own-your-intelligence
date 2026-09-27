// OWNED BY: presence. Agent avatars, station states, handoff beams, camera modes. See skill agent-presence.
// A pure function of rt.events: ?demo replays and the live bridge render identically, and any replay
// speed ends in the same state (markers are set by events; avatars always drain their walk queue).
import * as THREE from "three";
import { PORTS, type PalaceEvent } from "../../../server/schema";
import { emitUI, UI_EVENTS, type Plugin } from "../api";
import { pathBetween, roomAt, roomById } from "../nav";
import { Avatar, AVATAR_Y } from "./avatar";
import { Beams } from "./beams";
import { director } from "./camera";
import { names, playReplay, PRESENCE_EVENTS, registerSpawn, subscribeRuns } from "./run";
import { additive } from "./fx";
import { Stations } from "./stations";
import { RouteView, type StationLook } from "./route";
import { CAMERA_EVENTS } from "../controls";

export const DEMO_TASKS = [
  { agent: "legal", text: "Can we sign the Gripworks contract this week?" },
  { agent: "finance", text: "What did we promise Ada in the last board meeting?" },
  { agent: "eng", text: "Who owns the SOC 2 renewal?" },
];

type CamMode = "overview" | string; // string = agent id to follow

export const mountPresence: Plugin = (rt) => {
  const N = names(rt.palace);
  const stations = new Stations(rt);
  const beams = new Beams(rt.scene);
  const avatars = new Map<string, Avatar>();
  const routes = new Map<string, string[]>();
  const agentIds = rt.palace.agents.map((a) => a.id);
  const spawned: string[] = []; // commissioned agents this run, first in the party order
  const party = () => [...spawned, ...agentIds];

  const slot = (agentId: string) => {
    const i = agentIds.indexOf(agentId);
    return i < 0 ? agentIds.length : i;
  };
  const slotOffset = (agentId: string, r = 1.3) => {
    const a = (slot(agentId) * Math.PI * 2) / 3 + Math.PI / 6;
    return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
  };

  function homePos(agentId: string) {
    // Everyone starts in the foyer so dispatch reads as three agents fanning out to their wings.
    const room = roomById(rt.palace, "foyer") ?? roomById(rt.palace, N.agents.get(agentId)?.home ?? "") ?? rt.palace.rooms[0];
    const c = room ? new THREE.Vector3(room.center[0], AVATAR_Y, room.center[2]) : new THREE.Vector3(0, AVATAR_Y, 0);
    return c.add(slotOffset(agentId, 2.6)); // spread out so the idle name tags don't overlap
  }

  // spawn flourish: an expanding ring + column of light in the agent's colour
  const bursts: { mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; t: number }[] = [];
  function burst(at: THREE.Vector3, color: string) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.95, 48), additive(color, 0.9));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(at).setY(0.08);
    rt.scene.add(mesh);
    bursts.push({ mesh, t: 0 });
  }

  function avatar(agentId: string): Avatar {
    let a = avatars.get(agentId);
    if (!a) {
      a = new Avatar(rt.scene, agentId, N.agent(agentId), N.color(agentId), homePos(agentId));
      avatars.set(agentId, a);
    }
    return a;
  }
  for (const id of agentIds) avatar(id);

  /** Where an agent stands to work a station: in front of the orb, fanned out per agent. */
  function stationPoint(memId: string, agentId: string) {
    const mem = N.mems.get(memId);
    const pos = rt.memoryPosition(memId) ?? (mem ? new THREE.Vector3(...mem.pos) : null);
    if (!mem || !pos) return null;
    const room = roomById(rt.palace, mem.room);
    const toCenter = room
      ? new THREE.Vector3(room.center[0] - pos.x, 0, room.center[2] - pos.z)
      : new THREE.Vector3(0, 0, 1);
    if (toCenter.lengthSq() < 1e-4) toCenter.set(0, 0, 1);
    toCenter.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), (slot(agentId) - 1) * 0.95);
    return { room: mem.room, point: pos.clone().addScaledVector(toCenter, 1.35).setY(AVATAR_Y) };
  }

  function goStation(agentId: string, memId: string) {
    const a = avatar(agentId);
    const target = stationPoint(memId, agentId);
    if (!target || a.end().distanceTo(target.point) < 0.1) return;
    a.walk(pathBetween(rt.palace, a.end(), target, { y: AVATAR_Y }));
  }

  function standAt(agentId: string, memId: string) {
    const p = stationPoint(memId, agentId);
    if (!p) return null;
    const room = roomById(rt.palace, p.room);
    const team = N.agents.get(agentId)?.team;
    const foreign = !!room && !!team && room.owner !== "shared" && room.owner !== team;
    return { ...p, foreign };
  }

  function goRoom(agentId: string, roomId: string) {
    const a = avatar(agentId);
    const room = roomById(rt.palace, roomId);
    if (!room) return;
    const team = N.agents.get(agentId)?.team;
    // Ownership: a foreign room is approached, not entered — the agent stops at its door (loci rule 3).
    const foreign = !!team && room.owner !== "shared" && room.owner !== team;
    const endRoom = roomAt(rt.palace, a.end());
    if (endRoom?.id === roomId && !foreign) return;
    const point = new THREE.Vector3(room.center[0], AVATAR_Y, room.center[2]).add(slotOffset(agentId, 1.6));
    a.walk(pathBetween(rt.palace, a.end(), { room: roomId, point }, { y: AVATAR_Y, stopAtDoor: foreign }));
  }

  function stepText(agentId: string, memId: string) {
    const r = routes.get(agentId);
    const i = r ? r.indexOf(memId) : -1;
    return i >= 0 ? `${i + 1}/${r!.length}  ${N.memory(memId)}` : N.memory(memId);
  }

  const covered = new Set<string>(); // "agent|memoryId" stations answered for the asker by a handoff reply
  const handoffOf = new Map<string, { agent: string; memoryId: string }>();
  function reset() {
    stations.reset();
    beams.reset();
    routes.clear();
    covered.clear();
    handoffOf.clear();
    for (const id of spawned) {
      avatars.get(id)?.dispose();
      avatars.delete(id);
    }
    spawned.length = 0;
    if (mode !== "overview" && !avatars.has(mode)) setMode("overview");
    for (const a of avatars.values()) a.teleport(homePos(a.id));
    refreshFollow(true);
  }

  function handle(e: PalaceEvent) {
    if (e.type === "train_step") return;
    if (e.type === "spawn") {
      registerSpawn(N, e);
      const room = roomById(rt.palace, e.home) ?? roomById(rt.palace, "foyer");
      const at = room ? new THREE.Vector3(room.center[0], AVATAR_Y, room.center[2]) : new THREE.Vector3(0, AVATAR_Y, 0);
      avatars.get(e.agent)?.dispose();
      const av = new Avatar(rt.scene, e.agent, N.agent(e.agent), e.color, at);
      avatars.set(e.agent, av);
      if (!spawned.includes(e.agent)) spawned.unshift(e.agent);
      av.ping();
      burst(at, e.color);
      setMode(e.agent); // auto-follow the new agent
      return;
    }
    const a = avatar(e.agent);
    switch (e.type) {
      case "task":
        a.setWaiting(false);
        a.ping();
        break;
      case "route":
        routes.set(e.agent, e.stations);
        if (mode === e.agent) refreshFollow(true);
        break;
      case "move":
        a.setWaiting(false);
        goRoom(e.agent, e.to);
        break;
      case "claim":
        a.setWaiting(false);
        goStation(e.agent, e.memoryId);
        stations.claim(e.memoryId, a.color, stepText(e.agent, e.memoryId));
        break;
      case "wait":
        goStation(e.agent, e.memoryId);
        a.setWaiting(true);
        a.setTag(`${a.name}  ⌛ ${N.agent(e.heldBy)}`);
        break;
      case "visit": {
        a.setWaiting(false);
        goStation(e.agent, e.memoryId);
        const title = stepText(e.agent, e.memoryId);
        const text =
          e.verdict === "gap"
            ? `⚠ ${N.memory(e.memoryId)}\ngap: ${e.note ?? "missing"}`
            : e.verdict === "stale"
              ? `${title}\nstale${e.note ? `: ${e.note}` : ""}`
              : `✓ ${title}`;
        stations.verdict(e.memoryId, e.verdict, text);
        break;
      }
      case "handoff":
        beams.open(e.id, a, avatar(e.toAgent), e.question);
        handoffOf.set(e.id, { agent: e.agent, memoryId: e.memoryId });
        break;
      case "reply": {
        beams.reply(e.id, e.answer);
        const h = handoffOf.get(e.id);
        if (h) covered.add(`${h.agent}|${h.memoryId}`);
        break;
      }
      case "phase":
        if (e.phase === "done") a.ping();
        break;
      case "artifact":
        N.mems.set(e.memory.id, e.memory);
        rt.addMemory?.(e.memory);
        a.ping();
        break;
      case "answer":
        a.setWaiting(false);
        a.ping();
        a.setTag(`${a.name}  ${e.blocked ? "✕" : e.gaps?.length ? "⚠" : "✓"}`);
        break;
    }
  }

  const unsub = subscribeRuns(rt, reset, (e) => {
    handle(e);
    if (mode !== "overview") refreshFollow(false);
  });

  // ---- per-frame
  const offFrame = rt.onFrame((dt) => {
    const s = rt.events.speed || 1;
    for (const a of avatars.values()) a.update(dt, s);
    stations.update(dt * Math.max(1, s));
    beams.update(dt * Math.max(1, s));
    route.update(dt);
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i];
      b.t += dt;
      const k = b.t / 1.4;
      b.mesh.scale.setScalar(1 + k * 5);
      b.mesh.material.opacity = 0.9 * (1 - k);
      if (k >= 1) {
        b.mesh.geometry.dispose();
        b.mesh.material.dispose();
        b.mesh.removeFromParent();
        bursts.splice(i, 1);
      }
    }
  });

  // ---- camera: overview (map controls, default) or follow one agent (1-3, click avatar/card)
  const cam = director(rt);
  const route = new RouteView(rt.scene, rt.palace, (id) => rt.memoryPosition(id), (id) => N.memory(id));
  let mode: CamMode = "overview";
  const FOLLOW_DIR = new THREE.Vector3(-0.3, 1.05, 0.95).normalize(); // high third person, same side as overview

  /** How a station on the followed route should look right now. */
  function lookOf(agentId: string, memId: string, i: number, list: string[]): StationLook {
    const st = stations.state(memId);
    if (st === "gap") return "gap";
    if (st === "stale") return "stale";
    if (st === "verified" || covered.has(`${agentId}|${memId}`)) return "done";
    const firstOpen = list.findIndex((m) => {
      const x = stations.state(m);
      return !(x === "verified" || x === "gap" || x === "stale" || covered.has(`${agentId}|${m}`));
    });
    return i === firstOpen ? "current" : "upcoming";
  }

  function routeRooms(list: string[]) {
    const rooms = new Set<string>(["foyer"]);
    for (const m of list) {
      const r = N.mems.get(m)?.room;
      if (r) rooms.add(r);
    }
    return [...rooms];
  }

  function refreshFollow(rebuild: boolean) {
    if (mode === "overview") return;
    const list = routes.get(mode) ?? [];
    const av = avatars.get(mode);
    if (!av) return;
    if (rebuild) {
      route.show(av.color, homePos(mode), list, (m) => standAt(mode, m));
      stations.focus = new Set(); // the route markers carry the labels now; gap notes still show
      rt.focusRooms?.(list.length ? routeRooms(list) : null);
    }
    route.setLooks((m, i) => lookOf(mode, m, i, list));
  }

  function setMode(next: CamMode) {
    if (next !== "overview" && !avatars.has(next)) return;
    if (next === mode && next !== "overview") next = "overview"; // same key again = back to overview
    mode = next;
    route.clear();
    if (mode === "overview") {
      cam.drop("presence");
      stations.focus = null;
      rt.focusRooms?.(null);
      rt.setPalaceDim(1);
      rt.setLayerVisible?.("roomLabels", true);
    } else {
      rt.setPalaceDim(0.55);
      rt.setLayerVisible?.("roomLabels", false);
      refreshFollow(true);
      cam.hold("presence", 1, () => {
        const av = avatars.get(mode);
        if (!av) return null;
        const p = av.group.position.clone().setY(0);
        return { pos: p.clone().addScaledVector(FOLLOW_DIR, 19), look: p, rate: 5 };
      });
    }
    const label = mode === "overview" ? "Overview" : `Following ${N.agent(mode)}`;
    window.dispatchEvent(new CustomEvent(PRESENCE_EVENTS.mode, { detail: { mode, label } }));
  }

  // click an avatar to follow it (ignore drags: the overview pans on drag)
  const ray = new THREE.Raycaster();
  let down = { x: 0, y: 0 };
  const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
  const onClick = (e: MouseEvent) => {
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), rt.camera);
    let best: { id: string; d: number } | null = null;
    for (const a of avatars.values()) {
      // generous hit: distance from the click ray to the avatar centre
      const d = ray.ray.distanceToPoint(a.group.position);
      if (d < 1.2 && (!best || d < best.d)) best = { id: a.id, d };
    }
    if (best) return setMode(best.id);
    // Memory picking for the overview: the scene's own picker has a short ray (built for first person),
    // so from the map camera we pick the orb nearest the click ray ourselves. Rooms are roofless, so no
    // occlusion test is needed; a duplicate select from the scene is harmless (same id).
    let hit: { id: string; along: number } | null = null;
    for (const m of N.mems.values()) {
      const p = rt.memoryPosition(m.id);
      if (!p) continue;
      const along = ray.ray.origin.distanceTo(p);
      const tol = Math.max(0.45, along * 0.011);
      if (ray.ray.distanceToPoint(p) < tol && (!hit || along < hit.along)) hit = { id: m.id, along };
    }
    if (hit) emitUI(UI_EVENTS.select, { memoryId: hit.id });
  };
  rt.renderer.domElement.addEventListener("pointerdown", onDown);
  rt.renderer.domElement.addEventListener("click", onClick);

  // ---- T: dispatch the three demo tasks
  let dispatching = false;
  async function dispatch() {
    if (dispatching) return;
    dispatching = true;
    if (mode !== "overview") setMode("overview");
    const status = (text: string, tone = "info") =>
      window.dispatchEvent(new CustomEvent(PRESENCE_EVENTS.status, { detail: { text, tone } }));
    try {
      if (rt.events.mode === "demo") {
        reset();
        lastReplay = "demo-1";
        await playReplay(rt, "demo-1");
        status("Dispatched 3 department tasks");
        return;
      }
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 4000);
        const res = await fetch(`http://localhost:${PORTS.bridge}/dispatch`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tasks: DEMO_TASKS }),
          signal: ctl.signal,
        });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        status("Dispatched 3 tasks to the agents");
      } catch {
        status("Bridge offline, replaying demo-1 instead", "warn");
        reset();
        await playReplay(rt, "demo-1");
      }
    } finally {
      dispatching = false;
    }
  }

  const onKey = (ev: KeyboardEvent) => {
    const t = ev.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const k = ev.key.toLowerCase();
    if (k === "t") dispatch();
    else if (k === "r") runAgain();
    else if (k >= "1" && k <= "9" && party()[Number(k) - 1]) setMode(party()[Number(k) - 1]);
    else if (k === "0" || k === "o" || k === "f" || k === "h" || (k === "escape" && mode !== "overview")) {
      if (mode === "overview") window.dispatchEvent(new CustomEvent(CAMERA_EVENTS.home));
      else setMode("overview");
    }
  };
  const onCam = (ev: Event) => {
    const m = (ev as CustomEvent).detail?.mode ?? "overview";
    setMode(m === "free" || m === "overhead" ? "overview" : m);
  };
  const onDispatch = () => dispatch();

  // ---- commission a quest: live → bridge; ?demo or bridge down → the recorded quest replay
  let commissioning = false;
  async function commission(task: string) {
    if (commissioning) return;
    commissioning = true;
    const status = (text: string, tone = "info") =>
      window.dispatchEvent(new CustomEvent(PRESENCE_EVENTS.status, { detail: { text, tone } }));
    try {
      if (rt.events.mode === "live") {
        try {
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), 4000);
          const res = await fetch(`http://localhost:${PORTS.bridge}/commission`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ task }),
            signal: ctl.signal,
          });
          clearTimeout(timer);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          status("Quest commissioned. A new agent is on its way.");
          return;
        } catch {
          status("Bridge offline, playing the recorded quest", "warn");
        }
      }
      reset();
      lastReplay = "quest-onboarding";
      if (await playReplay(rt, "quest-onboarding", 30)) {
        if (rt.events.mode === "demo") status("Quest commissioned (recorded run)");
      } else status("No recorded quest yet (fixtures/replays/quest-onboarding.jsonl). Try the department demo.", "warn");
    } finally {
      commissioning = false;
    }
  }
  const onCommission = (ev: Event) => commission(String((ev as CustomEvent).detail?.task ?? "").trim() || "Create an onboarding page for new engineers");
  const onReplay = (ev: Event) => {
    const name = String((ev as CustomEvent).detail?.name ?? lastReplay);
    reset();
    lastReplay = name;
    const speed = Number((ev as CustomEvent).detail?.speed) || undefined;
    void playReplay(rt, name, 20, speed);
  };
  // R = "run it again" (extended cut): contract-run1 (exploring), then contract-run2 (learned route)
  let lastReplay = new URLSearchParams(location.search).get("demo") || "demo-1";
  function runAgain() {
    const next = lastReplay === "contract-run1" ? "contract-run2" : "contract-run1";
    // same pace for both runs, so the learned route visibly finishes sooner
    window.dispatchEvent(new CustomEvent(PRESENCE_EVENTS.replay, { detail: { name: next, speed: 0.7 } }));
    window.dispatchEvent(
      new CustomEvent(PRESENCE_EVENTS.status, {
        detail: { text: next === "contract-run1" ? "Contract task, run 1: no learned route yet" : "Contract task, run 2: walking the learned route" },
      }),
    );
  }
  addEventListener("keydown", onKey);
  addEventListener(PRESENCE_EVENTS.camera, onCam);
  addEventListener(PRESENCE_EVENTS.dispatch, onDispatch);
  addEventListener(PRESENCE_EVENTS.commission, onCommission);
  addEventListener(PRESENCE_EVENTS.replay, onReplay);

  (window as any).presence = { avatars, stations, beams, setMode, dispatch, commission, reset, party, mode: () => mode }; // browser QA

  return () => {
    unsub();
    offFrame();
    removeEventListener("keydown", onKey);
    removeEventListener(PRESENCE_EVENTS.camera, onCam);
    removeEventListener(PRESENCE_EVENTS.dispatch, onDispatch);
    removeEventListener(PRESENCE_EVENTS.commission, onCommission);
    removeEventListener(PRESENCE_EVENTS.replay, onReplay);
    cam.drop("presence");
    rt.renderer.domElement.removeEventListener("pointerdown", onDown);
    rt.renderer.domElement.removeEventListener("click", onClick);
    route.dispose();
    reset();
    for (const a of avatars.values()) a.dispose();
  };
};
