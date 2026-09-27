// OWNED BY: presence. Handoff beams: a light beam between the asking and the answering avatar, from
// `handoff` until the `reply` with the same id; packets travel asker → owner, then the beam fades.
import * as THREE from "three";
import { additive, disposeTree, makeGlow, makeLabel, type Label } from "./fx";
import type { Avatar } from "./avatar";

interface Beam {
  from: Avatar;
  to: Avatar;
  group: THREE.Group;
  core: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  sheath: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  packets: THREE.Sprite[];
  label: Label;
  t: number;
  fade: number | null; // seconds since reply, null while open
}

const UP = new THREE.Vector3(0, 1, 0);

export class Beams {
  private map = new Map<string, Beam>();
  constructor(private scene: THREE.Scene) {}

  open(id: string, from: Avatar, to: Avatar, question: string) {
    this.close(id, true);
    const group = new THREE.Group();
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 8, 1, true), additive("#ffffff", 0.9));
    const sheath = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1, 16, 1, true), additive(from.color, 0.35));
    const packets = [0, 1, 2].map(() => makeGlow(from.color, 0.9, 1));
    const label = makeLabel(`“${question}”`, { color: "#0b0d12", bg: from.color, px: 34, height: 0.36, onTop: true });
    group.add(core, sheath, ...packets, label.sprite);
    this.scene.add(group);
    this.map.set(id, { from, to, group, core, sheath, packets, label, t: 0, fade: null });
  }

  reply(id: string, answer: string) {
    const b = this.map.get(id);
    if (!b) return;
    b.fade = 0;
    b.sheath.material.color.set(b.to.color);
    b.packets.forEach((p) => p.material.color.set(b.to.color));
    b.label.set(`↩ ${answer}`, { bg: b.to.color });
  }

  close(id: string, now = false) {
    const b = this.map.get(id);
    if (!b) return;
    if (!now) return void (b.fade = b.fade ?? 0);
    b.label.dispose();
    disposeTree(b.group);
    this.map.delete(id);
  }

  get openCount() {
    let n = 0;
    for (const b of this.map.values()) if (b.fade === null) n++;
    return n;
  }

  update(dt: number) {
    for (const [id, b] of this.map) {
      b.t += dt;
      const a = b.from.group.position;
      const c = b.to.group.position;
      const len = a.distanceTo(c);
      const mid = a.clone().add(c).multiplyScalar(0.5);
      const dir = c.clone().sub(a).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.lengthSq() ? dir : UP);
      for (const m of [b.core, b.sheath]) {
        m.position.copy(mid);
        m.quaternion.copy(q);
        m.scale.set(1, Math.max(0.01, len), 1);
      }
      // packets: asker → owner while open, owner → asker after the reply
      b.packets.forEach((p, i) => {
        let k = (b.t * 0.7 + i / 3) % 1;
        if (b.fade !== null) k = 1 - k;
        p.position.copy(a).lerp(c, k);
      });
      b.label.sprite.position.copy(mid).add(new THREE.Vector3(0, 0.7, 0));

      const pulse = 0.5 + 0.5 * Math.sin(b.t * 6);
      let alpha = 1;
      if (b.fade !== null) {
        b.fade += dt;
        alpha = Math.max(0, 1 - Math.max(0, b.fade - 1.2) / 0.8); // hold the reply 1.2 s, fade 0.8 s
        if (alpha <= 0) {
          this.close(id, true);
          continue;
        }
      }
      b.core.material.opacity = (0.6 + 0.4 * pulse) * alpha;
      b.sheath.material.opacity = (0.2 + 0.2 * pulse) * alpha;
      b.packets.forEach((p) => (p.material.opacity = alpha));
      b.label.sprite.material.opacity = alpha;
    }
  }

  reset() {
    for (const id of [...this.map.keys()]) this.close(id, true);
  }
}
