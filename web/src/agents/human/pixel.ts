// OWNED BY: humans. Blocky game-style UI for the voxel humans: a pixel-font nameplate, a blocky status
// bubble with pixel icons, and a pixelated ground ring. Text is drawn small on a canvas, thresholded to
// 1-bit (crisp pixel glyphs, no font files) and magnified with NearestFilter on a screen-constant sprite.
import * as THREE from "three";

const FONT = "10px Menlo, Monaco, 'DejaVu Sans Mono', 'Courier New', monospace";
const GLYPH_H = 13;
/** Nameplate gap above its anchor, in plate heights. */
export const PLATE_LIFT = 0.6; // canvas rows per text line (plate included)

/** Draw `text` as crisp 1-bit pixels at (x, y) (top-left). Returns the drawn width in texels. */
function pixelText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  const m = document.createElement("canvas").getContext("2d")!;
  m.font = FONT;
  const w = Math.max(1, Math.ceil(m.measureText(text).width));
  m.canvas.width = w;
  m.canvas.height = GLYPH_H;
  m.font = FONT;
  m.textBaseline = "middle";
  m.fillStyle = "#fff";
  m.fillText(text, 0, GLYPH_H / 2 + 0.5);
  const src = m.getImageData(0, 0, w, GLYPH_H).data;
  ctx.fillStyle = color;
  for (let py = 0; py < GLYPH_H; py++)
    for (let px = 0; px < w; px++) if (src[(py * w + px) * 4 + 3] > 120) ctx.fillRect(x + px, y + py, 1, 1);
  return w;
}
function textWidth(text: string) {
  const m = document.createElement("canvas").getContext("2d")!;
  m.font = FONT;
  return Math.ceil(m.measureText(text).width);
}

// 7x7 pixel icons for the bubble
const ICONS: Record<string, string[]> = {
  book: ["#######", "#..#..#", "#.##.##", "#..#..#", "#.##.##", "#..#..#", "#######"],
  wait: ["#######", ".#...#.", "..#.#..", "...#...", "..#.#..", ".#####.", "#######"],
  check: ["......#", ".....##", "#...##.", "##.##..", ".###...", "..#....", "......."],
  warn: ["...#...", "..###..", "..#.#..", ".##.##.", ".#####.", "##.#.##", "#######"],
  cross: ["##...##", ".##.##.", "..###..", "..###..", ".##.##.", "##...##", "......."],
  ask: [".####..", "##..##.", "....##.", "...##..", "..##...", ".......", "..##..."],
  spark: ["...#...", "...#...", ".#.#.#.", "..###..", ".#.#.#.", "...#...", "...#..."],
};
const ICON_COLOR: Record<string, string> = {
  book: "#6b4bb8", wait: "#c77a12", check: "#2f9e57", warn: "#c77a12", cross: "#c2413b", ask: "#2f6fc2", spark: "#c29a12",
};
/** Leading symbols callers may use in bubble text -> pixel icon. */
const SYMBOLS: [RegExp, string][] = [
  [/^(⌛|⏳)\s*/u, "wait"],
  [/^(✓|✔)\s*/u, "check"],
  [/^⚠️?\s*/u, "warn"],
  [/^(✕|✗|×)\s*/u, "cross"],
  [/^(📖|📄)\s*/u, "book"],
  [/^(\?|❓)\s*/u, "ask"],
  [/^(✨|★|☆)\s*/u, "spark"],
];

/** Screen-constant sprite: `px` CSS pixels per texel row. Assumes the ~65° fov the scene ships with. */
function sizeSprite(s: THREE.Sprite, texW: number, texH: number, cssPerTexel: number) {
  const hNdc = ((texH * cssPerTexel) / Math.max(400, innerHeight)) * 2 / 1.57;
  s.scale.set((hNdc * texW) / texH, hNdc, 1);
}

class PixelSprite {
  readonly canvas = document.createElement("canvas");
  readonly tex = new THREE.CanvasTexture(this.canvas);
  readonly sprite: THREE.Sprite;
  texH = 1;
  constructor(readonly cssPerTexel: number, renderOrder: number) {
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false, fog: false }),
    );
    this.sprite.renderOrder = renderOrder;
  }
  resize(w: number, h: number) {
    // a CanvasTexture keeps its GPU size: replace it when dimensions change
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.tex.dispose();
    }
    this.texH = h;
    const ctx = this.canvas.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    return ctx;
  }
  layout() {
    sizeSprite(this.sprite, this.canvas.width, this.canvas.height, this.cssPerTexel);
  }
  /** Height on screen in CSS px. */
  get cssH() {
    return this.texH * this.cssPerTexel;
  }
  dispose() {
    this.tex.dispose();
    this.sprite.material.dispose();
    this.sprite.removeFromParent();
  }
}

/** Game-style nameplate: dark translucent plate, white pixel text, a team-colour swatch. */
export class Nameplate extends PixelSprite {
  private text = "";
  constructor(private color: string) {
    super(2, 21);
    this.sprite.center.set(0.5, -PLATE_LIFT); // lifted off the head so overhead views still show the figure
  }
  set(text: string) {
    if (text === this.text) return;
    this.text = text;
    const tw = textWidth(text);
    const w = tw + 15, h = GLYPH_H;
    const ctx = this.resize(w, h);
    ctx.fillStyle = "rgba(8,10,16,0.66)";
    ctx.fillRect(1, 0, w - 2, h);
    ctx.fillRect(0, 1, w, h - 2); // notched corners
    ctx.fillStyle = this.color;
    ctx.fillRect(3, 4, 5, 5);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(4, 8, 4, 1), ctx.fillRect(7, 5, 1, 4);
    pixelText(ctx, text, 11, 0, "#d9dce4"); // below the bloom threshold
    this.tex.needsUpdate = true;
    this.layout();
  }
}

