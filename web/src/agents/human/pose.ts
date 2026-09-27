// OWNED BY: humans. Procedural animation for the voxel human: a handful of poses (idle breathing, the
// classic rigid-limb walk, reading, waiting, asking) blended by smoothed weights. No clips, no files.
import * as THREE from "three";
import { BONE, LEG_LEN, NB } from "./rig";

export type Activity = "idle" | "walk" | "reading" | "waiting" | "asking";
const KINDS: Activity[] = ["idle", "walk", "reading", "waiting", "asking"];
const ROOT_Y = NB * 3; // extra slot: vertical offset of the hips (bob / hop)
const SIZE = NB * 3 + 1;

export class Animator {
  private w: Record<Activity, number> = { idle: 1, walk: 0, reading: 0, waiting: 0, asking: 0 };
  private tmp = new Float32Array(SIZE);
  private out = new Float32Array(SIZE);
  private phase = 0;
  private stride = 0; // 0..1 how "walky" (smoothed speed)
  private v = 0; // smoothed ground speed m/s
  private t = Math.random() * 10;
  private rootBase: number;

  constructor(private bones: THREE.Bone[]) {
    this.rootBase = bones[BONE.root].position.y;
  }

  /**
   * @param dt real seconds
   * @param moved metres travelled this frame (drives the walk phase: no foot sliding at any speed)
   * @param target the pose to blend towards
   * @param hop 0..1 extra hop (ping / spawn)
   */
  update(dt: number, moved: number, target: Activity, hop = 0) {
    this.t += dt;
    const k = 1 - Math.exp(-dt * 9);
    const speed = dt > 0 ? moved / dt : 0;
    this.v += (speed - this.v) * (1 - Math.exp(-dt * 6));
    this.stride += ((target === "walk" ? Math.min(1, this.v / 2.5) : 0) - this.stride) * k;
    // stride length grows with speed; cap the cadence at ~3 steps/s so fast catch-up doesn't flail
    const L = Math.max(1.5 + 0.12 * this.v, this.v / 3.2);
    this.phase = (this.phase + (moved / L) * Math.PI * 2) % (Math.PI * 200);
    for (const kind of KINDS) this.w[kind] += ((kind === target ? 1 : 0) - this.w[kind]) * k;

    this.out.fill(0);
    let sum = 0;
    for (const kind of KINDS) {
      const wk = this.w[kind];
      if (wk < 0.002) continue;
      this.tmp.fill(0);
      this.pose(kind, this.tmp);
      for (let i = 0; i < SIZE; i++) this.out[i] += this.tmp[i] * wk;
      sum += wk;
    }
    if (sum > 0) for (let i = 0; i < SIZE; i++) this.out[i] /= sum;
    for (let b = 0; b < NB; b++) this.bones[b].rotation.set(this.out[b * 3], this.out[b * 3 + 1], this.out[b * 3 + 2]);
    this.bones[BONE.root].position.y = this.rootBase + this.out[ROOT_Y] + Math.sin(Math.PI * hop) * 0.28 * (hop > 0 ? 1 : 0);
  }

  private pose(kind: Activity, p: Float32Array) {
    const t = this.t;
    const set = (b: number, x: number, y = 0, z = 0) => ((p[b * 3] = x), (p[b * 3 + 1] = y), (p[b * 3 + 2] = z));
    const breathe = Math.sin(t * 1.9);
    switch (kind) {
      case "idle":
        set(BONE.spine, 0.015 * breathe);
        set(BONE.head, 0.03 * Math.sin(t * 0.6), 0.18 * Math.sin(t * 0.37), 0);
        set(BONE.armL, 0.03 * breathe, 0, 0.05 + 0.025 * breathe);
        set(BONE.armR, -0.03 * breathe, 0, -0.05 - 0.025 * breathe);
        p[ROOT_Y] = 0.008 * breathe;
        break;
      case "walk": {
        const s = this.stride;
        const A = s * Math.min(0.95, 0.5 + 0.06 * this.v);
        const sw = Math.sin(this.phase);
        set(BONE.legL, -A * sw);
        set(BONE.legR, A * sw);
        set(BONE.armL, A * sw * 0.9, 0, 0.06);
        set(BONE.armR, -A * sw * 0.9, 0, -0.06);
        set(BONE.spine, s * Math.min(0.14, 0.02 * this.v), 0.06 * s * sw);
        set(BONE.head, -0.04 * s + 0.05 * s * Math.cos(this.phase * 2), -0.05 * s * sw);
        // rigid legs: drop the hips as they spread so the feet stay on the floor (that's the head bob)
        p[ROOT_Y] = -LEG_LEN * (1 - Math.cos(A * Math.abs(sw)));
        break;
      }
      case "reading":
        set(BONE.spine, 0.04 + 0.01 * breathe);
        set(BONE.head, 0.42 + 0.03 * Math.sin(t * 0.9), 0.1 * Math.sin(t * 0.7));
        set(BONE.armL, -1.05, 0, -0.16);
        set(BONE.armR, -1.05 + 0.06 * Math.max(0, Math.sin(t * 0.8)), 0, 0.16); // turns a page now and then
        p[ROOT_Y] = 0.006 * breathe;
        break;
      case "waiting": {
        // arms folded across the belly, weight on one leg, tapping the other foot, glancing around
        const tapOn = Math.sin(t * 1.1) > -0.3 ? 1 : 0;
        const tap = tapOn * Math.max(0, Math.sin(t * 9));
        set(BONE.spine, 0.01 * breathe, 0, 0.035);
        set(BONE.head, -0.06, 0.35 * Math.sin(t * 0.8), 0.05);
        set(BONE.armL, -0.95, 0.15, -0.72);
        set(BONE.armR, -1.12, -0.15, 0.72);
        set(BONE.legL, 0, 0, 0.04);
        set(BONE.legR, -0.18 * tap, 0, -0.05);
        p[ROOT_Y] = 0.006 * breathe;
        break;
      }
      case "asking":
        set(BONE.spine, -0.03);
        set(BONE.head, -0.15, 0.08 * Math.sin(t * 1.3));
        set(BONE.armR, -2.5 + 0.2 * Math.sin(t * 7), 0, -0.25 + 0.12 * Math.sin(t * 7)); // hand up, waving
        set(BONE.armL, 0.02 * breathe, 0, 0.06);
        p[ROOT_Y] = 0.006 * breathe;
        break;
    }
  }
}
