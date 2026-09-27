// OWNED BY: scene. Procedural 16x16 pixel-art textures (original art, no asset files) for the voxel palace:
// per-wing block palettes, floors, grass, foliage, lectern/book, cobweb, banners and pixel-font signs.
// Every texture is NearestFilter; block textures have no mipmaps (the far grass does, to stop moire).
import * as THREE from "three";

export type RGB = [number, number, number];

function rng(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const hexRGB = (h: string): RGB => {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mul = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

interface Painter {
  w: number;
  h: number;
  r: () => number;
  set(x: number, y: number, c: RGB | null, a?: number): void;
}

function paint(w: number, h: number, seed: number, fn: (p: Painter) => void): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const img = g.createImageData(w, h);
  const p: Painter = {
    w, h, r: rng(seed),
    set(x, y, col, a = 255) {
      const i = ((y * w + x) | 0) * 4;
      if (!col) { img.data[i + 3] = 0; return; }
      img.data[i] = Math.max(0, Math.min(255, col[0]));
      img.data[i + 1] = Math.max(0, Math.min(255, col[1]));
      img.data[i + 2] = Math.max(0, Math.min(255, col[2]));
      img.data[i + 3] = a;
    },
  };
  fn(p);
  g.putImageData(img, 0, 0);
  return c;
}

export function pixelTex(canvas: HTMLCanvasElement, mips = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = mips ? THREE.NearestMipmapLinearFilter : THREE.NearestFilter;
  t.generateMipmaps = mips;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const noisy = (p: Painter, c: RGB, amt = 0.12) => mul(c, 1 - amt + p.r() * amt * 2);

// ---------------------------------------------------------------- block textures

/** Stone bricks (legal: purple-tinted). 8x4 bricks, running bond. */
export function bricks(base: RGB, mortar: RGB, seed = 1) {
  return paint(16, 16, seed, (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const row = y >> 2, off = (row & 1) * 4;
      const bx = (x + off) & 7, by = y & 3;
      if (by === 3 || bx === 7) p.set(x, y, noisy(p, mortar, 0.06));
      else if (by === 0 || bx === 0) p.set(x, y, noisy(p, mul(base, 1.12), 0.06));
      else p.set(x, y, noisy(p, base, 0.08));
    }
  });
}

/** Cobblestone with optional moss (eng). Voronoi-ish stones with dark cracks. */
export function cobble(base: RGB, moss: RGB | null, seed = 2) {
  return paint(16, 16, seed, (p) => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i < 11; i++) pts.push([p.r() * 16, p.r() * 16, 0.8 + p.r() * 0.35]);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      let d1 = 1e9, d2 = 1e9, k = 1;
      for (const [px, py, kk] of pts) for (const ox of [-16, 0, 16]) for (const oy of [-16, 0, 16]) {
        const d = (x - px - ox) ** 2 + (y - py - oy) ** 2;
        if (d < d1) { d2 = d1; d1 = d; k = kk; } else if (d < d2) d2 = d;
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1) < 1.1;
      let c = edge ? mul(base, 0.55) : noisy(p, mul(base, k), 0.07);
      if (moss && !edge && p.r() < 0.28 + (y < 6 ? 0.25 : 0)) c = noisy(p, moss, 0.15);
      p.set(x, y, c);
    }
  });
}

/** Wooden planks (people). 4 boards, staggered end seams. */
export function planks(base: RGB, seed = 3) {
  return paint(16, 16, seed, (p) => {
    const seams = [3 + ((p.r() * 8) | 0), 9 + ((p.r() * 5) | 0), 1 + ((p.r() * 6) | 0), 11 + ((p.r() * 4) | 0)];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const b = y >> 2;
      let c = mul(base, 0.92 + 0.08 * Math.sin(x * 1.7 + b * 3));
      if ((y & 3) === 3) c = mul(base, 0.6);
      else if (x === seams[b]) c = mul(base, 0.7);
      p.set(x, y, noisy(p, c, 0.05));
    }
  });
}

/** Log bark (sides). */
export function bark(base: RGB, seed = 4) {
  return paint(16, 16, seed, (p) => {
    const cols = Array.from({ length: 16 }, () => 0.75 + p.r() * 0.35);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const k = cols[x] * (x % 4 === 0 ? 0.72 : 1);
      p.set(x, y, noisy(p, mul(base, k), 0.08));
    }
  });
}

/** Sandstone (finance): layered bands, lighter top, chiselled bottom line. */
export function sandstone(base: RGB, seed = 5) {
  return paint(16, 16, seed, (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      let c = noisy(p, base, 0.05);
      if (y < 3) c = noisy(p, mul(base, 1.08), 0.04);
      if (y === 3 || y === 12) c = mul(base, 0.84);
      if (y > 12) c = noisy(p, mul(base, 0.93), 0.05);
      p.set(x, y, c);
    }
  });
}

/** Gold / metal block: bright with bevel and glints. */
export function metalBlock(base: RGB, seed = 6) {
  return paint(16, 16, seed, (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      let c = noisy(p, base, 0.04);
      if (x === 0 || y === 0) c = mul(base, 1.2);
      if (x === 15 || y === 15) c = mul(base, 0.7);
      if ((x + y) % 7 === 0 && x > 2 && x < 13) c = mix(c, [255, 250, 220], 0.35);
      p.set(x, y, c);
    }
  });
}

