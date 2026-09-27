// OWNED BY: scene (polish). Default camera: a roofless "dollhouse" overview of the whole palace with map
// controls (drag = pan, right-drag / two fingers = rotate, wheel = zoom), clamped so you can't get lost.
// Implements the same surface as the first-person PlayerControls so the runtime's release/restore contract
// (cinematics and follow mode hold the camera, then hand it back) keeps working.
import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import type { PlayerControls } from "../controls";

export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

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
  for (const x of [bounds.minX, bounds.maxX]) for (const z of [bounds.minZ, bounds.maxZ]) for (const y of [0, 1.5]) corners.push(new THREE.Vector3(x, y, z));
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
    const right = new THREE.Vector3(), fwd = new THREE.Vector3();
    for (let it = 0; it < 12; it++) {
      tmpCam.position.copy(target).addScaledVector(dir, dist);
      tmpCam.lookAt(target);
      tmpCam.updateMatrixWorld();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const c of corners) {
        const p = c.clone().project(tmpCam);
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      }
      const scale = Math.max((x1 - x0) / (nx1 - nx0), (y1 - y0) / (ny1 - ny0)) * 1.04;
      // shift so the projected box centre lands on the desired centre
      const dx = (nx0 + nx1) / 2 - (x0 + x1) / 2, dy = (ny0 + ny1) / 2 - (y0 + y1) / 2;
      const halfH = Math.tan(THREE.MathUtils.degToRad(tmpCam.fov / 2)) * dist;
      right.setFromMatrixColumn(tmpCam.matrixWorld, 0).setY(0).normalize();
      fwd.set(-dir.x, 0, -dir.z).normalize();
      target.addScaledVector(right, -dx * halfH * tmpCam.aspect);
      target.addScaledVector(fwd, (-dy * halfH) / Math.sin(ELEVATION));
      dist *= 0.35 + 0.65 * scale;
    }
    return { pos: target.clone().addScaledVector(dir, dist), target };
  }

  // ---- smooth moves (home / focus / restore)
  let anim: null | { t: number; dur: number; p0: THREE.Vector3; p1: THREE.Vector3; t0: THREE.Vector3; t1: THREE.Vector3 } = null;
  function moveTo(pos: THREE.Vector3, target: THREE.Vector3, dur = 1.1) {
    anim = { t: 0, dur, p0: camera.position.clone(), p1: pos, t0: mc.target.clone(), t1: target };
  }

  let released = false;
  const saved = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  const start = overviewPose();
  camera.position.copy(start.pos);
  mc.target.copy(start.target);
  mc.update();

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
  // stop an in-flight glide as soon as the user grabs the map
  dom.addEventListener("pointerdown", () => { anim = null; });
  dom.addEventListener("wheel", () => { anim = null; }, { passive: true });
  return api;
}
