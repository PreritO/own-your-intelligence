// OWNED BY: scene. Corner minimap: wings (colours), corridors, memories, player arrow. North (-z) is up.
import type * as THREE from "three";
import type { Palace } from "../../../server/schema";
import type { Layout } from "./layout";

const SIZE = 184; // css px
const PAD = 12;

export function createMinimap(palace: Palace, layout: Layout, parent: HTMLElement, wingColor: (wing: string) => string) {
  const dpr = Math.min(devicePixelRatio, 2);
  const wrap = document.createElement("div");
  wrap.className = "mp-minimap";
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE * dpr;
  canvas.style.width = canvas.style.height = SIZE + "px";
  wrap.appendChild(canvas);
  parent.appendChild(wrap);
  const g = canvas.getContext("2d")!;

  const { minX, maxX, minZ, maxZ } = layout.bounds;
  const span = Math.max(maxX - minX, maxZ - minZ, 1);
  const k = (SIZE - PAD * 2) / span;
  const ox = PAD + (SIZE - PAD * 2 - (maxX - minX) * k) / 2;
  const oz = PAD + (SIZE - PAD * 2 - (maxZ - minZ) * k) / 2;
  const X = (x: number) => ox + (x - minX) * k;
  const Z = (z: number) => oz + (z - minZ) * k;

  // static layer
  const bg = document.createElement("canvas");
  bg.width = bg.height = SIZE * dpr;
  const b = bg.getContext("2d")!;
  b.scale(dpr, dpr);
  b.fillStyle = "rgba(170,160,140,0.22)";
  for (const f of layout.corridorFloors) b.fillRect(X(f.minX), Z(f.minZ), (f.maxX - f.minX) * k, (f.maxZ - f.minZ) * k);
  for (const r of palace.rooms) {
    const c = wingColor(r.wing);
    const x = X(r.center[0] - r.size[0] / 2), z = Z(r.center[2] - r.size[2] / 2);
    const w = r.size[0] * k, d = r.size[2] * k;
    b.fillStyle = c + "33";
    b.fillRect(x, z, w, d);
    b.strokeStyle = c + "cc";
    b.lineWidth = 1.2;
    b.strokeRect(x + 0.5, z + 0.5, w - 1, d - 1);
  }
  for (const m of palace.memories) {
    b.fillStyle = `rgba(255,${190 + 50 * m.freshness},${120 + 60 * m.freshness},${0.35 + 0.6 * m.freshness})`;
    b.beginPath();
    b.arc(X(m.pos[0]), Z(m.pos[2]), 1.6, 0, Math.PI * 2);
    b.fill();
  }
  // wing initials
  b.font = "600 9px ui-sans-serif, system-ui, sans-serif";
  b.textAlign = "center";
  b.textBaseline = "middle";
  for (const w of palace.wings) {
    const rs = palace.rooms.filter((r) => r.wing === w.id);
    if (!rs.length) continue;
    const cx = rs.reduce((s, r) => s + r.center[0], 0) / rs.length;
    const cz = rs.reduce((s, r) => s + r.center[2], 0) / rs.length;
    b.fillStyle = w.color;
    b.fillText(w.label.toUpperCase(), X(cx), Z(cz));
  }

  let lit = new Set<string>();
  return {
    setLit(rooms: Set<string>) { lit = rooms; },
    draw(camera: THREE.PerspectiveCamera, yaw: number) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.drawImage(bg, 0, 0);
      g.scale(dpr, dpr);
      for (const id of lit) {
        const r = palace.rooms.find((x) => x.id === id);
        if (!r) continue;
        g.fillStyle = wingColor(r.wing) + "55";
        g.fillRect(X(r.center[0] - r.size[0] / 2), Z(r.center[2] - r.size[2] / 2), r.size[0] * k, r.size[2] * k);
      }
      const px = X(camera.position.x), pz = Z(camera.position.z);
      g.save();
      g.translate(px, pz);
      g.rotate(-yaw);
      // view cone
      const cone = g.createRadialGradient(0, 0, 0, 0, 0, 26);
      cone.addColorStop(0, "rgba(255,240,210,0.35)");
      cone.addColorStop(1, "rgba(255,240,210,0)");
      g.fillStyle = cone;
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, 26, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
      g.closePath();
      g.fill();
      g.fillStyle = "#fff6e6";
      g.beginPath();
      g.moveTo(0, -6);
      g.lineTo(4, 4);
      g.lineTo(0, 2);
      g.lineTo(-4, 4);
      g.closePath();
      g.fill();
      g.restore();
    },
  };
}
