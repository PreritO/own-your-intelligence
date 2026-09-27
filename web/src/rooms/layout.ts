// OWNED BY: training. Shared helpers for the special rooms: placement outside the wings,
// room shells (floor + low walls + sign), canvas-backed boards, and a tiny camera fly-to.
import * as THREE from "three";
import type { Palace } from "../../../server/schema";
import type { PalaceRuntime } from "../api";

export type SpecialRoomId = "loose-ends" | "workshop" | "gym";

/** Preferred diagonal slots (x, z). Rooms are pushed outward along the diagonal until clear of wings. */
const SLOTS: Record<SpecialRoomId, [number, number]> = {
  "loose-ends": [-24, -24], // between Eng (-x) and People (-z)
  workshop: [24, -24], // between Legal (+x) and People (-z)
  gym: [24, 24], // between Legal (+x) and Finance (+z)
};
export const ROOM_SIZE: [number, number] = [14, 14]; // x, z

export interface Placement { id: SpecialRoomId; center: THREE.Vector3; size: [number, number] }

function overlaps(p: Palace, cx: number, cz: number, pad = 2): boolean {
  const [hw, hd] = [ROOM_SIZE[0] / 2 + pad, ROOM_SIZE[1] / 2 + pad];
  return p.rooms.some((r) => {
    const [rw, , rd] = r.size;
    return Math.abs(r.center[0] - cx) < hw + rw / 2 && Math.abs(r.center[2] - cz) < hd + rd / 2;
  });
}

/** Fixed diagonal coordinates, nudged outward if a (re-exported, bigger) palace would overlap. */
export function placeRooms(palace: Palace): Record<SpecialRoomId, Placement> {
  const out = {} as Record<SpecialRoomId, Placement>;
  for (const id of Object.keys(SLOTS) as SpecialRoomId[]) {
    let [x, z] = SLOTS[id];
    for (let i = 0; i < 40 && overlaps(palace, x, z); i++) { x += Math.sign(x) * 2; z += Math.sign(z) * 2; }
    out[id] = { id, center: new THREE.Vector3(x, 0, z), size: ROOM_SIZE };
  }
  return out;
}

/** Floor, low walls with a doorway facing the foyer, a floating sign. Returns the room group. */
export function buildShell(rt: PalaceRuntime, pl: Placement, label: string, color: string): THREE.Group {
  const g = new THREE.Group();
  g.name = `special-room:${pl.id}`;
  g.position.copy(pl.center);
  const [w, d] = pl.size;
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.1, d),
    new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.22, roughness: 0.9 }),
  );
  g.add(floor);
  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 0.1, d)),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 }),
  );
  g.add(edge);
  // Low walls on the two outer sides (away from the foyer) so the room reads as a place.
  const wallMat = new THREE.MeshStandardMaterial({ color: "#1a1e2a", roughness: 1 });
  const sx = Math.sign(pl.center.x) || 1, sz = Math.sign(pl.center.z) || 1;
  const wallX = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, d), wallMat);
  wallX.position.set((sx * w) / 2, 0.6, 0);
  const wallZ = new THREE.Mesh(new THREE.BoxGeometry(w, 1.2, 0.3), wallMat);
  wallZ.position.set(0, 0.6, (sz * d) / 2);
  g.add(wallX, wallZ);
  const light = new THREE.PointLight(color, 18, 22, 1.6);
  light.position.set(0, 6, 0);
  g.add(light);
  const sign = textSprite(label, color, 64);
  sign.position.set(0, 7.5, 0);
  sign.scale.multiplyScalar(1.4);
  g.add(sign);
  rt.scene.add(g);
  return g;
}