/** Blocky speech bubble: cream plate, 1-texel dark outline, stepped tail, optional pixel icon. */
export class Bubble extends PixelSprite {
  private text: string | null = null;
  constructor() {
    super(1.5, 22);
  }
  set(text: string | null) {
    if (text === this.text) return;
    this.text = text;
    this.sprite.visible = !!text;
    if (!text) return;
    let icon: string | null = null;
    let body = text;
    for (const [re, name] of SYMBOLS)
      if (re.test(body)) {
        icon = name;
        body = body.replace(re, "");
        break;
      }
    const tw = body ? textWidth(body) : 0;
    const iw = icon ? 9 : 0;
    const w = 6 + iw + tw + (body ? 0 : -2), bh = GLYPH_H + 2, h = bh + 4;
    const ctx = this.resize(w, h);
    const ink = "#1a1b22";
    // outline + plate (notched corners)
    ctx.fillStyle = ink;
    ctx.fillRect(1, 0, w - 2, bh);
    ctx.fillRect(0, 1, w, bh - 2);
    ctx.fillStyle = "#d6cfbd"; // cream, kept under the bloom threshold
    ctx.fillRect(1, 1, w - 2, bh - 2);
    ctx.fillStyle = "#bdb5a2";
    ctx.fillRect(1, bh - 2, w - 2, 1);
    // stepped tail, centred
    const cx = Math.floor(w / 2);
    ctx.fillStyle = ink;
    ctx.fillRect(cx - 3, bh - 1, 6, 1), ctx.fillRect(cx - 2, bh, 4, 2), ctx.fillRect(cx - 1, bh + 2, 2, 2);
    ctx.fillStyle = "#bdb5a2";
    ctx.fillRect(cx - 2, bh - 1, 4, 1), ctx.fillRect(cx - 1, bh, 2, 1);
    let x = 3;
    if (icon) {
      ctx.fillStyle = ICON_COLOR[icon];
      ICONS[icon].forEach((row, y) => [...row].forEach((ch, i) => ch === "#" && ctx.fillRect(x + i, 4 + y, 1, 1)));
      x += iw;
    }
    if (body) pixelText(ctx, body, x, 1, ink);
    this.tex.needsUpdate = true;
    this.layout();
  }
}

/** A pixelated ring + soft dark blob for the floor, in team colour. */
export function groundRing(color: string) {
  const N = 32;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const ctx = c.getContext("2d")!;
  const col = new THREE.Color(color);
  const hi = col.clone().lerp(new THREE.Color("#ffffff"), 0.35);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const d = Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2) / (N / 2);
      if (d > 0.66 && d <= 0.97) {
        const c2 = (x + y) % 2 ? col.clone().lerp(hi, 0.4) : hi;
        ctx.fillStyle = `#${c2.getHexString()}`;
        ctx.fillRect(x, y, 1, 1);
      } else if (d <= 0.55) {
        ctx.fillStyle = `rgba(0,0,0,${(0.45 * (1 - d / 0.55) + 0.12).toFixed(3)})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const geo = new THREE.PlaneGeometry(1.7, 1.7);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4 }),
  );
  mesh.renderOrder = 2;
  return { mesh, dispose: () => (tex.dispose(), geo.dispose(), mesh.material.dispose(), mesh.removeFromParent()) };
}

/** Spawn flourish: a burst of little cubes that pop out and fall. One instanced draw call. */
export class BlockBurst {
  readonly mesh: THREE.InstancedMesh;
  private vel: THREE.Vector3[] = [];
  private p: THREE.Vector3[] = [];
  private spin: number[] = [];
  private t = -1;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  constructor(color: string, private n = 26) {
    const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false, fog: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    const white = new THREE.Color("#ffffff");
    const base = new THREE.Color(color);
    for (let i = 0; i < n; i++) this.mesh.setColorAt(i, base.clone().lerp(white, (i % 3) * 0.3));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }
  play() {
    this.t = 0;
    this.mesh.visible = true;
    this.p = [];
    this.vel = [];
    this.spin = [];
    for (let i = 0; i < this.n; i++) {
      const a = (i / this.n) * Math.PI * 2 + Math.random() * 0.4;
      const r = 1.2 + Math.random() * 1.8;
      this.p.push(new THREE.Vector3(0, 0.3 + Math.random() * 1.2, 0));
      this.vel.push(new THREE.Vector3(Math.cos(a) * r, 2.5 + Math.random() * 3, Math.sin(a) * r));
      this.spin.push((Math.random() - 0.5) * 12);
    }
  }
  get active() {
    return this.t >= 0;
  }
  update(dt: number) {
    if (this.t < 0) return;
    this.t += dt;
    const life = 1.1;
    const s = Math.max(0, 1 - this.t / life);
    for (let i = 0; i < this.n; i++) {
      this.vel[i].y -= 12 * dt;
      this.p[i].addScaledVector(this.vel[i], dt);
      if (this.p[i].y < 0.06) (this.p[i].y = 0.06), this.vel[i].multiplyScalar(0.5), (this.vel[i].y *= -0.4);
      this.q.setFromAxisAngle(new THREE.Vector3(1, 1, 0).normalize(), this.spin[i] * this.t);
      this.m.compose(this.p[i], this.q, new THREE.Vector3(s, s, s));
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.t > life) (this.t = -1), (this.mesh.visible = false);
  }
  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
    this.mesh.removeFromParent();
  }
}

/** Re-apply screen-constant sizes (call on resize). */
export function relayout(...s: { layout(): void }[]) {
  s.forEach((x) => x.layout());
}