/** Polished stone (foyer walls): smooth with a bevelled 1px frame. */
export function polished(base: RGB, seed = 7, inset = false) {
  return paint(16, 16, seed, (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      let c = noisy(p, base, 0.03);
      if (x === 0 || y === 0) c = mul(base, 1.1);
      if (x === 15 || y === 15) c = mul(base, 0.72);
      if (inset && (x === 4 || x === 11 || y === 4 || y === 11) && x >= 4 && x <= 11 && y >= 4 && y <= 11) c = mul(base, 0.8);
      p.set(x, y, c);
    }
  });
}

/** Floor tiles: 2x2 checker per block with grout. */
export function checker(a: RGB, b: RGB, seed = 8) {
  return paint(16, 16, seed, (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const on = ((x >> 3) + (y >> 3)) & 1;
      let c = noisy(p, on ? a : b, 0.035);
      if ((x & 7) === 0 || (y & 7) === 0) c = mul(on ? a : b, 1.08);
      if ((x & 7) === 7 || (y & 7) === 7) c = mul(on ? a : b, 0.8);
      p.set(x, y, c);
    }
  });
}

/** Gravel/path (corridors). */
export function gravel(base: RGB, seed = 9) {
  return paint(16, 16, seed, (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = p.r();
      p.set(x, y, mul(base, r < 0.15 ? 0.7 : r > 0.85 ? 1.2 : 0.92 + p.r() * 0.12));
    }
  });
}

/** Grass top. */
export function grass(seed = 10) {
  const base: RGB = [98, 158, 58];
  return paint(16, 16, seed, (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = p.r();
      p.set(x, y, mul(base, r < 0.18 ? 0.82 : r > 0.9 ? 1.14 : 0.94 + p.r() * 0.1));
    }
  });
}

export function leaves(seed = 11) {
  const base: RGB = [62, 128, 44];
  return paint(16, 16, seed, (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = p.r();
      p.set(x, y, r < 0.14 ? mul(base, 0.45) : noisy(p, mul(base, r > 0.8 ? 1.2 : 1), 0.12));
    }
  });
}

/** White wool with weave (tinted per instance: team stripes). */
export function wool(seed = 12) {
  return paint(16, 16, seed, (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const w = ((x + (y >> 1)) & 3) === 0 ? 0.88 : 1;
      p.set(x, y, noisy(p, mul([236, 236, 236], w), 0.04));
    }
  });
}

/** Banner (16x32, white; tinted per instance). Border, chevrons and a diamond. */
export function banner(seed = 13) {
  return paint(16, 32, seed, (p) => {
    for (let y = 0; y < 32; y++) for (let x = 0; x < 16; x++) {
      let c: RGB = noisy(p, [240, 240, 236], 0.03);
      const dx = Math.abs(x - 7.5), dy = Math.abs(y - 13);
      if (dx + dy * 0.7 < 4.5) c = [150, 150, 150];
      if (dx + dy * 0.7 < 2.2) c = [255, 255, 255];
      if (y > 22 && Math.abs(((y - 22) % 5) - dx * 0.5) < 0.8) c = [120, 120, 120];
      if (x === 0 || x === 15 || y === 0) c = [95, 95, 95];
      if (y > 29 && (x & 3) === ((y - 30) * 2 & 3)) { p.set(x, y, null); continue; }
      p.set(x, y, c);
    }
  });
}

/** Lectern wood (top/side). */
export function lectern(seed = 14) {
  return planks([160, 118, 66], seed);
}

/** Book cover: leather with gold corners and spine band. */
export function book(seed = 15) {
  return paint(16, 16, seed, (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      let c: RGB = noisy(p, [132, 58, 40], 0.06);
      if (x < 2) c = [92, 38, 28];
      if ((x > 12 || x < 4) && (y < 3 || y > 12)) c = [236, 196, 84];
      if (y === 7 || y === 8) c = x > 3 && x < 13 ? [236, 196, 84] : c;
      if (x === 15) c = [245, 238, 220];
      p.set(x, y, c);
    }
  });
}

export function cobweb(seed = 16) {
  return paint(16, 16, seed, (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, null);
    const W: RGB = [236, 236, 236];
    for (let i = 0; i < 16; i++) { p.set(i, i, W, 220); p.set(15 - i, i, W, 220); p.set(7, i, W, 200); p.set(i, 7, W, 200); }
    for (const r of [3, 6]) for (let a = 0; a < 24; a++) {
      const x = Math.round(7.5 + Math.cos((a / 24) * Math.PI * 2) * r), y = Math.round(7.5 + Math.sin((a / 24) * Math.PI * 2) * r);
      if (p.r() < 0.8) p.set(x, y, W, 190);
    }
  });
}

