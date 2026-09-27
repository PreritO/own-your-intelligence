// OWNED BY: humans. A blocky voxel character (32 voxel-pixels = 1.75 m, feet at y = 0, facing +Z) built
// as ONE skinned mesh: every box is rigidly bound to one bone (pivots at neck, shoulders and hips), and
// all faces sample one per-agent pixel-art atlas, so the whole body is a single draw call.
import * as THREE from "three";
import { Atlas, lookFor, paintFigure, PX, type Look } from "./skin";

export const BONE = { root: 0, spine: 1, head: 2, armL: 3, armR: 4, legL: 5, legR: 6 } as const;
export const NB = 7;
export const LEG_LEN = 12 * PX;
export const HEAD_TOP = 32 * PX;

// bind-pose pivots in voxel pixels (floor-relative). L = +X = the figure's own left.
const JOINTS: [number, number, number, number][] = [
  [0, 12, 0, -1], // root (hips)
  [0, 12, 0, 0], // spine (torso pivots at the waist)
  [0, 24, 0, 1], // head (neck)
  [6, 22, 0, 1], // armL (shoulder)
  [-6, 22, 0, 1], // armR
  [2, 12, 0, 0], // legL (hip)
  [-2, 12, 0, 0], // legR
];

export interface Human {
  mesh: THREE.SkinnedMesh;
  bones: THREE.Bone[];
  book: THREE.Mesh;
  material: THREE.MeshLambertMaterial;
  look: Look;
  /** 0..1 extra self-illumination (ping / spawn flash). */
  glow: { value: number };
  dispose(): void;
}

interface Part {
  geo: THREE.BufferGeometry;
  bone: number;
  at: [number, number, number]; // centre, voxel pixels
  rotX?: number;
}

export function buildHuman(id: string, color: string): Human {
  const look = lookFor(id, color);
  const atlas = new Atlas(128, look.seed);
  const P = paintFigure(look);
  const parts: Part[] = [
    { geo: atlas.box(4, 12, 4, P.leg), bone: BONE.legL, at: [2, 6, 0] },
    { geo: atlas.box(4, 12, 4, P.leg), bone: BONE.legR, at: [-2, 6, 0] },
    { geo: atlas.box(8, 12, 4, P.torso), bone: BONE.spine, at: [0, 18, 0] },
    { geo: atlas.box(8, 8, 8, P.head), bone: BONE.head, at: [0, 28, 0] },
    { geo: atlas.box(4, 12, 4, P.arm), bone: BONE.armL, at: [6, 18, 0] },
    { geo: atlas.box(4, 12, 4, P.arm), bone: BONE.armR, at: [-6, 18, 0] },
  ];
  // accessory, on the head bone
  const H = BONE.head;
  switch (look.accessory) {
    case "cap":
      parts.push({ geo: atlas.box(8.6, 2.4, 8.6, P.hat), bone: H, at: [0, 31.4, 0] });
      parts.push({ geo: atlas.box(8, 0.6, 3.4, P.hat), bone: H, at: [0, 30.6, 5.6] });
      break;
    case "beanie":
      parts.push({ geo: atlas.box(8.6, 3.2, 8.6, P.hat), bone: H, at: [0, 31, 0] });
      parts.push({ geo: atlas.box(2, 1.4, 2, P.hat), bone: H, at: [0, 33.2, 0] });
      break;
    case "headphones":
      parts.push({ geo: atlas.box(9.4, 1, 1.6, P.hat), bone: H, at: [0, 32.4, 0] });
      for (const s of [-1, 1]) {
        parts.push({ geo: atlas.box(1, 4, 1.6, P.hat), bone: H, at: [s * 4.6, 30.2, 0] });
        parts.push({ geo: atlas.box(1.4, 3, 3, P.hat), bone: H, at: [s * 4.5, 27.5, 0] });
      }
      break;
    case "sprout":
      parts.push({ geo: atlas.box(0.8, 2.4, 0.8, P.hat), bone: H, at: [0, 33.2, 0] });
      parts.push({ geo: atlas.box(2.4, 0.6, 1.4, P.hat), bone: H, at: [1.2, 34.2, 0], rotX: 0.3 });
      break;
    case "glasses":
      break; // painted on the face
  }
  const bookGeo = atlas.box(8, 6, 2, P.book);
  atlas.commit();

  // ---- merge into one skinned geometry
  const geos = parts.map((p) => {
    const g = p.geo;
    if (p.rotX) g.rotateX(p.rotX);
    g.translate(p.at[0] * PX, p.at[1] * PX, p.at[2] * PX);
    const n = g.getAttribute("position").count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) (si[i * 4] = p.bone), (sw[i * 4] = 1);
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4));
    return g;
  });
  const geo = merge(geos);
  geos.forEach((g) => g.dispose());

  const glow = { value: 0 };
  const material = new THREE.MeshLambertMaterial({ map: atlas.texture });
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uGlow = glow;
    sh.fragmentShader = sh.fragmentShader
      .replace("void main() {", "uniform float uGlow;\nvoid main() {")
      .replace(
        "#include <emissivemap_fragment>",
        // a self-lit share of the texel colour keeps the figure readable in the moonlit palace
        "#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * (0.34 + 0.7 * uGlow);",
      );
  };
  material.customProgramCacheKey = () => "mp-voxel-human";

  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.frustumCulled = false;
  const bones = JOINTS.map(([x, y, z, p]) => {
    const b = new THREE.Bone();
    const o = p < 0 ? [0, 0, 0] : JOINTS[p];
    b.position.set((x - o[0]) * PX, (y - o[1]) * PX, (z - o[2]) * PX);
    return b;
  });
  JOINTS.forEach(([, , , p], i) => (p < 0 ? mesh.add(bones[i]) : bones[p].add(bones[i])));
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));

  // the book-block, held in front of the chest while reading (hidden otherwise)
  const book = new THREE.Mesh(bookGeo, material);
  book.position.set(0, 7 * PX, 8.4 * PX);
  book.rotation.x = 0.5;
  book.visible = false;
  bones[BONE.spine].add(book);

  return {
    mesh,
    bones,
    book,
    material,
    look,
    glow,
    dispose() {
      geo.dispose();
      bookGeo.dispose();
      atlas.texture.dispose();
      material.dispose();
      mesh.skeleton.dispose();
    },
  };
}

function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = ["position", "normal", "uv", "skinIndex", "skinWeight"];
  const out = new THREE.BufferGeometry();
  let vtx = 0, idx = 0;
  for (const g of geos) (vtx += g.getAttribute("position").count), (idx += g.index!.count);
  for (const name of names) {
    const a0 = geos[0].getAttribute(name) as THREE.BufferAttribute;
    const Arr = a0.array.constructor as { new (n: number): Float32Array | Uint16Array };
    const arr = new Arr(vtx * a0.itemSize);
    let o = 0;
    for (const g of geos) {
      const a = g.getAttribute(name) as THREE.BufferAttribute;
      arr.set(a.array as ArrayLike<number>, o);
      o += a.array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, a0.itemSize));
  }
  const index = new Uint32Array(idx);
  let io = 0, vo = 0;
  for (const g of geos) {
    const ia = g.index!.array;
    for (let i = 0; i < ia.length; i++) index[io + i] = ia[i] + vo;
    io += ia.length;
    vo += g.getAttribute("position").count;
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}
