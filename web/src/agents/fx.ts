// OWNED BY: presence. Small three.js helpers shared by presence and the walk: text sprites, glow sprites.
import * as THREE from "three";

export interface LabelOpts {
  color?: string;
  bg?: string;
  border?: string;
  px?: number; // font size in canvas px
  height?: number; // world height of the sprite in meters
  onTop?: boolean; // ignore depth so it shows through walls
  screen?: number; // constant on-screen height in CSS px (ignores distance); overrides `height`
}

/** A billboard text label. Call `set(text)` to redraw. */
export function makeLabel(text: string, opts: LabelOpts = {}) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: !opts.onTop,
    depthWrite: false,
    sizeAttenuation: !opts.screen,
    toneMapped: false, // text keeps its exact colours under the scene's tone mapping / dim
  });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = opts.onTop ? 20 : 5;
  const px = opts.px ?? 40;
  // sizeAttenuation=false: scale.y maps to NDC height * (1 / P[1][1]); assume the ~60° fov we ship with
  const h = opts.screen ? ((opts.screen / Math.max(400, innerHeight)) * 2) / 1.73 : (opts.height ?? 0.45);
  let cur = { text: "", color: opts.color ?? "#e6e8ee", bg: opts.bg ?? "rgba(12,14,20,0.78)", border: opts.border };

  function draw() {
    const lines = cur.text.split("\n");
    const font = `600 ${px}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
    ctx.font = font;
    const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) + px * 1.1;
    const lh = px * 1.25;
    const hh = Math.ceil(lines.length * lh + px * 0.55);
    canvas.width = w;
    canvas.height = hh;
    ctx.font = font;
    const r = Math.min(px * 0.5, hh / 2);
    ctx.fillStyle = cur.bg;
    ctx.beginPath();
    ctx.roundRect(1, 1, w - 2, hh - 2, r);
    ctx.fill();
    if (cur.border) {
      ctx.strokeStyle = cur.border;
      ctx.lineWidth = Math.max(2, px / 12);
      ctx.stroke();
    }
    ctx.fillStyle = cur.color;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    lines.forEach((l, i) => ctx.fillText(l, w / 2, px * 0.28 + lh * (i + 0.5)));
    tex.needsUpdate = true;
    // new canvas size: replace the texture image dimensions
    tex.image = canvas;
    const lineH = h * (hh / (px * 1.25 + px * 0.55));
    sprite.scale.set((lineH * w) / hh, lineH, 1);
  }

  const api = {
    sprite,
    set(text: string, style: Partial<typeof cur> = {}) {
      const next = { ...cur, ...style, text };
      if (next.text === cur.text && next.color === cur.color && next.bg === cur.bg && next.border === cur.border) return;
      cur = next;
      // CanvasTexture keeps GPU size; recreate when dimensions change
      draw();
      tex.dispose();
    },
    dispose() {
      tex.dispose();
      mat.dispose();
      sprite.removeFromParent();
    },
  };
  api.set(text);
  return api;
}
export type Label = ReturnType<typeof makeLabel>;

let glowTex: THREE.Texture | null = null;
/** Soft radial glow texture (shared). */
export function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.25, "rgba(255,255,255,0.55)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

export function makeGlow(color: string | THREE.Color, size: number, opacity = 1): THREE.Sprite {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture(),
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  s.scale.setScalar(size);
  return s;
}

export function additive(color: string | THREE.Color, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export const COLORS = {
  verified: "#5ef2a0",
  stale: "#d9a441",
  gap: "#ffb020",
  blocked: "#ff5d6c",
};

export function disposeTree(o: THREE.Object3D) {
  o.traverse((x) => {
    const m = x as THREE.Mesh;
    m.geometry?.dispose?.();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((q) => q.dispose());
    else mat?.dispose?.();
  });
  o.removeFromParent();
}
