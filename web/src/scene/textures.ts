// OWNED BY: scene. Procedural canvas textures (no asset files): marble floor, radial glow, room labels.
import * as THREE from "three";

function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

/** Dark polished marble with faint veins and tile seams. */
export function marbleTexture(): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.fillStyle = "#15171d";
  g.fillRect(0, 0, S, S);
  const r = rng(7);
  // mottling
  for (let i = 0; i < 900; i++) {
    const x = r() * S, y = r() * S, rad = 4 + r() * 28;
    g.fillStyle = `rgba(${40 + r() * 30},${42 + r() * 30},${52 + r() * 30},${0.03 + r() * 0.05})`;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  // veins
  g.lineCap = "round";
  for (let v = 0; v < 14; v++) {
    let x = r() * S, y = r() * S, a = r() * Math.PI * 2;
    g.strokeStyle = `rgba(180,185,200,${0.05 + r() * 0.08})`;
    g.lineWidth = 0.6 + r() * 1.4;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 40; k++) {
      a += (r() - 0.5) * 0.6;
      x += Math.cos(a) * 9;
      y += Math.sin(a) * 9;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // tile seams (texture repeats every 2 m -> 2x2 tiles of 1 m)
  g.strokeStyle = "rgba(0,0,0,0.55)";
  g.lineWidth = 2;
  for (const p of [0, S / 2]) {
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** White radial falloff; used as emissiveMap on floors (room light pool) and for orb floor glow. */
export function radialTexture(inner = 0, soft = 1): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(S / 2, S / 2, inner * S / 2, S / 2, S / 2, S / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.5 * soft, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Two-line label: small wing caption in wing colour + room name. Returns texture and aspect. */
export function labelTexture(title: string, caption: string, color: string): { tex: THREE.CanvasTexture; aspect: number } {
  const font = "600 64px ui-serif, Georgia, 'Times New Roman', serif";
  const capFont = "500 28px ui-sans-serif, system-ui, sans-serif";
  const m = document.createElement("canvas").getContext("2d")!;
  m.font = font;
  const tw = m.measureText(title).width;
  m.font = capFont;
  const cw = m.measureText(caption.toUpperCase().split("").join(" ")).width;
  const W = Math.ceil(Math.max(tw, cw) + 80);
  const H = 150;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = capFont;
  g.fillStyle = color;
  g.globalAlpha = 0.95;
  g.fillText(caption.toUpperCase().split("").join(" "), W / 2, 30);
  g.globalAlpha = 1;
  g.font = font;
  g.shadowColor = color;
  g.shadowBlur = 18;
  g.fillStyle = "#f3eee4";
  g.fillText(title, W / 2, 96);
  g.shadowBlur = 0;
  g.fillStyle = color;
  g.fillRect(W / 2 - 40, 138, 80, 3);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, aspect: W / H };
}

/** Big letter-spaced wing name for the ground outside a wing (seen from overhead). */
export function wingNameTexture(name: string, color: string): { tex: THREE.CanvasTexture; aspect: number } {
  const text = name.toUpperCase().split("").join(String.fromCharCode(8202)); // hair spaces
  const font = "700 150px ui-sans-serif, system-ui, -apple-system, sans-serif";
  const m = document.createElement("canvas").getContext("2d")!;
  m.font = font;
  (m as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "28px";
  const W = Math.ceil(m.measureText(text).width + 140);
  const H = 220;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")! as CanvasRenderingContext2D & { letterSpacing?: string };
  g.font = font;
  g.letterSpacing = "28px";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = color;
  g.shadowBlur = 34;
  g.fillStyle = color;
  g.fillText(text, W / 2, H / 2 + 6);
  g.shadowBlur = 0;
  g.globalAlpha = 0.9;
  g.fillStyle = "#fff6e6";
  g.globalAlpha = 0.35;
  g.fillText(text, W / 2, H / 2 + 6);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, aspect: W / H };
}
