// OWNED BY: scene. Pointer-lock WASD + mouse-look, AABB wall collision. See skill threejs-palace-scene.
// Picking lives in scene/index.ts (it owns the orb meshes); this file only moves the camera.
import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { resolveCollision, type Box } from "./scene/layout";

export const EYE_HEIGHT = 1.6;
const RADIUS = 0.35;
const WALK = 4.2; // m/s
const RUN = 7.5;
const TURN = 1.9; // rad/s for arrow keys when the pointer isn't locked

export interface PlayerControls {
  readonly locked: boolean;
  /** true while a cinematic (walk, follow cam, flyTo) owns the camera. */
  readonly released: boolean;
  release(): void;
  restore(): void;
  lock(): void;
  unlock(): void;
  update(dt: number): void;
  /** Level the camera (no roll) and push it out of walls. */
  settle(): void;
  onLockChange(cb: (locked: boolean) => void): void;
}

function typing(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

export function createControls(
  camera: THREE.PerspectiveCamera,
  dom: HTMLElement,
  colliders: Box[],
  isWalkable: (x: number, z: number) => boolean,
): PlayerControls {
  const plc = new PointerLockControls(camera, dom);
  plc.pointerSpeed = 0.8;
  const keys = new Set<string>();
  const vel = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  let released = false;
  let lastLockExit = 0;
  const saved = { pos: camera.position.clone(), quat: camera.quaternion.clone() };
  const lockCbs: ((l: boolean) => void)[] = [];

  plc.addEventListener("lock", () => lockCbs.forEach((cb) => cb(true)));
  plc.addEventListener("unlock", () => {
    lastLockExit = performance.now();
    keys.clear();
    lockCbs.forEach((cb) => cb(false));
  });

  window.addEventListener("keydown", (e) => {
    if (typing(e) || e.metaKey || e.ctrlKey) return;
    keys.add(e.code);
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => keys.clear());

  const api: PlayerControls = {
    get locked() { return plc.isLocked; },
    get released() { return released; },
    release() {
      if (released) return;
      released = true;
      saved.pos.copy(camera.position);
      saved.quat.copy(camera.quaternion);
      plc.enabled = false;
      if (plc.isLocked) plc.unlock();
      vel.set(0, 0, 0);
    },
    restore() {
      if (!released) return;
      released = false;
      plc.enabled = true;
      // Keep the cinematic's end spot when it's inside the palace, else go back to where we were.
      if (!isWalkable(camera.position.x, camera.position.z)) {
        camera.position.copy(saved.pos);
        camera.quaternion.copy(saved.quat);
      }
      api.settle();
    },
    lock() {
      if (released || plc.isLocked) return;
      // Chrome refuses a re-lock within ~1 s of Esc; don't spam errors.
      if (performance.now() - lastLockExit < 1100) return;
      try {
        const p = dom.requestPointerLock() as unknown;
        if (p && typeof (p as Promise<void>).catch === "function") (p as Promise<void>).catch(() => {});
      } catch { /* ignore */ }
    },
    unlock() { if (plc.isLocked) plc.unlock(); },
    settle() {
      euler.setFromQuaternion(camera.quaternion, "YXZ");
      euler.z = 0;
      euler.x = THREE.MathUtils.clamp(euler.x, -1.2, 1.2);
      camera.quaternion.setFromEuler(euler);
      camera.position.y = EYE_HEIGHT;
      const [x, z] = resolveCollision(camera.position.x, camera.position.z, RADIUS, colliders);
      camera.position.x = x;
      camera.position.z = z;
    },
    onLockChange(cb) { lockCbs.push(cb); },
    update(dt) {
      if (released) return;
      dt = Math.min(dt, 0.1);
      const k = (c: string) => keys.has(c);
      if (!plc.isLocked) {
        // Keyboard look when not pointer-locked (handy for trackpads and headless QA).
        const turn = (k("ArrowLeft") ? 1 : 0) - (k("ArrowRight") ? 1 : 0);
        if (turn) {
          euler.setFromQuaternion(camera.quaternion, "YXZ");
          euler.y += turn * TURN * dt;
          euler.z = 0;
          camera.quaternion.setFromEuler(euler);
        }
      }
      const f = (k("KeyW") || k("ArrowUp") ? 1 : 0) - (k("KeyS") || k("ArrowDown") ? 1 : 0);
      const s = (k("KeyD") ? 1 : 0) - (k("KeyA") ? 1 : 0);
      camera.getWorldDirection(fwd);
      fwd.y = 0;
      fwd.normalize();
      right.crossVectors(fwd, camera.up).normalize();
      const speed = k("ShiftLeft") || k("ShiftRight") ? RUN : WALK;
      const target = fwd.multiplyScalar(f).add(right.multiplyScalar(s));
      if (target.lengthSq() > 0) target.normalize().multiplyScalar(speed);
      // critically-damped-ish smoothing
      vel.lerp(target, 1 - Math.exp(-dt * 12));
      if (vel.lengthSq() < 1e-5) return;
      // sub-step so fast frames can't tunnel through 0.3 m walls
      const steps = Math.max(1, Math.ceil((vel.length() * dt) / 0.12));
      let x = camera.position.x, z = camera.position.z;
      for (let i = 0; i < steps; i++) {
        x += (vel.x * dt) / steps;
        z += (vel.z * dt) / steps;
        [x, z] = resolveCollision(x, z, RADIUS, colliders);
      }
      camera.position.set(x, EYE_HEIGHT, z);
    },
  };
  return api;
}
