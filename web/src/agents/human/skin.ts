// OWNED BY: humans. Procedural pixel-art "skin" for a blocky voxel character: one small canvas atlas per
// agent (NearestFilter), painted face by face, plus boxes whose UVs point into that atlas. All original
// art: our own face, emblems, hair and hats; nothing copied from any game.
import * as THREE from "three";

/** One texel = one voxel "pixel" of the figure: 32 px tall = 1.75 m. */
export const PX = 1.75 / 32;

export type Paint = (set: (x: number, y: number, c: THREE.Color) => void, w: number, h: number) => void;
export interface BoxPaint {
  front: Paint; // +z
  back: Paint; // -z
  left: Paint; // +x (the figure's own left)
  right: Paint; // -x
  top: Paint;
  bottom: Paint;
}

/** FNV-1a, for deterministic per-agent variation. */
export function hash(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

const SKIN = ["#f6d7bf", "#eab893", "#d39a6e", "#a8704a", "#7b4d31", "#5b3a26"];
const HAIR = ["#2b1d15", "#583420", "#94592c", "#d6ad62", "#17171d", "#a8452a", "#d9d4ca"];
const HAT = ["#e8e2d4", "#2f3a5c", "#c2453d", "#2e6b58", "#f0c24b", "#4a3c6b"];
export type Accessory = "cap" | "beanie" | "headphones" | "glasses" | "sprout";
const ACCESSORIES: Accessory[] = ["cap", "beanie", "headphones", "glasses", "sprout"];
export type Emblem = "legal" | "finance" | "eng" | "star";

export interface Look {
  shirt: THREE.Color;
  shirtDark: THREE.Color;
  trousers: THREE.Color;
  shoes: THREE.Color;
  skin: THREE.Color;
  hair: THREE.Color;
  hat: THREE.Color;
  longHair: boolean;
  accessory: Accessory;
  emblem: Emblem;
  seed: number;
}

export function lookFor(id: string, teamColor: string): Look {
  const h = hash(`mp-human:${id}`);
  const shirt = new THREE.Color(teamColor);
  const key = id.toLowerCase();
  const emblem: Emblem = key.includes("legal") ? "legal" : key.includes("fin") ? "finance" : key.includes("eng") ? "eng" : "star";
  return {
    shirt,
    shirtDark: shirt.clone().multiplyScalar(0.62),
    trousers: shirt.clone().lerp(new THREE.Color("#262b3f"), 0.8),
    shoes: new THREE.Color("#1c1d24"),
    skin: new THREE.Color(SKIN[h % SKIN.length]),
    hair: new THREE.Color(HAIR[(h >>> 4) % HAIR.length]),
    hat: new THREE.Color(HAT[(h >>> 8) % HAT.length]),
    longHair: ((h >>> 12) & 1) === 1,
    accessory: ACCESSORIES[(h >>> 14) % ACCESSORIES.length],
    emblem,
    seed: h,
  };
}

/** Deterministic ±6% brightness jitter per texel: the hand-painted voxel look. */
function jitter(c: THREE.Color, x: number, y: number, seed: number, amt = 0.06) {
  const n = hash(`${x},${y},${seed}`) / 0xffffffff;
  return c.clone().multiplyScalar(1 + (n - 0.5) * 2 * amt);
}

export class Atlas {
  readonly canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  private cx = 0;
  private cy = 0;
  private rowH = 0;
  readonly texture: THREE.CanvasTexture;

  constructor(readonly size = 128, private seed = 0) {
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext("2d")!;
    this.img = this.ctx.createImageData(size, size);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestMipmapLinearFilter;
  }

  /** Shelf-pack a w x h region (1 px gutter) and paint it. Returns its top-left corner. */
  region(w: number, h: number, paint: Paint) {
    const W = Math.ceil(w), H = Math.ceil(h);
    if (this.cx + W > this.size) (this.cx = 0), (this.cy += this.rowH + 1), (this.rowH = 0);
    if (this.cy + H > this.size) throw new Error("human atlas full");
    const x0 = this.cx, y0 = this.cy;
    const d = this.img.data;
    const tmp = new THREE.Color();
    paint(
      (x, y, c) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        (x = Math.floor(x)), (y = Math.floor(y));
        tmp.copy(jitter(c, x0 + x, y0 + y, this.seed));
        const i = ((y0 + y) * this.size + x0 + x) * 4;
        // canvas pixels are sRGB bytes
        const s = tmp.clone().convertLinearToSRGB();
        d[i] = Math.round(THREE.MathUtils.clamp(s.r, 0, 1) * 255);
        d[i + 1] = Math.round(THREE.MathUtils.clamp(s.g, 0, 1) * 255);
        d[i + 2] = Math.round(THREE.MathUtils.clamp(s.b, 0, 1) * 255);
        d[i + 3] = 255;
      },
      W,
      H,
    );
    this.cx += W + 1;
    this.rowH = Math.max(this.rowH, H);
    return { x: x0, y: y0, w, h };
  }

  commit() {
    this.ctx.putImageData(this.img, 0, 0);
    this.texture.needsUpdate = true;
  }

  /**
   * A box of w x h x d voxel pixels (centered on `at`, in pixels) with each face mapped to its own
   * painted atlas region. BoxGeometry face order: +x, -x, +y, -y, +z, -z.
   */
  box(w: number, h: number, d: number, paint: BoxPaint): THREE.BoxGeometry {
    const g = new THREE.BoxGeometry(w * PX, h * PX, d * PX);
    const faces: [number, number, Paint][] = [
      [d, h, paint.left],
      [d, h, paint.right],
      [w, d, paint.top],
      [w, d, paint.bottom],
      [w, h, paint.front],
      [w, h, paint.back],
    ];
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    faces.forEach(([fw, fh, p], f) => {
      const r = this.region(fw, fh, p);
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        const u = uv.getX(i), v = uv.getY(i);
        uv.setXY(i, (r.x + u * fw) / this.size, 1 - (r.y + (1 - v) * fh) / this.size);
      }
    });
    return g;
  }
}

