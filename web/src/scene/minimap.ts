// OWNED BY: scene. Corner minimap: wings (colours), corridors, memories, player arrow. North (-z) is up.
import type * as THREE from "three";
import type { Palace, Room } from "../../../server/schema";
import type { Layout } from "./layout";

const SIZE = 184; // css px
const PAD = 12;

export function createMinimap(palace: Palace, layout: Layout, parent: HTMLElement, roomColor: (room: Room) => string) {
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
  b.fillStyle = "#6a9f3e"; // grass
  b.fillRect(0, 0, SIZE, SIZE);
  b.fillStyle = "#b2a58a"; // gravel paths
  for (const f of layout.corridorFloors) b.fillRect(X(f.minX), Z(f.minZ), (f.maxX - f.minX) * k, (f.maxZ - f.minZ) * k);
  for (const r of palace.rooms) {
    const c = roomColor(r);
    const x = Math.round(X(r.center[0] - r.size[0] / 2)), z = Math.round(Z(r.center[2] - r.size[2] / 2));
    const w = Math.round(r.size[0] * k), d = Math.round(r.size[2] * k);
    b.fillStyle = "#3a3a3a";
    b.fillRect(x - 1, z - 1, w + 2, d + 2);
    b.fillStyle = c;
    b.fillRect(x, z, w, d);
    b.fillStyle = "rgba(0,0,0,0.18)";
    b.fillRect(x + 2, z + 2, w - 4, d - 4);
  }
  for (const m of palace.memories) {
    b.fillStyle = m.freshness > 0.3 ? "#ffe27a" : "#8a8070";
    b.fillRect(Math.round(X(m.pos[0])) - 1, Math.round(Z(m.pos[2])) - 1, 2, 2);
  }
  // wing initials
  b.font = "700 9px ui-monospace, Menlo, monospace";
  b.textAlign = "center";
  b.textBaseline = "middle";
  for (const w of palace.wings) {
    const rs = palace.rooms.filter((r) => r.wing === w.id);
    if (!rs.length) continue;
    const cx = rs.reduce((s, r) => s + r.center[0], 0) / rs.length;
    const cz = rs.reduce((s, r) => s + r.center[2], 0) / rs.length;
    b.fillStyle = "#1a1a1a";
    b.fillText(w.label.toUpperCase(), X(cx) + 1, Z(cz) + 1);
    b.fillStyle = "#ffffff";
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
        g.fillStyle = "rgba(255,240,160,0.45)";
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
