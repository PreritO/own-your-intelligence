// OWNED BY: scene. PHASE 0 PLACEHOLDER: flat floors, orbs and an orbit camera so plugins
// have a working PalaceRuntime from minute one. Replace freely; keep the PalaceRuntime contract.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Palace } from "../../../server/schema";
import type { PalaceRuntime } from "../api";
import type { EventStream } from "../events";

export function buildScene(palace: Palace, mount: HTMLElement, hud: HTMLElement, events: EventStream): PalaceRuntime {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0b0d12");
  scene.add(new THREE.HemisphereLight("#aab4ff", "#101018", 0.6));
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 500);
  camera.position.set(0, 55, 45);
  const orbit = new OrbitControls(camera, renderer.domElement);

  const wingColor = new Map(palace.wings.map((w) => [w.id, w.color]));
  const roomMats = new Map<string, THREE.MeshStandardMaterial>();
  for (const r of palace.rooms) {
    const mat = new THREE.MeshStandardMaterial({ color: wingColor.get(r.wing) ?? "#888", transparent: true, opacity: 0.25 });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(r.size[0], 0.1, r.size[2]), mat);
    floor.position.set(r.center[0], 0, r.center[2]);
    scene.add(floor);
    roomMats.set(r.id, mat);
  }

  const orbs = new Map<string, THREE.Mesh>();
  for (const m of palace.memories) {
    const mat = new THREE.MeshStandardMaterial({ color: "#ffd9a0", emissive: "#ffb347", emissiveIntensity: 0.2 + 1.8 * m.freshness });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12), mat);
    orb.position.set(...m.pos);
    orb.userData.memoryId = m.id;
    scene.add(orb);
    orbs.set(m.id, orb);
  }

  const frameCbs = new Set<(dt: number) => void>();
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    frameCbs.forEach((cb) => cb(dt));
    orbit.update();
    renderer.render(scene, camera);
  });
  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  return {
    palace, scene, camera, renderer, hud, events,
    memoryPosition: (id) => orbs.get(id)?.position.clone(),
    setMemoryGlow(id, v) {
      const o = orbs.get(id);
      const m = palace.memories.find((x) => x.id === id);
      if (o && m) (o.material as THREE.MeshStandardMaterial).emissiveIntensity = v ?? 0.2 + 1.8 * m.freshness;
    },
    setPalaceDim: (level) => { scene.traverse((o) => { if ((o as any).isHemisphereLight) (o as THREE.Light).intensity = 0.6 * level; }); },
    setRoomLit: (roomId, lit) => { const m = roomMats.get(roomId); if (m) m.opacity = lit ? 0.6 : 0.25; },
    controls: { release() { orbit.enabled = false; }, restore() { orbit.enabled = true; }, get locked() { return false; } },
    onFrame(cb) { frameCbs.add(cb); return () => frameCbs.delete(cb); },
  };
}
