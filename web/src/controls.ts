// OWNED BY: polish (was scene). Camera controls for the palace.
// Default: a game-style overview camera over the whole palace (map controls, damped pan/zoom, WASD/arrows
// pan, Q/E turn), clamped to the palace. ?walk: the original pointer-lock first person with collision.
// Picking lives in scene/index.ts (it owns the orb meshes); this file only moves the camera.
import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { resolveCollision, type Box } from "./scene/layout";

const WALK_MODE = new URLSearchParams(location.search).has("walk");
/** Screen area the HUD covers in the overview (quest log left, party bar bottom), used to frame the palace. */
export const HUD_INSETS = { left: 380, right: 30, top: 380, bottom: 90 };
/** Window events the HUD uses to drive the overview camera (not part of api.ts). */
export const CAMERA_EVENTS = {
  home: "mp:camera-home", // detail: {}
  focus: "mp:camera-focus", // detail: { pos: [x, y, z], distance? }
} as const;

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

function createWalkControls(
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

export function createControls(
  camera: THREE.PerspectiveCamera,
  dom: HTMLElement,
  colliders: Box[],
  isWalkable: (x: number, z: number) => boolean,
): PlayerControls {
  if (WALK_MODE) return createWalkControls(camera, dom, colliders, isWalkable);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const b of colliders) {
    minX = Math.min(minX, b.min[0]); maxX = Math.max(maxX, b.max[0]);
    minZ = Math.min(minZ, b.min[2]); maxZ = Math.max(maxZ, b.max[2]);
  }
  if (!isFinite(minX)) (minX = -20), (maxX = 20), (minZ = -20), (maxZ = 20);
  // frame the actual walls (the palace is a plus shape; its bounding box corners are empty sky)
  const pts: THREE.Vector3[] = [];
  for (const b of colliders) for (const x of [b.min[0], b.max[0]]) for (const z of [b.min[2], b.max[2]]) pts.push(new THREE.Vector3(x, 0, z));
  return createMapView(camera, dom, { minX, maxX, minZ, maxZ }, HUD_INSETS, pts);
}

// ---------------------------------------------------------------- overview (map) camera

interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

export interface MapView extends PlayerControls {
  /** Smoothly return to the framed overview of the whole palace. */
  home(): void;
  /** Smoothly frame a point (e.g. a memory) from closer in. */
  focus(p: THREE.Vector3, distance?: number): void;
  /** Screen area left free by the HUD, in CSS px, used to frame the palace. */
  setInsets(i: { left: number; right: number; top: number; bottom: number }): void;
}

const ELEVATION = THREE.MathUtils.degToRad(52); // camera pitch above the horizon
const AZIMUTH = THREE.MathUtils.degToRad(-18); // slight turn so walls read as a dollhouse, not a plan