// ---------- painters ----------
export const fill = (c: THREE.Color): Paint => (set, w, h) => {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(x, y, c);
};

const EMBLEMS: Record<Emblem, string[]> = {
  legal: [".##.", "####", "#..#", "#..#", "####"], // a tiny courthouse
  finance: [".##.", "#.##", "##.#", "#.##", ".##."], // a coin
  eng: ["#..#", ".##.", "####", ".##.", "#..#"], // a cog
  star: ["..#..", ".###.", "#####", ".###.", "..#.."],
};

export function paintFigure(L: Look) {
  const white = new THREE.Color("#f4f1ea");
  const eye = new THREE.Color("#1b1b24");
  const blush = L.skin.clone().lerp(new THREE.Color("#e0706a"), 0.35);
  const mouth = L.skin.clone().multiplyScalar(0.55);
  const skinShade = L.skin.clone().multiplyScalar(0.85);
  const hairHi = L.hair.clone().lerp(white, 0.12);
  const badge = L.shirt.clone().lerp(white, 0.75);

  const head: BoxPaint = {
    front: (set, w, h) => {
      fill(L.skin)(set, w, h);
      for (let x = 0; x < w; x++) set(x, 0, L.hair), set(x, 1, x % 3 === 1 ? hairHi : L.hair);
      set(0, 2, L.hair), set(w - 1, 2, L.hair);
      if (L.longHair) for (let y = 2; y < 6; y++) set(0, y, L.hair), set(w - 1, y, L.hair);
      // eyes: two tall dots with a glint; blush; a small smile
      for (const x of [2, 5]) set(x, 3, eye), set(x, 4, eye);
      set(2, 3, eye.clone().lerp(white, 0.5));
      set(1, 5, blush), set(6, 5, blush);
      set(3, 6, mouth), set(4, 6, mouth);
      if (L.accessory === "glasses") {
        // round-ish gold frames around each eye; the eyes stay visible
        const f = new THREE.Color("#d8b458");
        for (const x of [1, 2, 3, 4, 5, 6]) set(x, 2, f);
        for (const x of [1, 3, 4, 6]) set(x, 3, f), set(x, 4, f);
        set(2, 5, f), set(5, 5, f);
      }
    },
    back: (set, w, h) => {
      fill(L.hair)(set, w, h);
      if (!L.longHair) for (let x = 0; x < w; x++) set(x, h - 1, skinShade);
      for (let x = 1; x < w; x += 3) set(x, 2, hairHi);
    },
    left: (set, w, h) => side(set, w, h, false),
    right: (set, w, h) => side(set, w, h, true),
    top: (set, w, h) => {
      fill(L.hair)(set, w, h);
      set(2, 3, hairHi), set(5, 5, hairHi), set(3, 1, hairHi);
    },
    bottom: fill(skinShade),
  };
  // side of head: w = depth (8). u runs front->back on the +x face and back->front on the -x face.
  function side(set: (x: number, y: number, c: THREE.Color) => void, w: number, h: number, mirrored: boolean) {
    fill(L.skin)(set, w, h);
    for (let i = 0; i < w; i++) {
      const x = mirrored ? w - 1 - i : i; // i = 0 at the front
      const hairRows = i < 2 ? 2 : i < 5 ? 3 : L.longHair ? h : h - 1;
      for (let y = 0; y < hairRows; y++) set(x, y, L.hair);
    }
    const ear = mirrored ? w - 5 : 4;
    set(ear, 4, skinShade), set(ear, 5, skinShade);
    if (L.accessory === "glasses") for (let i = 0; i < 4; i++) set(mirrored ? w - 1 - i : i, 2, new THREE.Color("#d8b458"));
  }

  const torso: BoxPaint = {
    front: (set, w, h) => {
      fill(L.shirt)(set, w, h);
      set(3, 0, L.skin), set(4, 0, L.skin), set(3, 1, L.shirtDark), set(4, 1, L.shirtDark); // collar
      for (let x = 0; x < w; x++) set(x, h - 1, L.trousers), set(x, h - 2, L.shirtDark); // hem + belt
      set(3, h - 1, new THREE.Color("#b8a15a"));
      const g = EMBLEMS[L.emblem];
      const ox = Math.floor((w - g[0].length) / 2), oy = 3;
      for (let y = -1; y <= g.length; y++) for (let x = -1; x <= g[0].length; x++) set(ox + x, oy + y, L.shirtDark);
      g.forEach((row, y) => [...row].forEach((ch, x) => ch === "#" && set(ox + x, oy + y, badge)));
    },
    back: (set, w, h) => {
      fill(L.shirt)(set, w, h);
      for (let x = 0; x < w; x++) set(x, h - 1, L.trousers), set(x, h - 2, L.shirtDark);
      if (L.longHair) for (let x = 2; x < 6; x++) set(x, 0, L.hair), set(x, 1, L.hair);
    },
    left: (set, w, h) => {
      fill(L.shirt)(set, w, h);
      for (let x = 0; x < w; x++) set(x, h - 1, L.trousers), set(x, h - 2, L.shirtDark);
    },
    right: (set, w, h) => {
      fill(L.shirt)(set, w, h);
      for (let x = 0; x < w; x++) set(x, h - 1, L.trousers), set(x, h - 2, L.shirtDark);
    },
    top: (set, w, h) => {
      fill(L.shirt)(set, w, h);
      set(3, 1, L.skin), set(4, 1, L.skin), set(3, 2, L.skin), set(4, 2, L.skin);
    },
    bottom: fill(L.trousers),
  };

  const armFace: Paint = (set, w, h) => {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) set(x, y, y < 4 ? L.shirt : y === 4 ? L.shirtDark : y >= h - 2 ? skinShade : L.skin);
  };
  const arm: BoxPaint = { front: armFace, back: armFace, left: armFace, right: armFace, top: fill(L.shirt), bottom: fill(skinShade) };

  const legFace = (seam: boolean): Paint => (set, w, h) => {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        set(x, y, y >= h - 2 ? (y === h - 2 && x === 1 ? white : L.shoes) : seam && x === 0 ? L.trousers.clone().multiplyScalar(0.85) : L.trousers);
  };
  const leg: BoxPaint = { front: legFace(false), back: legFace(false), left: legFace(true), right: legFace(true), top: fill(L.trousers), bottom: fill(L.shoes) };

  const hat = fill(L.hat);
  const hatStripe: Paint = (set, w, h) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(x, y, y === h - 1 ? L.hat.clone().multiplyScalar(0.7) : L.hat);
  };
  const book: BoxPaint = {
    front: (set, w, h) => {
      fill(L.shirtDark)(set, w, h);
      for (let y = 1; y < h - 1; y++) set(1, y, badge);
    },
    back: (set, w, h) => {
      fill(white)(set, w, h);
      const line = new THREE.Color("#9a968c");
      for (let y = 1; y < h - 1; y += 1) for (let x = 1; x < w - 1; x++) if (x !== Math.floor(w / 2) && (x + y) % 5 !== 0 && y % 2 === 1) set(x, y, line);
      for (let y = 0; y < h; y++) set(Math.floor(w / 2), y, L.shirtDark);
    },
    left: fill(white),
    right: fill(white),
    top: fill(white),
    bottom: fill(white),
  };
  return { head, torso, arm, leg, hat: { front: hatStripe, back: hatStripe, left: hatStripe, right: hatStripe, top: hat, bottom: hat } as BoxPaint, book };
}
