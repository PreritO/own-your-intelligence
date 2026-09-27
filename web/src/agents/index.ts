// OWNED BY: presence. Agent avatars, station states, handoff beams, camera modes. See skill agent-presence.
// A pure function of rt.events: ?demo replays and the live bridge render identically, and any replay
// speed ends in the same state (markers are set by events; avatars always drain their walk queue).
import * as THREE from "three";
import { PORTS, type PalaceEvent } from "../../../server/schema";
import type { Plugin, PalaceRuntime } from "../api";
import { pathBetween, roomAt, roomById } from "../nav";
import { Avatar, AVATAR_Y } from "./avatar";
import { Beams } from "./beams";
import { director } from "./camera";
import { names, PRESENCE_EVENTS, subscribeRuns } from "./run";
import { Stations } from "./stations";

export const DEMO_TASKS = [
  { agent: "legal", text: "Can we sign the Gripworks contract this week?" },
  { agent: "finance", text: "What did we promise Ada in the last board meeting?" },
  { agent: "eng", text: "Who owns the SOC 2 renewal?" },
];

type CamMode = "free" | "overhead" | string; // string = agent id to follow

export const mountPresence: Plugin = (rt) => {
  const N = names(rt.palace);
  const stations = new Stations(rt);
  const beams = new Beams(rt.scene);
  const avatars = new Map<string, Avatar>();
  const routes = new Map<string, string[]>();
  const agentIds = rt.palace.agents.map((a) => a.id);

  const slot = (agentId: string) => {
    const i = agentIds.indexOf(agentId);
    return i < 0 ? agentIds.length : i;
  };
  const slotOffset = (agentId: string, r = 1.3) => {
    const a = (slot(agentId) * Math.PI * 2) / 3 + Math.PI / 6;
    return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
  };

  function homePos(agentId: string) {
    const room = roomById(rt.palace, N.agents.get(agentId)?.home ?? "") ?? roomById(rt.palace, "foyer") ?? rt.palace.rooms[0];
    const c = room ? new THREE.Vector3(room.center[0], AVATAR_Y, room.center[2]) : new THREE.Vector3(0, AVATAR_Y, 0);
    return c.add(slotOffset(agentId));
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

  function reset() {
    stations.reset();
    beams.reset();
    routes.clear();
    for (const a of avatars.values()) a.teleport(homePos(a.id));
  }

  function handle(e: PalaceEvent) {
    if (e.type === "train_step") return;
    const a = avatar(e.agent);
    switch (e.type) {
      case "task":
        a.setWaiting(false);
        a.ping();
        break;
      case "route":
        routes.set(e.agent, e.stations);
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
        break;
      case "reply":
        beams.reply(e.id, e.answer);
        break;
      case "answer":
        a.setWaiting(false);
        a.ping();
        a.setTag(`${a.name}  ${e.blocked ? "✕" : e.gaps?.length ? "⚠" : "✓"}`);
        break;
    }
  }

  const unsub = subscribeRuns(rt, reset, handle);

  // ---- per-frame
  const offFrame = rt.onFrame((dt) => {
    const s = rt.events.speed || 1;
    for (const a of avatars.values()) a.update(dt, s);
    stations.update(dt * Math.max(1, s));
    beams.update(dt * Math.max(1, s));
  });

  // ---- camera modes: free walk (default), follow agent (1-3), overhead (0 / O)
  const cam = director(rt);
  let mode: CamMode = "free";
  const overhead = overheadPose(rt);
  function setMode(next: CamMode) {
    if (next !== "free" && next !== "overhead" && !avatars.has(next)) return;
    if (next === mode && next !== "free") next = "free"; // pressing the same key again toggles back
    mode = next;
    if (mode === "free") cam.drop("presence");
    else
      cam.hold("presence", 1, () => {
        if (mode === "overhead") return overhead;
        const av = avatars.get(mode);
        if (!av) return null;
        const p = av.group.position;
        return { pos: p.clone().add(new THREE.Vector3(0, 7.5, 8.5)), look: p.clone(), rate: 8 };
      });
    const label = mode === "free" ? "Free walk" : mode === "overhead" ? "Overhead" : `Following ${N.agent(mode)}`;
    window.dispatchEvent(new CustomEvent(PRESENCE_EVENTS.mode, { detail: { mode, label } }));
  }

  // ---- T: dispatch the three demo tasks
  let dispatching = false;
  async function dispatch() {
    if (dispatching) return;
    dispatching = true;
    const status = (text: string, tone = "info") =>
      window.dispatchEvent(new CustomEvent(PRESENCE_EVENTS.status, { detail: { text, tone } }));
    try {
      if (rt.events.mode === "demo") {
        reset();
        await rt.events.restart();
        status("Dispatched 3 tasks (replay)");
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
        await rt.events.restart("demo-1");
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
    else if (k >= "1" && k <= "9" && agentIds[Number(k) - 1]) setMode(agentIds[Number(k) - 1]);
    else if (k === "0" || k === "o") setMode("overhead");
    else if (k === "f" || (k === "escape" && mode !== "free")) setMode("free");
  };
  const onCam = (ev: Event) => setMode((ev as CustomEvent).detail?.mode ?? "free");
  const onDispatch = () => dispatch();
  addEventListener("keydown", onKey);
  addEventListener(PRESENCE_EVENTS.camera, onCam);
  addEventListener(PRESENCE_EVENTS.dispatch, onDispatch);

  (window as any).presence = { avatars, stations, beams, setMode, dispatch, reset }; // browser QA

  return () => {
    unsub();
    offFrame();
    removeEventListener("keydown", onKey);
    removeEventListener(PRESENCE_EVENTS.camera, onCam);
    removeEventListener(PRESENCE_EVENTS.dispatch, onDispatch);
    cam.drop("presence");
    reset();
    for (const a of avatars.values()) a.dispose();
  };
};

function overheadPose(rt: PalaceRuntime) {
  const box = new THREE.Box3();
  for (const r of rt.palace.rooms) {
    box.expandByPoint(new THREE.Vector3(r.center[0] - r.size[0] / 2, 0, r.center[2] - r.size[2] / 2));
    box.expandByPoint(new THREE.Vector3(r.center[0] + r.size[0] / 2, 0, r.center[2] + r.size[2] / 2));
  }
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const vfov = (rt.camera.fov * Math.PI) / 180;
  const aspect = Math.max(0.5, rt.camera.aspect);
  const needZ = size.z / 2 / Math.tan(vfov / 2);
  const needX = size.x / 2 / (Math.tan(vfov / 2) * aspect);
  const h = Math.max(needZ, needX) * 1.08 + 4;
  // a slight tilt reads better than straight down and keeps the up vector well-defined
  return { pos: new THREE.Vector3(c.x, h, c.z + h * 0.18), look: c.clone(), rate: 2.5 };
}
