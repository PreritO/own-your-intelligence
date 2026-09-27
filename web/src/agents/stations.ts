// OWNED BY: presence. Station state markers around memory orbs: claimed (spinning arcs in agent color),
// verified (green flare, then steady green ring), stale (dim amber ring), gap (pulsing amber + note).
import * as THREE from "three";
import type { Verdict } from "../../../server/schema";
import type { PalaceRuntime } from "../api";
import { additive, COLORS, disposeTree, makeGlow, makeLabel, type Label } from "./fx";

type State = "claimed" | Verdict;

interface Station {
  id: string;
  group: THREE.Group;
  ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  spinner: THREE.Group;
  column: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  glow: THREE.Sprite;
  flare: THREE.Sprite;
  label: Label;
  state: State | null;
  flareT: number; // seconds since the last verdict flare
}

const RING_R = 0.62;

export class Stations {
  private map = new Map<string, Station>();
  private time = 0;
  constructor(private rt: PalaceRuntime) {}

  private get(id: string): Station | null {
    const hit = this.map.get(id);
    if (hit) return hit;
    const pos = this.rt.memoryPosition(id);
    if (!pos) return null;
    const group = new THREE.Group();
    group.position.copy(pos);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.045, 8, 48), additive(COLORS.verified, 0));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.25;

    const spinner = new THREE.Group();
    const arcMat = additive("#ffffff", 0.95);
    for (let i = 0; i < 3; i++) {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(RING_R + 0.12, 0.05, 6, 16, Math.PI / 2.2), arcMat);
      arc.rotation.z = (i * Math.PI * 2) / 3;
      spinner.add(arc);
    }
    spinner.rotation.x = Math.PI / 2;
    spinner.position.y = -0.25;
    spinner.visible = false;

    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.5, 5, 20, 1, true), additive(COLORS.gap, 0));
    column.position.y = 2.1;

    const glow = makeGlow(COLORS.gap, 2.2, 0);
    const flare = makeGlow(COLORS.verified, 0.1, 0);

    const label = makeLabel("", { height: 0.34, px: 36 });
    label.sprite.position.y = 1.05;
    label.sprite.visible = false;

    group.add(ring, spinner, column, glow, flare, label.sprite);
    this.rt.scene.add(group);
    const s: Station = { id, group, ring, spinner, column, glow, flare, label, state: null, flareT: 99 };
    this.map.set(id, s);
    return s;
  }

  claim(id: string, color: string, text: string) {
    const s = this.get(id);
    if (!s) return;
    s.state = "claimed";
    s.spinner.visible = true;
    (s.spinner.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.color.set(color);
    s.ring.material.opacity = 0;
    s.column.material.opacity = 0;
    s.glow.material.opacity = 0;
    s.label.sprite.visible = true;
    s.label.set(text, { color, border: color, bg: "rgba(12,14,20,0.82)" });
  }

  verdict(id: string, verdict: Verdict, text: string) {
    const s = this.get(id);
    if (!s) return;
    s.state = verdict;
    s.spinner.visible = false;
    s.flareT = 0;
    const c = COLORS[verdict];
    s.ring.material.color.set(c);
    s.flare.material.color.set(c);
    s.glow.material.color.set(c);
    s.column.material.color.set(c);
    s.label.sprite.visible = true;
    if (verdict === "gap") s.label.set(text, { color: "#1a1204", bg: "rgba(255,176,32,0.95)", border: "#ffd27a" });
    else if (verdict === "stale") s.label.set(text, { color: "#e9c27a", bg: "rgba(40,28,8,0.8)", border: "rgba(217,164,65,0.6)" });
    else s.label.set(text, { color: COLORS.verified, bg: "rgba(8,24,16,0.78)", border: "rgba(94,242,160,0.45)" });
  }

  state(id: string): State | null {
    return this.map.get(id)?.state ?? null;
  }

  update(dt: number) {
    this.time += dt;
    const t = this.time;
    for (const s of this.map.values()) {
      s.flareT += dt;
      if (s.spinner.visible) s.spinner.rotation.z += dt * 3;
      // verdict flare: expanding glow + rising column, ~1.2 s
      const f = s.flareT;
      if (f < 1.2) {
        const k = f / 1.2;
        s.flare.scale.setScalar(0.5 + 4 * Math.sin(Math.min(1, k * 1.6) * Math.PI * 0.5));
        s.flare.material.opacity = (1 - k) * 0.9;
      } else s.flare.material.opacity = 0;

      switch (s.state) {
        case "verified":
          s.ring.material.opacity = f < 1.2 ? 0.4 + 0.6 * (f / 1.2) : 0.85;
          s.column.material.opacity = f < 1.2 ? 0.35 * (1 - f / 1.2) : 0;
          s.glow.material.opacity = 0;
          break;
        case "stale":
          s.ring.material.opacity = 0.35;
          s.column.material.opacity = f < 1.2 ? 0.2 * (1 - f / 1.2) : 0;
          s.glow.material.opacity = 0.18;
          break;
        case "gap": {
          const p = 0.5 + 0.5 * Math.sin(t * 5);
          s.ring.material.opacity = 0.5 + 0.5 * p;
          s.ring.scale.setScalar(1 + 0.25 * p);
          s.column.material.opacity = 0.12 + 0.18 * p;
          s.glow.material.opacity = 0.35 + 0.45 * p;
          s.glow.scale.setScalar(2 + 0.8 * p);
          s.label.sprite.position.y = 1.05 + 0.06 * Math.sin(t * 2.5);
          break;
        }
      }
    }
  }

  reset() {
    for (const s of this.map.values()) {
      s.label.dispose();
      disposeTree(s.group);
    }
    this.map.clear();
  }
}
