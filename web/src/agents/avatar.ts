// OWNED BY: presence. One agent avatar: glowing orb in team color, name tag, short light trail, and a
// dotted "waiting" ring. Movement is a queue of waypoints (from nav.pathBetween) walked at a speed that
// adapts to the backlog, so the avatar always catches up with the stream and ends where the stream says.
import * as THREE from "three";
import { additive, disposeTree, makeGlow, makeLabel, type Label } from "./fx";

export const AVATAR_Y = 1.75;
const BASE_SPEED = 5; // m/s at 1x
const CATCH_UP = 1.6; // s: the whole backlog is walked in about this long at 1x
const TRAIL = 48;

export class Avatar {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3();
  private queue: THREE.Vector3[] = [];
  private body: THREE.Mesh;
  private halo: THREE.Sprite;
  private light: THREE.PointLight;
  private tag: Label;
  private waitRing: THREE.Group;
  private trail: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private trailPts: THREE.Vector3[] = [];
  private trailAcc = 0;
  private pulse = 0;
  private time = Math.random() * 10;
  private base = new THREE.Color();
  private cruise = BASE_SPEED;
  waiting = false;

  constructor(
    scene: THREE.Scene,
    readonly id: string,
    readonly name: string,
    readonly color: string,
    home: THREE.Vector3,
  ) {
    this.base.set(color);
    this.body = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 24, 16),
      new THREE.MeshBasicMaterial({ color: this.base.clone().lerp(new THREE.Color("#ffffff"), 0.35) }),
    );
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.46, 24, 16), additive(color, 0.16));
    this.halo = makeGlow(color, 2.6, 0.55);
    this.light = new THREE.PointLight(color, 6, 9, 1.6);
    this.light.position.y = 0.2;

    this.tag = makeLabel(name, { color: "#0b0d12", bg: color, px: 42, screen: 20, onTop: true });
    this.tag.sprite.position.y = 0.45;
    this.tag.sprite.center.set(0.5, -0.5); // sit above the orb at any zoom

    this.waitRing = new THREE.Group();
    const dotGeo = new THREE.SphereGeometry(0.06, 8, 6);
    const dotMat = additive(color, 1);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.set(Math.cos(a) * 0.8, 0, Math.sin(a) * 0.8);
      this.waitRing.add(dot);
    }
    this.waitRing.visible = false;

    this.group.add(this.body, shell, this.halo, this.light, this.tag.sprite, this.waitRing);
    scene.add(this.group);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    this.trail = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.trail.frustumCulled = false;
    scene.add(this.trail);

    this.teleport(home);
  }

  teleport(p: THREE.Vector3) {
    this.queue = [];
    this.pos.copy(p);
    this.group.position.copy(p);
    this.trailPts = [];
    this.setWaiting(false);
  }

  /** Append waypoints to the walk. */
  walk(path: THREE.Vector3[]) {
    this.queue.push(...path.map((p) => p.clone()));
    // cruise speed: finish the whole backlog in ~CATCH_UP s (never exponential, so it always lands)
    this.cruise = Math.max(BASE_SPEED, this.remaining() / CATCH_UP);
  }

  private remaining() {
    let len = 0;
    let prev = this.pos;
    for (const p of this.queue) (len += prev.distanceTo(p)), (prev = p);
    return len;
  }

  /** Where the avatar will be once its queue drains (plan new paths from here). */
  end(): THREE.Vector3 {
    return (this.queue[this.queue.length - 1] ?? this.pos).clone();
  }

  get moving() {
    return this.queue.length > 0;
  }

  setTag(text: string) {
    this.tag.set(text);
  }

  setWaiting(on: boolean) {
    this.waiting = on;
    this.waitRing.visible = on;
    this.tag.set(on ? `${this.name}  ⌛` : this.name);
  }

  /** A short bright pulse (task received, answer posted). */
  ping() {
    this.pulse = 1;
  }

  update(dt: number, speed: number) {
    this.time += dt;
    if (this.queue.length) {
      // cruise, then ease into the final stop over the last couple of meters
      const v = Math.min(this.cruise, Math.max(BASE_SPEED * 0.6, this.remaining() * 3));
      let step = v * speed * dt;
      while (step > 0 && this.queue.length) {
        const next = this.queue[0];
        const d = this.pos.distanceTo(next);
        if (d <= step) {
          this.pos.copy(next);
          this.queue.shift();
          step -= d;
        } else {
          this.pos.addScaledVector(next.clone().sub(this.pos).divideScalar(d), step);
          step = 0;
        }
      }
    }
    const bob = this.queue.length ? 0 : Math.sin(this.time * 2.2) * 0.08;
    this.group.position.set(this.pos.x, this.pos.y + bob, this.pos.z);

    this.pulse = Math.max(0, this.pulse - dt * 1.5);
    this.halo.scale.setScalar(2.6 + 2.5 * this.pulse + (this.waiting ? 0.4 * Math.sin(this.time * 4) : 0));
    this.light.intensity = 6 + 10 * this.pulse;
    if (this.waiting) this.waitRing.rotation.y += dt * 1.2;

    // trail: sample positions, fade tail to black (additive => invisible)
    this.trailAcc += dt;
    if (this.trailAcc > 0.04) {
      this.trailAcc = 0;
      const last = this.trailPts[this.trailPts.length - 1];
      if (!last || last.distanceTo(this.pos) > 0.05) this.trailPts.push(this.pos.clone());
      else if (this.trailPts.length) this.trailPts.shift(); // idle: let the tail retract
      if (this.trailPts.length > TRAIL) this.trailPts.shift();
    }
    const posA = this.trail.geometry.getAttribute("position") as THREE.BufferAttribute;
    const colA = this.trail.geometry.getAttribute("color") as THREE.BufferAttribute;
    const n = this.trailPts.length;
    for (let i = 0; i < n; i++) {
      const p = this.trailPts[i];
      posA.setXYZ(i, p.x, p.y - 0.15, p.z);
      const k = (i + 1) / n;
      colA.setXYZ(i, this.base.r * k, this.base.g * k, this.base.b * k);
    }
    posA.needsUpdate = colA.needsUpdate = true;
    this.trail.geometry.setDrawRange(0, n);
  }

  dispose() {
    this.tag.dispose();
    disposeTree(this.group);
    disposeTree(this.trail);
  }
}