export function textSprite(text: string, color = "#ffffff", px = 48): THREE.Sprite {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  ctx.font = `600 ${px}px ui-sans-serif, system-ui, sans-serif`;
  c.width = Math.ceil(ctx.measureText(text).width + px);
  c.height = Math.ceil(px * 1.5);
  ctx.font = `600 ${px}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.shadowColor = color;
  ctx.shadowBlur = px / 4;
  ctx.fillText(text, px / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(c.width / 100, c.height / 100, 1);
  return s;
}

/** A vertical board backed by a canvas. Call draw(fn) to repaint; it re-uploads the texture. */
export interface Board { mesh: THREE.Mesh; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; draw(fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void }

export function makeBoard(width: number, height: number, px = 1024): Board {
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = Math.round((px * height) / width);
  const ctx = canvas.getContext("2d")!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, toneMapped: false }),
  );
  return {
    mesh, canvas, ctx,
    draw(fn) { ctx.clearRect(0, 0, canvas.width, canvas.height); fn(ctx, canvas.width, canvas.height); tex.needsUpdate = true; },
  };
}

/** Orient a board inside a room so it stands on the far wall and faces the foyer. */
export function mountOnFarWall(pl: Placement, obj: THREE.Object3D, y: number, depth = 0.3) {
  const sx = Math.sign(pl.center.x) || 1, sz = Math.sign(pl.center.z) || 1;
  // Stand across the far-corner diagonal, facing the palace origin (plane normal is +z).
  obj.position.set(sx * pl.size[0] * depth, y, sz * pl.size[1] * depth);
  const wx = pl.center.x + obj.position.x, wz = pl.center.z + obj.position.z;
  obj.rotation.set(0, Math.atan2(-wx, -wz), 0);
}

/** Camera pose that frames an object mounted with mountOnFarWall, from the foyer side. */
export function framePose(pl: Placement, obj: THREE.Object3D, distance: number, lift = 1.5) {
  const target = pl.center.clone().add(obj.position);
  const toOrigin = new THREE.Vector3(-target.x, 0, -target.z).normalize();
  const eye = target.clone().addScaledVector(toOrigin, distance).add(new THREE.Vector3(0, lift, 0));
  return { eye, target };
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, "") + "…";
  }
  return lines;
}

/**
 * Fly the camera to look at a point (cinematic). Releases player controls; Esc or the next
 * flyTo restores them. Uses only the PalaceRuntime contract (camera + controls + onFrame).
 */
let activeFly: (() => void) | null = null;
export function flyTo(rt: PalaceRuntime, eye: THREE.Vector3, target: THREE.Vector3, seconds = 1.4) {
  activeFly?.();
  rt.controls.release();
  const fromPos = rt.camera.position.clone();
  const fromQ = rt.camera.quaternion.clone();
  const probe = new THREE.PerspectiveCamera();
  probe.position.copy(eye);
  probe.lookAt(target);
  const toQ = probe.quaternion.clone();
  let t = 0;
  let holding = true;
  const apply = () => {
    const k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    rt.camera.position.lerpVectors(fromPos, eye, k);
    rt.camera.quaternion.slerpQuaternions(fromQ, toQ, k);
  };
  const off = rt.onFrame((dt) => { t = Math.min(1, t + dt / seconds); if (holding) apply(); });
  // Some control schemes (e.g. OrbitControls.update) re-aim the camera after onFrame callbacks even
  // while released; re-apply the pose right before render so the cinematic always wins.
  const prevBefore = rt.scene.onBeforeRender;
  rt.scene.onBeforeRender = function (...args: Parameters<THREE.Object3D["onBeforeRender"]>) {
    prevBefore.apply(this, args);
    if (holding) { apply(); rt.camera.updateMatrixWorld(); }
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") done(); };
  function done() {
    holding = false;
    rt.scene.onBeforeRender = prevBefore;
    off();
    removeEventListener("keydown", onKey);
    rt.controls.restore();
    activeFly = null;
  }
  addEventListener("keydown", onKey);
  activeFly = done;
  return done;
}

/** Owning team of a memory = owner of its room ("shared" for People/foyer). */
export function memoryOwner(palace: Palace, memoryId: string): string {
  const m = palace.memories.find((x) => x.id === memoryId);
  const r = m && palace.rooms.find((x) => x.id === m.room);
  if (r) return r.owner;
  const prefix = memoryId.split("/")[0];
  return ["legal", "finance", "eng"].includes(prefix) ? prefix : "shared";
}

export function teamColor(palace: Palace, team: string): string {
  return palace.wings.find((w) => w.owner === team || w.id === team)?.color ?? (team === "shared" ? "#7aa2f7" : "#c0c4d0");
}

/** Fetch a JSON fixture; tolerates Vite's SPA fallback (index.html with 200) for missing files. */
export async function fetchJsonOptional<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const text = await res.text();
    if (text.trimStart().startsWith("<")) return null;
    return JSON.parse(text) as T;
  } catch { return null; }
}

export async function fetchTextOptional(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const text = await res.text();
    return text.trimStart().startsWith("<") ? null : text;
  } catch { return null; }
}
