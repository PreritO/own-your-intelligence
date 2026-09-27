// OWNED BY: presence. One camera director shared by the presence camera modes and the walk cinematic.
// Whoever holds the camera supplies a pose per frame; the director calls rt.controls.release() when the
// first holder arrives and rt.controls.restore() when the last one leaves. The pose is re-applied right
// before render so a player controller that still writes the camera (e.g. OrbitControls.update's
// lookAt) cannot fight it.
import * as THREE from "three";
import type { PalaceRuntime } from "../api";

export interface Pose {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  /** Smoothing rate (1/s). Higher = snappier. Default 4. */
  rate?: number;
}
type PoseFn = (dt: number) => Pose | null;

/** Higher priority wins: walk (2) over presence modes (1). */
export interface Director {
  hold(id: string, priority: number, fn: PoseFn): void;
  drop(id: string): void;
  holder(): string | null;
}

const directors = new WeakMap<PalaceRuntime, Director>();

export function director(rt: PalaceRuntime): Director {
  const existing = directors.get(rt);
  if (existing) return existing;

  const holders = new Map<string, { priority: number; fn: PoseFn }>();
  const cam = rt.camera;
  const curPos = new THREE.Vector3();
  const curLook = new THREE.Vector3();
  let active = false;
  let applied: { pos: THREE.Vector3; quat: THREE.Quaternion } | null = null;

  const top = () => {
    let best: [string, { priority: number; fn: PoseFn }] | null = null;
    for (const h of holders) if (!best || h[1].priority >= best[1].priority) best = h;
    return best;
  };

  rt.onFrame((dt) => {
    const h = top();
    if (!h) {
      applied = null;
      return;
    }
    const pose = h[1].fn(dt);
    if (!pose) return;
    if (!active) {
      active = true;
      curPos.copy(cam.position);
      cam.getWorldDirection(curLook).multiplyScalar(10).add(cam.position);
    }
    const k = 1 - Math.exp(-dt * (pose.rate ?? 4));
    curPos.lerp(pose.pos, k);
    curLook.lerp(pose.look, k);
    // Matrix4.lookAt(eye, target) is the camera convention (looks down -z)
    const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(curPos, curLook, cam.up));
    applied = { pos: curPos.clone(), quat };
    cam.position.copy(applied.pos);
    cam.quaternion.copy(applied.quat);
  });

  // Re-apply just before rendering (after any controller update in the scene's loop).
  const prev = rt.scene.onBeforeRender;
  rt.scene.onBeforeRender = function (...args: Parameters<THREE.Object3D["onBeforeRender"]>) {
    prev.apply(this, args);
    if (applied && holders.size) {
      cam.position.copy(applied.pos);
      cam.quaternion.copy(applied.quat);
      cam.updateMatrixWorld();
    }
  };

  const d: Director = {
    hold(id, priority, fn) {
      if (!holders.size) rt.controls.release();
      holders.set(id, { priority, fn });
    },
    drop(id) {
      if (!holders.delete(id)) return;
      if (!holders.size) {
        active = false;
        applied = null;
        rt.controls.restore();
      }
    },
    holder: () => top()?.[0] ?? null,
  };
  directors.set(rt, d);
  return d;
}