export function createMapView(
  camera: THREE.PerspectiveCamera,
  dom: HTMLElement,
  bounds: Bounds,
  initialInsets = { left: 0, right: 0, top: 0, bottom: 0 },
  framePoints: THREE.Vector3[] = [],
): MapView {
  const mc = new MapControls(camera, dom);
  mc.enableDamping = true;
  mc.dampingFactor = 0.12;
  mc.screenSpacePanning = false; // pan across the floor plane
  mc.minPolarAngle = THREE.MathUtils.degToRad(12);
  mc.maxPolarAngle = THREE.MathUtils.degToRad(68);
  mc.zoomToCursor = true;
  mc.panSpeed = 1.2;
  mc.rotateSpeed = 0.6;

  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
  mc.minDistance = 7;
  mc.maxDistance = span * 1.6;
  const center = new THREE.Vector3((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
  let insets = initialInsets;

  // ---- framing: solve target + distance so the palace fills the free part of the screen
  const corners: THREE.Vector3[] = [];
  if (framePoints.length) corners.push(...framePoints);
  else for (const x of [bounds.minX, bounds.maxX]) for (const z of [bounds.minZ, bounds.maxZ]) corners.push(new THREE.Vector3(x, 0, z));
  const tmpCam = camera.clone();
  function overviewPose() {
    const dir = new THREE.Vector3(Math.sin(AZIMUTH) * Math.cos(ELEVATION), Math.sin(ELEVATION), Math.cos(AZIMUTH) * Math.cos(ELEVATION));
    const target = center.clone();
    let dist = span * 0.9;
    const W = innerWidth, H = innerHeight;
    // desired NDC rect
    const nx0 = (insets.left / W) * 2 - 1, nx1 = 1 - (insets.right / W) * 2;
    const ny0 = (insets.bottom / H) * 2 - 1, ny1 = 1 - (insets.top / H) * 2;
    tmpCam.aspect = camera.aspect;
    tmpCam.fov = camera.fov;
    tmpCam.updateProjectionMatrix();
    const right = new THREE.Vector3(), up = new THREE.Vector3();
    for (let it = 0; it < 16; it++) {
      tmpCam.position.copy(target).addScaledVector(dir, dist);
      tmpCam.lookAt(target);
      tmpCam.updateMatrixWorld();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const c of corners) {
        const p = c.clone().project(tmpCam);
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      }
      const scale = Math.max((x1 - x0) / (nx1 - nx0), (y1 - y0) / (ny1 - ny0)) * 1.03;
      // slide the camera in its image plane so the box centre lands on the free area's centre
      const dx = (nx0 + nx1) / 2 - (x0 + x1) / 2, dy = (ny0 + ny1) / 2 - (y0 + y1) / 2;
      const halfH = Math.tan(THREE.MathUtils.degToRad(tmpCam.fov / 2)) * dist;
      right.setFromMatrixColumn(tmpCam.matrixWorld, 0);
      up.setFromMatrixColumn(tmpCam.matrixWorld, 1);
      target.addScaledVector(right, -dx * halfH * tmpCam.aspect).addScaledVector(up, -dy * halfH);
      dist *= Math.pow(scale, 0.8);
    }
    // put the orbit target back on the floor along the same view ray (identical picture)
    const pos = target.clone().addScaledVector(dir, dist);
    const f = dir.clone().negate();
    const ground = pos.clone().addScaledVector(f, -pos.y / f.y);
    return { pos, target: ground };
  }

  // ---- smooth moves (home / focus / restore)
  let anim: null | { t: number; dur: number; p0: THREE.Vector3; p1: THREE.Vector3; t0: THREE.Vector3; t1: THREE.Vector3 } = null;
  function moveTo(pos: THREE.Vector3, target: THREE.Vector3, dur = 1.1) {
    anim = { t: 0, dur, p0: camera.position.clone(), p1: pos, t0: mc.target.clone(), t1: target };
  }

  let released = false;
  const saved = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  let needsFrame = true; // the scene may set its own start pose after creating us; frame on the first update
  const keys = new Set<string>();
  const panKeys: Record<string, [number, number]> = {
    KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
  };
  window.addEventListener("keydown", (e) => {
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (panKeys[e.code] || e.code === "KeyQ" || e.code === "KeyE" || e.code === "Equal" || e.code === "Minus") {
      keys.add(e.code);
      anim = null;
      if (e.code.startsWith("Arrow")) e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => keys.clear());
  const kFwd = new THREE.Vector3(), kRight = new THREE.Vector3(), kOff = new THREE.Vector3();
  function keyboard(dt: number) {
    if (!keys.size) return;
    let fx = 0, fz = 0;
    for (const k of keys) if (panKeys[k]) (fx += panKeys[k][0]), (fz += panKeys[k][1]);
    const dist = camera.position.distanceTo(mc.target);
    camera.getWorldDirection(kFwd).setY(0).normalize();
    kRight.crossVectors(kFwd, camera.up).normalize();
    const speed = Math.max(8, dist * 0.5) * dt;
    const move = kFwd.multiplyScalar(fz * speed).add(kRight.multiplyScalar(fx * speed));
    camera.position.add(move);
    mc.target.add(move);
    const turn = (keys.has("KeyQ") ? 1 : 0) - (keys.has("KeyE") ? 1 : 0);
    const zoom = (keys.has("Minus") ? 1 : 0) - (keys.has("Equal") ? 1 : 0);
    if (turn || zoom) {
      kOff.copy(camera.position).sub(mc.target);
      if (turn) kOff.applyAxisAngle(camera.up, turn * 1.4 * dt);
      if (zoom) kOff.multiplyScalar(THREE.MathUtils.clamp(1 + zoom * 1.2 * dt, 0.5, 1.5));
      kOff.setLength(THREE.MathUtils.clamp(kOff.length(), mc.minDistance, mc.maxDistance));
      camera.position.copy(mc.target).add(kOff);
    }
  }

  const clampTarget = () => {
    const m = 4;
    mc.target.x = THREE.MathUtils.clamp(mc.target.x, bounds.minX - m, bounds.maxX + m);
    mc.target.z = THREE.MathUtils.clamp(mc.target.z, bounds.minZ - m, bounds.maxZ + m);
    mc.target.y = 0;
  };

  const api: MapView = {
    get locked() { return false; },
    get released() { return released; },
    release() {
      if (released) return;
      released = true;
      anim = null;
      saved.pos.copy(camera.position);
      saved.target.copy(mc.target);
      mc.enabled = false;
    },
    restore() {
      if (!released) return;
      released = false;
      mc.enabled = true;
      // continue from wherever the cinematic left the camera, then glide back to the saved view
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      const t = fwd.y < -0.05 ? camera.position.clone().addScaledVector(fwd, -camera.position.y / fwd.y) : saved.target.clone();
      mc.target.copy(t);
      moveTo(saved.pos.clone(), saved.target.clone(), 1.2);
    },
    lock() {},
    unlock() {},
    settle() {},
    onLockChange() {},
    update(dt) {
      if (needsFrame) {
        needsFrame = false;
        const p = overviewPose();
        camera.position.copy(p.pos);
        mc.target.copy(p.target);
        camera.lookAt(p.target);
        mc.update();
      }
      if (released) return;
      if (anim) {
        anim.t = Math.min(1, anim.t + dt / anim.dur);
        const k = anim.t < 0.5 ? 4 * anim.t ** 3 : 1 - (-2 * anim.t + 2) ** 3 / 2;
        camera.position.lerpVectors(anim.p0, anim.p1, k);
        mc.target.lerpVectors(anim.t0, anim.t1, k);
        camera.lookAt(mc.target);
        if (anim.t >= 1) anim = null;
        mc.update(); // keep damping state in sync
        return;
      }
      keyboard(dt);
      mc.update(dt);
      clampTarget();
    },
    home() {
      const p = overviewPose();
      if (released) { saved.pos.copy(p.pos); saved.target.copy(p.target); return; }
      moveTo(p.pos, p.target, 1.1);
    },
    focus(p, distance = 13) {
      const off = camera.position.clone().sub(mc.target);
      if (off.lengthSq() < 1e-6) off.set(0, 1, 1);
      off.setLength(distance);
      if (off.y < distance * 0.55) off.y = distance * 0.55;
      const target = p.clone().setY(0);
      if (released) { saved.pos.copy(target.clone().add(off)); saved.target.copy(target); return; }
      moveTo(target.clone().add(off), target, 1.0);
    },
    setInsets(i) {
      insets = i;
    },
  };
  // keep the framing right when the window changes size
  window.addEventListener("resize", () => { if (!released && !anim) api.home(); });
  window.addEventListener(CAMERA_EVENTS.home, () => api.home());
  window.addEventListener(CAMERA_EVENTS.focus, (e) => {
    const d = (e as CustomEvent).detail ?? {};
    if (Array.isArray(d.pos)) api.focus(new THREE.Vector3(d.pos[0], d.pos[1] ?? 0, d.pos[2]), d.distance);
  });
  // stop an in-flight glide as soon as the user grabs the map
  dom.addEventListener("pointerdown", () => { anim = null; });
  dom.addEventListener("wheel", () => { anim = null; }, { passive: true });
  return api;
}
