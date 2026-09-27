// OWNED BY: polish (presence). Follow-mode route overlay: the followed agent's route drawn on the floor as
// a ribbon through the doors, with a numbered marker over each station (done = green check, current =
// pulsing in the agent colour, upcoming = dim, gap = amber, stale = dull amber).
import * as THREE from "three";
import type { Palace } from "../../../server/schema";
import { pathBetween } from "../nav";
import { COLORS, disposeTree, makeLabel, type Label } from "./fx";

export type StationLook = "done" | "current" | "upcoming" | "gap" | "stale";

const FLOOR_Y = 0.07;

export class RouteView {
  private group = new THREE.Group();
  private markers: { id: string; label: Label; look: StationLook | null; n: number }[] = [];
  private ribbon: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;
  private time = 0;

  constructor(
    private scene: THREE.Scene,
    private palace: Palace,
    private memoryPosition: (id: string) => THREE.Vector3 | undefined,
  ) {
    this.group.name = "follow-route";
    scene.add(this.group);
  }

  /** Draw the route: start → each station (through the doors). `standAt` gives the floor point per station. */
  show(color: string, start: THREE.Vector3, stations: string[], standAt: (id: string) => { room: string; point: THREE.Vector3; foreign: boolean } | null) {
    this.clear();
    const pts: THREE.Vector3[] = [start.clone().setY(FLOOR_Y)];
    let cur = start.clone();
    for (const id of stations) {
      const s = standAt(id);
      if (!s) continue;
      const leg = pathBetween(this.palace, cur, { room: s.room, point: s.point }, { y: FLOOR_Y, stopAtDoor: s.foreign });
      for (const p of leg) pts.push(p.clone().setY(FLOOR_Y));
      cur = leg.length ? leg[leg.length - 1].clone() : cur;
    }
    this.ribbon = ribbon(pts, 0.34, color);
    this.group.add(this.ribbon);

    stations.forEach((id, i) => {
      const pos = this.memoryPosition(id);
      if (!pos) return;
      const label = makeLabel(String(i + 1), { px: 44, screen: 26, onTop: true });
      label.sprite.position.copy(pos).add(new THREE.Vector3(0, 0.55, 0));
      label.sprite.center.set(0.5, 0);
      this.group.add(label.sprite);
      this.markers.push({ id, label, look: null, n: i + 1 });
    });
    this.color = color;
  }
  private color = "#ffffff";

  /** Restyle markers from the current station states. */
  setLooks(lookOf: (id: string, index: number) => StationLook) {
    this.markers.forEach((m, i) => {
      const look = lookOf(m.id, i);
      if (look === m.look) return;
      m.look = look;
      const n = m.n;
      if (look === "done") m.label.set(`✓ ${n}`, { color: "#07170d", bg: COLORS.verified, border: "#c9ffe0" });
      else if (look === "gap") m.label.set(`⚠ ${n} gap`, { color: "#1a1204", bg: COLORS.gap, border: "#ffe2a0" });
      else if (look === "stale") m.label.set(`${n} stale`, { color: "#1a1204", bg: COLORS.stale, border: "#f0d59a" });
      else if (look === "current") m.label.set(`▶ ${n}`, { color: "#0b0d12", bg: this.color, border: "#ffffff" });
      else m.label.set(String(n), { color: "#c9c4b8", bg: "rgba(20,18,26,0.85)", border: "rgba(255,255,255,0.25)" });
      m.label.sprite.userData.base = m.label.sprite.scale.clone();
    });
  }

  update(dt: number) {
    this.time += dt;
    const pulse = 1 + 0.12 * Math.sin(this.time * 6);
    for (const m of this.markers) {
      const base = m.label.sprite.userData.base ?? (m.label.sprite.userData.base = m.label.sprite.scale.clone());
      if (m.look === "current") m.label.sprite.scale.copy(base).multiplyScalar(pulse);
    }
    if (this.ribbon) this.ribbon.material.opacity = 0.5 + 0.1 * Math.sin(this.time * 2);
  }

  clear() {
    for (const m of this.markers) m.label.dispose();
    this.markers = [];
    if (this.ribbon) disposeTree(this.ribbon);
    this.ribbon = null;
  }

  dispose() {
    this.clear();
    this.group.removeFromParent();
  }
}

/** Flat ribbon along a polyline on the floor, with small round joints. */
function ribbon(pts: THREE.Vector3[], width: number, color: string) {
  const pos: number[] = [];
  const side = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (a.distanceToSquared(b) < 1e-6) continue;
    side.subVectors(b, a).cross(up).normalize().multiplyScalar(width / 2);
    const a1 = a.clone().add(side), a2 = a.clone().sub(side), b1 = b.clone().add(side), b2 = b.clone().sub(side);
    pos.push(...a1.toArray(), ...b1.toArray(), ...a2.toArray(), ...a2.toArray(), ...b1.toArray(), ...b2.toArray());
    // joint disc
    const seg = 8;
    for (let k = 0; k < seg; k++) {
      const t0 = (k / seg) * Math.PI * 2, t1 = ((k + 1) / seg) * Math.PI * 2;
      pos.push(b.x, b.y, b.z, b.x + Math.cos(t0) * width / 2, b.y, b.z + Math.sin(t0) * width / 2, b.x + Math.cos(t1) * width / 2, b.y, b.z + Math.sin(t1) * width / 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 3;
  return mesh;
}