/** Cross-quad plants: kind 0 = red flower, 1 = yellow flower, 2 = tall grass. */
export function plant(kind: 0 | 1 | 2, seed = 17) {
  return paint(16, 16, seed + kind, (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, null);
    const G: RGB = [70, 140, 50];
    if (kind === 2) {
      for (let b = 0; b < 6; b++) {
        const bx = 2 + b * 2 + ((p.r() * 2) | 0), top = 3 + ((p.r() * 7) | 0);
        for (let y = top; y < 16; y++) p.set(Math.min(15, bx + (y < 8 && b & 1 ? 1 : 0)), y, noisy(p, G, 0.15));
      }
      return;
    }
    for (let y = 6; y < 16; y++) p.set(7, y, G);
    p.set(6, 11, G); p.set(8, 12, G); p.set(5, 10, G); p.set(9, 11, G);
    const petal: RGB = kind === 0 ? [214, 44, 36] : [246, 212, 40];
    const mid: RGB = kind === 0 ? [60, 30, 20] : [255, 170, 30];
    for (let y = 2; y < 7; y++) for (let x = 5; x < 10; x++) if (Math.abs(x - 7) + Math.abs(y - 4) < 3.2) p.set(x, y, petal);
    p.set(7, 4, mid);
  });
}

export function sun() {
  return paint(16, 16, 18, (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const e = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      p.set(x, y, e < 5 ? [255, 252, 214] : e < 7 ? [255, 236, 150] : [255, 214, 110], e < 7 ? 255 : 150);
    }
  });
}

// ---------------------------------------------------------------- signs & labels

/** Draw text crisply at pixel scale: render, then threshold alpha so edges stay hard. */
function pixelText(g: CanvasRenderingContext2D, text: string, x: number, y: number, color: RGB, font: string) {
  const m = document.createElement("canvas");
  m.width = g.canvas.width;
  m.height = g.canvas.height;
  const mg = m.getContext("2d")!;
  mg.font = font;
  mg.textAlign = "center";
  mg.textBaseline = "middle";
  mg.fillStyle = "#fff";
  mg.fillText(text, x, y);
  const d = mg.getImageData(0, 0, m.width, m.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const on = d.data[i + 3] > 110;
    d.data[i] = color[0]; d.data[i + 1] = color[1]; d.data[i + 2] = color[2];
    d.data[i + 3] = on ? 255 : 0;
  }
  mg.putImageData(d, 0, 0);
  g.drawImage(m, 0, 0);
}

const SIGN_FONT = "bold 11px ui-monospace, Menlo, Consolas, monospace";
const SMALL_FONT = "bold 7px ui-monospace, Menlo, Consolas, monospace";

/** Wooden sign board with a pixel-font title, wing caption and a team-coloured wool stripe. */
export function signTexture(title: string, caption: string, color: string): { tex: THREE.CanvasTexture; aspect: number } {
  const m = document.createElement("canvas").getContext("2d")!;
  m.font = SIGN_FONT;
  const tw = Math.ceil(m.measureText(title).width);
  const W = Math.max(44, tw + 12), H = 26;
  const wood: RGB = [168, 124, 70];
  const team = hexRGB(color);
  const cv = paint(W, H, title.length * 31, (p) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let c: RGB = mul(wood, 0.93 + 0.07 * Math.sin(x * 0.9 + (y >> 2) * 2));
      if ((y & 3) === 3) c = mul(wood, 0.8);
      c = noisy(p, c, 0.04);
      if (y >= H - 5 && y < H - 2) c = noisy(p, team, 0.05);
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) c = [74, 52, 26];
      if (x === 1 || y === 1 || x === W - 2 || y === H - 2) c = mul(wood, 0.62);
      p.set(x, y, c);
    }
  });
  const g = cv.getContext("2d")!;
  pixelText(g, caption.toUpperCase(), W / 2, 6.5, [92, 62, 30], SMALL_FONT);
  pixelText(g, title, W / 2 + 0.5, 14, [44, 28, 12], SIGN_FONT);
  const tex = pixelTex(cv);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return { tex, aspect: W / H };
}

/** Memory label atlas: one row per title, dark translucent plate + white pixel text. */
export interface AtlasRow { v0: number; v1: number; u1: number; aspect: number }
export function labelAtlas(titles: string[]): { tex: THREE.CanvasTexture; rows: AtlasRow[] } {
  const RH = 14, W = 256;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = THREE.MathUtils.ceilPowerOfTwo(Math.max(1, titles.length) * RH);
  const g = c.getContext("2d")!;
  g.font = SIGN_FONT;
  const rows = titles.map((t, i) => {
    let s = t;
    while (g.measureText(s).width > W - 10 && s.length > 4) s = s.slice(0, -2);
    if (s !== t) s = s.slice(0, -1) + "…";
    const w = Math.ceil(g.measureText(s).width) + 8;
    const y0 = i * RH;
    g.fillStyle = "rgba(20,20,20,0.66)";
    g.fillRect(0, y0, w, RH - 1);
    pixelText(g, s, w / 2, y0 + RH / 2, [255, 255, 255], SIGN_FONT);
    return { v0: 1 - (y0 + RH - 1) / c.height, v1: 1 - y0 / c.height, aspect: w / (RH - 1), u1: w / W };
  });
  const tex = pixelTex(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return { tex, rows };
}
