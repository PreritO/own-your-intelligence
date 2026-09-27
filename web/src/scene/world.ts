// OWNED BY: scene. The static block world as ONE merged mesh: every wall/cap/floor/door-stripe/tree block shares a
// 16x16-tile texture atlas, hidden faces between solid neighbours are culled, and per-room focus/lit is a uniform
// lookup by a per-vertex room index (so focusRooms/setRoomLit never touch geometry). 1 draw call (+1 static shadow).
import * as THREE from "three";

export type RGB = [number, number, number];
export interface Solid { x: number; y: number; z: number; tile: number; room: number; tint?: RGB }
export interface Flat { x: number; y: number; z: number; tile: number; room: number; tint?: RGB }

export const MAX_ROOMS = 32; // uniform array size; the last used slot is "outdoors"

/** Pack 16x16 tile canvases into one atlas (8 columns). */
export function buildAtlas(tiles: HTMLCanvasElement[]) {
  const cols = 8;
  const rows = THREE.MathUtils.ceilPowerOfTwo(Math.max(1, Math.ceil(tiles.length / cols)));
  const c = document.createElement("canvas");
  c.width = cols * 16;
  c.height = rows * 16;
  const g = c.getContext("2d")!;
  tiles.forEach((t, i) => g.drawImage(t, (i % cols) * 16, Math.floor(i / cols) * 16));
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, cols, rows };
}

// face: normal n, right r, up u (r x u = n, so BL->BR->TR->TL is counter-clockwise from outside)
const FACES: [number[], number[], number[]][] = [
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
];

export function buildWorld(atlas: { tex: THREE.Texture; cols: number; rows: number }, solids: Solid[], flats: Flat[], seed = 99) {
  const occ = new Set(solids.map((s) => `${s.x},${s.y},${s.z}`));
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], room: number[] = [], idx: number[] = [];
  let r = seed;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  const E = 0.0008;
  const emit = (cx: number, cy: number, cz: number, f: [number[], number[], number[]], tile: number, rm: number, tint: RGB | undefined, jitter: number) => {
    const [n, rr, u] = f;
    const cu = tile % atlas.cols, cv = Math.floor(tile / atlas.cols);
    const u0 = cu / atlas.cols + E, u1 = (cu + 1) / atlas.cols - E;
    const vTop = 1 - cv / atlas.rows - E, vBot = 1 - (cv + 1) / atlas.rows + E;
    const base = pos.length / 3;
    const k = jitter;
    const t = tint ?? [1, 1, 1];
    for (const [sr, su] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pos.push(cx + (n[0] + sr * rr[0] + su * u[0]) * 0.5, cy + (n[1] + sr * rr[1] + su * u[1]) * 0.5, cz + (n[2] + sr * rr[2] + su * u[2]) * 0.5);
      nor.push(n[0], n[1], n[2]);
      uv.push(sr < 0 ? u0 : u1, su < 0 ? vBot : vTop);
      col.push(t[0] * k, t[1] * k, t[2] * k);
      room.push(rm);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (const s of solids) {
    const j = 0.88 + rnd() * 0.12;
    for (const f of FACES) {
      const [n] = f;
      const ny = s.y + n[1];
      if (ny < 0) continue; // face against the ground
      if (occ.has(`${s.x + n[0]},${ny},${s.z + n[2]}`)) continue;
      emit(s.x, s.y + 0.5, s.z, f, s.tile, s.room, s.tint, j);
    }
  }
  const top = FACES[4];
  for (const q of flats) emit(q.x, q.y - 0.5, q.z, top, q.tile, q.room, q.tint, 0.94 + rnd() * 0.06);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("aRoom", new THREE.Float32BufferAttribute(room, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();

  const uniforms = {
    uF: { value: new Array<number>(MAX_ROOMS).fill(1) },
    uLit: { value: new Array<number>(MAX_ROOMS).fill(0) },
    uTint: { value: Array.from({ length: MAX_ROOMS }, () => new THREE.Color(0, 0, 0)) },
  };
  const mat = new THREE.MeshLambertMaterial({ map: atlas.tex, vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = "attribute float aRoom;\nvarying float vRoom;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n  vRoom = aRoom;");
    sh.fragmentShader =
      `uniform float uF[${MAX_ROOMS}];\nuniform float uLit[${MAX_ROOMS}];\nuniform vec3 uTint[${MAX_ROOMS}];\nvarying float vRoom;\n` +
      sh.fragmentShader
        .replace("#include <color_fragment>", "#include <color_fragment>\n  int ri = int(vRoom + 0.5);\n  diffuseColor.rgb *= uF[ri];")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n  totalEmissiveRadiance += uTint[ri] * uLit[ri] * uF[ri];");
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "world";
  mesh.castShadow = mesh.receiveShadow = true;
  return { mesh, uniforms, faces: idx.length / 6 };
}
