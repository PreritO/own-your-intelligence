// OWNED BY: scene (voxel reskin). The palace renderer: a daylight block world built on a 1 m voxel grid from
// palace.json (rooms, doors, memories unchanged). Builds the PalaceRuntime every plugin receives (web/src/api.ts).
// Perf: one InstancedMesh per block type, merged/instanced props, < 150 draw calls incl. the shadow pass.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Memory, Palace, Room } from "../../../server/schema";
import { UI_EVENTS, emitUI, type PalaceRuntime, type SceneLayer } from "../api";
import type { EventStream } from "../events";
import { createControls, EYE_HEIGHT } from "../controls";
import { buildLayout, boxCells, doorSide, snapDoor, sideNormal, CORRIDOR_WALL_H } from "./layout";
import * as TX from "./textures";
import { createMinimap } from "./minimap";
import { buildAtlas, buildWorld, MAX_ROOMS, type Solid, type Flat } from "./world";

const params = new URLSearchParams(location.search);
const DEBUG = params.has("debug");
const WALK = params.has("walk"); // first-person mode (controls.ts); default is the UI overview map camera
const FOYER_COLOR = "#e8c15a";

// ---------------------------------------------------------------- block palettes (original pixel art)
type Style = "foyer" | "legal" | "finance" | "eng" | "people" | "gym" | "workshop" | "loose-ends";
interface Palette { wall: () => HTMLCanvasElement; cap: () => HTMLCanvasElement; floor: () => HTMLCanvasElement; color: string }
const PALETTES: Record<Style, Palette> = {
  foyer: { wall: () => TX.polished([206, 204, 196], 21), cap: () => TX.polished([236, 232, 220], 22, true), floor: () => TX.checker([236, 232, 220], [128, 128, 134], 23), color: FOYER_COLOR },
  legal: { wall: () => TX.bricks([128, 108, 150], [72, 60, 88], 31), cap: () => TX.polished([168, 128, 190], 32, true), floor: () => TX.checker([156, 136, 176], [120, 102, 142], 33), color: "#bb9af7" },
  finance: { wall: () => TX.sandstone([222, 204, 152], 41), cap: () => TX.metalBlock([240, 196, 70], 42), floor: () => TX.checker([230, 214, 168], [204, 182, 128], 43), color: "#e0af68" },
  eng: { wall: () => TX.cobble([128, 128, 124], [86, 142, 56], 51), cap: () => TX.cobble([96, 132, 70], [70, 120, 44], 52), floor: () => TX.checker([126, 130, 124], [104, 108, 102], 53), color: "#9ece6a" },
  people: { wall: () => TX.planks([180, 140, 86], 61), cap: () => TX.bark([106, 78, 46], 62), floor: () => TX.planks([120, 86, 54], 63), color: "#7aa2f7" },
  gym: { wall: () => TX.metalBlock([204, 208, 214], 71), cap: () => TX.metalBlock([150, 154, 162], 72), floor: () => TX.checker([112, 70, 70], [96, 60, 62], 73), color: "#e06c75" },
  workshop: { wall: () => TX.planks([156, 112, 64], 81), cap: () => TX.polished([92, 92, 98], 82, true), floor: () => TX.planks([104, 74, 46], 83), color: "#d19a66" },
  "loose-ends": { wall: () => TX.cobble([136, 128, 118], null, 91), cap: () => TX.bark([96, 72, 44], 92), floor: () => TX.gravel([132, 124, 112], 93), color: "#56b6c2" },
};
const COMMONS: Record<string, Style> = { "room-gym": "gym", "room-workshop": "workshop", "room-loose-ends": "loose-ends" };
const styleOfRoom = (r: Room | undefined): Style => {
  if (!r) return "foyer";
  if (COMMONS[r.id]) return COMMONS[r.id];
  return (r.wing in PALETTES ? r.wing : "foyer") as Style;
};

export function buildScene(palace: Palace, mount: HTMLElement, hud: HTMLElement, events: EventStream): PalaceRuntime {
  // ---------- renderer / scene ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  let pixelRatio = Math.min(devicePixelRatio, 1.75);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = !params.has("noshadows");
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // The world is static and the sun doesn't move: render the shadow map on demand, not every frame
  // (saves ~25 draw calls/frame). Call bumpShadows() after anything that changes casters.
  renderer.shadowMap.autoUpdate = false;
  let shadowFrames = 3;
  const bumpShadows = (frames = 2) => { shadowFrames = Math.max(shadowFrames, frames); };
  renderer.info.autoReset = false;
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const HORIZON = new THREE.Color("#c4e0ff");
  scene.background = HORIZON.clone();
  scene.fog = new THREE.Fog(HORIZON.clone(), 110, 330);

  const HEMI_I = 1.05, SUN_I = 2.7;
  const hemi = new THREE.HemisphereLight("#d6ebff", "#8c7a52", HEMI_I);
  const sun = new THREE.DirectionalLight("#fff3dc", SUN_I);
  const SUN_DIR = new THREE.Vector3(0.55, 1, 0.35).normalize();
  sun.position.copy(SUN_DIR).multiplyScalar(90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -72, right: 72, top: 72, bottom: -72, near: 1, far: 220 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 3;
  scene.add(hemi, sun, sun.target);

  const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.08, 600);

  // ---------- lookups ----------
  const roomById = new Map(palace.rooms.map((r) => [r.id, r]));
  const wingById = new Map(palace.wings.map((w) => [w.id, w]));
  const styleOf = (roomId?: string) => styleOfRoom(roomId ? roomById.get(roomId) : undefined);
  const roomHex = (roomId?: string) => {
    const r = roomId ? roomById.get(roomId) : undefined;
    return (r && wingById.get(r.wing)?.color) || PALETTES[styleOf(roomId)].color;
  };
  const layout = buildLayout(palace);
  const root = new THREE.Group();
  root.name = "palace";
  scene.add(root);
  const tmpC = new THREE.Color();
  const m4 = new THREE.Matrix4();
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const Q0 = new THREE.Quaternion();
  const rnd = mulberry(1234);
  let time = 0;

  // ---------- focus / dim bookkeeping (per-room factor eased in the frame loop) ----------
  const roomIds = palace.rooms.map((r) => r.id);
  const focus = new Map<string, { f: number; target: number }>(roomIds.map((id) => [id, { f: 1, target: 1 }]));
  let outF = 1, outTarget = 1;
  const roomF = (id?: string) => (id ? focus.get(id)?.f ?? outF : outF);
  const roomSlot = new Map(roomIds.map((id, i) => [id, i]));
  const OUT = Math.min(roomIds.length, MAX_ROOMS - 1); // uniform slot for outdoors + corridors
  const slotOf = (id?: string) => (id !== undefined && roomSlot.has(id) ? Math.min(roomSlot.get(id)!, OUT) : OUT);

  // ---------- the static world: collected here as solids/flats, merged into ONE mesh after the trees ----------
  const unitCube = new THREE.BoxGeometry(1, 1, 1);
  const tiles: HTMLCanvasElement[] = [];
  const tileIdx = new Map<string, number>();
  const tileOf = (type: string, make?: () => HTMLCanvasElement): number => {
    let t = tileIdx.get(type);
    if (t === undefined) {
      let cv: HTMLCanvasElement;
      if (make) cv = make();
      else {
        const [style, part] = type.split(":") as [Style, "wall" | "cap" | "floor" | "notice"];
        cv = part === "notice" ? noticeBoard() : PALETTES[style][part]();
      }
      t = tiles.length;
      tiles.push(cv);
      tileIdx.set(type, t);
    }
    return t;
  };
  const solids: Solid[] = [];
  const flats: Flat[] = [];
  interface Cell { x: number; y: number; z: number; type: string; room?: string }
  const cells = new Map<string, Cell>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  // jambs: wall cells flanking each door gap get the frame/cap block
  const jamb = new Set<string>();
  const thresholds: { x: number; z: number; room: string; to: string; nx: number; nz: number; along: "x" | "z" }[] = [];
  for (const r of palace.rooms) {
    for (const d of r.doors) {
      if (!roomById.has(d.to)) continue;
      const s = doorSide(r, d.pos);
      const [px, pz] = snapDoor(r, d.pos);
      const [nx, nz] = sideNormal(s);
      const along = s === "N" || s === "S" ? "x" : "z";
      for (const o of [-1, 0, 1]) thresholds.push({ x: along === "x" ? Math.round(px) + o : Math.round(px), z: along === "z" ? Math.round(pz) + o : Math.round(pz), room: r.id, to: d.to, nx, nz, along });
      for (const o of [-2, 2]) for (let y = 0; y < 3; y++) jamb.add(along === "x" ? key(Math.round(px) + o, y, Math.round(pz)) : key(Math.round(px), y, Math.round(pz) + o));
    }
  }
  const noticeRoom = palace.rooms.find((r) => r.id === "room-loose-ends");
  for (const w of layout.walls) {
    const style = styleOf(w.roomId);
    const topY = w.kind === "corridor-wall" ? CORRIDOR_WALL_H - 1 : Math.round(w.max[1]) - 1;
    for (const [x, y, z] of boxCells(w)) {
      const k = key(x, y, z);
      if (cells.has(k)) continue;
      let part = w.kind === "lintel" || y === topY || jamb.has(k) ? "cap" : "wall";
      if (noticeRoom && w.roomId === noticeRoom.id && w.kind === "wall" && (y === 1 || y === 2) && Math.abs(z - (noticeRoom.center[2] - noticeRoom.size[2] / 2)) < 0.01 && Math.abs(x - noticeRoom.center[0]) <= 4) part = "notice";
      cells.set(k, { x, y, z, type: `${style}:${part}`, room: w.roomId });
    }
  }
  for (const c of cells.values()) solids.push({ x: c.x, y: c.y, z: c.z, tile: tileOf(c.type), room: slotOf(c.room) });

  // floors: one top-face quad per cell (room floors, gravel corridor paths, wool door stripes, foyer quest ring)
  interface RoomVis { sign?: number; lit: number; litTarget: number }
  const roomVis = new Map<string, RoomVis>();
  const foyer = roomById.get("foyer") ?? palace.rooms[0];
  const doorColor = (room: string, to: string) => roomHex(roomById.get(room)?.wing === "foyer" ? to : room);
  const rgb = (hex: string): [number, number, number] => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
  const floorTaken = new Set<string>();
  for (const t of thresholds) {
    floorTaken.add(`${t.x},${t.z}`);
    flats.push({ x: t.x, y: 0.004, z: t.z, tile: tileOf("wool", () => TX.wool()), room: slotOf(t.room), tint: rgb(doorColor(t.room, t.to)) });
  }
  const goldTile = tileOf("gold", () => TX.metalBlock([240, 196, 70], 7));
  for (const r of palace.rooms) {
    const hx = r.size[0] / 2, hz = r.size[2] / 2;
    const ft = tileOf(`${styleOf(r.id)}:floor`);
    for (let x = r.center[0] - hx + 1; x <= r.center[0] + hx - 1; x++) for (let z = r.center[2] - hz + 1; z <= r.center[2] + hz - 1; z++) {
      let tile = ft;
      if (r === foyer) {
        const d = Math.hypot(x - r.center[0], z - r.center[2]);
        if ((d > 2.6 && d < 3.7) || d < 0.1) tile = goldTile; // Hall of Quests: open ring for new lecterns
      }
      floorTaken.add(`${x},${z}`);
      flats.push({ x, y: 0.002, z, tile, room: slotOf(r.id) });
    }
    roomVis.set(r.id, { lit: 0, litTarget: 0 });
  }
  const pathTile = tileOf("path", () => TX.gravel([150, 138, 118], 99));
  for (const f of layout.corridorFloors) {
    for (let x = Math.ceil(f.minX - 1e-6); x <= Math.floor(f.maxX + 1e-6); x++) for (let z = Math.ceil(f.minZ - 1e-6); z <= Math.floor(f.maxZ + 1e-6); z++) {
      const k = `${x},${z}`;
      if (floorTaken.has(k) || cells.has(key(x, 0, z))) continue;
      floorTaken.add(k);
      flats.push({ x, y: 0.002, z, tile: pathTile, room: OUT });
    }
  }

  // ---------- door banners on the jambs ----------
  interface BannerDef { room: string; color: THREE.Color }
  const bannerDefs: BannerDef[] = [];
  const bannerMats: THREE.Matrix4[] = [];
  for (const t of thresholds) {
    // one pass per door (use the middle threshold cell): banners on both jambs, both faces
    const mid = thresholds.filter((u) => u.room === t.room && u.to === t.to);
    if (mid[1] !== t) continue;
    for (const o of [-2, 2]) for (const face of [-1, 1]) {
      const bx = t.along === "x" ? t.x + o : t.x + face * 0.53, bz = t.along === "z" ? t.z + o : t.z + face * 0.53;
      const ry = t.along === "x" ? (face > 0 ? 0 : Math.PI) : (face > 0 ? Math.PI / 2 : -Math.PI / 2);
      bannerMats.push(new THREE.Matrix4().compose(V(bx, 1.95, bz), new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, ry), V(1, 1, 1)));
      bannerDefs.push({ room: t.room, color: new THREE.Color(doorColor(t.room, t.to)) });
    }
  }
  const bannerTex = TX.pixelTex(TX.banner());
  bannerTex.wrapS = bannerTex.wrapT = THREE.ClampToEdgeWrapping;
  const banners = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.8, 1.6), new THREE.MeshLambertMaterial({ map: bannerTex, alphaTest: 0.5, side: THREE.DoubleSide }), Math.max(1, bannerMats.length));
  banners.name = "banners";
  bannerMats.forEach((mm, i) => { banners.setMatrixAt(i, mm); banners.setColorAt(i, bannerDefs[i].color); });
  root.add(banners);

  // ---------- torches: emissive blocks on interior walls (no PointLights) ----------
  interface TorchDef { room: string }
  const torchDefs: TorchDef[] = [];
  const stickM: THREE.Matrix4[] = [], headM: THREE.Matrix4[] = [];
  for (const r of palace.rooms) {
    const hx = r.size[0] / 2, hz = r.size[2] / 2;
    const offs = [-(Math.min(hx, hz) - 2), Math.min(hx, hz) - 2];
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (const o of offs) {
        const inset = (nx ? hx : hz) - 0.5; // interior face of the wall block
        const x = r.center[0] + (nx ? nx * inset : o), z = r.center[2] + (nz ? nz * inset : o);
        const tilt = new THREE.Quaternion().setFromAxisAngle(V(nz, 0, -nx), 0.35);
        const base = V(x - nx * 0.1, 2.1, z - nz * 0.1);
        stickM.push(new THREE.Matrix4().compose(base, tilt, V(1, 1, 1)));
        const top = V(0, 0.3, 0).applyQuaternion(tilt).add(base);
        headM.push(new THREE.Matrix4().compose(top, tilt, V(1, 1, 1)));
        torchDefs.push({ room: r.id });
      }
    }
  }
  const stickGeo = new THREE.BoxGeometry(0.1, 0.5, 0.1);
  const sticks = new THREE.InstancedMesh(stickGeo, new THREE.MeshLambertMaterial({ color: "#7a5230" }), torchDefs.length);
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), new THREE.MeshBasicMaterial({ toneMapped: false }), torchDefs.length);
  sticks.name = "torch-sticks";
  heads.name = "torch-heads";
  stickM.forEach((mm, i) => { sticks.setMatrixAt(i, mm); heads.setMatrixAt(i, headM[i]); });
  const TORCH = new THREE.Color("#ffc65a");
  const refreshTorches = (flick = 0) => {
    torchDefs.forEach((t, i) => {
      const v = roomVis.get(t.room);
      const k = (1.05 + 0.5 * (v?.lit ?? 0) + flick * Math.sin(time * 13 + i * 2.1)) * (0.3 + 0.7 * roomF(t.room));
      heads.setColorAt(i, tmpC.copy(TORCH).multiplyScalar(k));
    });
    heads.instanceColor!.needsUpdate = true;
  };
  root.add(sticks, heads);

  // ---------- memories: lecterns + floating books + halos + cobwebs ----------
  const mems: Memory[] = [...palace.memories];
  const memIndex = new Map(mems.map((m, i) => [m.id, i]));
  const CAP = mems.length + 32;
  const lecternGeo = (() => {
    const base = new THREE.BoxGeometry(0.72, 0.12, 0.72); base.translate(0, 0.06, 0);
    const post = new THREE.BoxGeometry(0.34, 0.6, 0.34); post.translate(0, 0.42, 0);
    const top = new THREE.BoxGeometry(0.74, 0.1, 0.6); top.rotateX(0.38); top.translate(0, 0.78, 0);
    return mergeGeometries([base, post, top]);
  })();
  const lecterns = new THREE.InstancedMesh(lecternGeo, new THREE.MeshLambertMaterial({ map: TX.pixelTex(TX.lectern()) }), CAP);
  lecterns.name = "lecterns";
  lecterns.castShadow = lecterns.receiveShadow = true;
  const bookGeo = new THREE.BoxGeometry(0.4, 0.1, 0.3);
  const books = new THREE.InstancedMesh(bookGeo, new THREE.MeshBasicMaterial({ map: TX.pixelTex(TX.book()), toneMapped: false }), CAP);
  books.name = "books";
  const haloMat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vC; varying vec2 vUv;
      void main() {
        vec4 c = viewMatrix * modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float s = length(instanceMatrix[0].xyz);
        c.xy += position.xy * s;
        vC = instanceColor; vUv = uv;
        gl_Position = projectionMatrix * c;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC; varying vec2 vUv;
      void main() {
        vec2 q = floor(vUv * 8.0) / 8.0 + 0.0625; // pixelated falloff
        float d = length(q - 0.5) * 2.0;
        float a = pow(max(0.0, 1.0 - d), 1.8);
        gl_FragColor = vec4(vC * a, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const halos = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.3, 1.3), haloMat, CAP);
  halos.name = "book-halos";
  halos.frustumCulled = false;
  const webGeo = (() => {
    const a = new THREE.PlaneGeometry(0.7, 0.7);
    const b = a.clone(); b.rotateY(Math.PI / 2);
    return mergeGeometries([a, b]);
  })();
  const webTex = TX.pixelTex(TX.cobweb());
  const webs = new THREE.InstancedMesh(webGeo, new THREE.MeshLambertMaterial({ map: webTex, alphaTest: 0.5, side: THREE.DoubleSide, transparent: false }), CAP);
  webs.name = "cobwebs";
  const FRESH = new THREE.Color("#ffd98a"), STALE = new THREE.Color("#8a8070");
  const memBase: THREE.Color[] = [];
  const spawnT = new Map<number, number>(); // index -> seconds since spawn (addMemory flourish)
  const gapped = new Set<number>();
  const glowOverride = new Map<number, number>();
  let webCount = 0;
  const webOf: number[] = [];
  const placeMemory = (m: Memory, i: number) => {
    lecterns.setMatrixAt(i, m4.compose(V(m.pos[0], 0, m.pos[2]), new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, lecternYaw(m)), V(1, 1, 1)));
    memBase[i] = STALE.clone().lerp(FRESH, m.freshness);
    if (m.freshness < 0.3) {
      webs.setMatrixAt(webCount, m4.compose(V(m.pos[0] + 0.28, 0.95, m.pos[2] + 0.28), new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.PI / 4), V(1, 1, 1)));
      webOf[webCount] = i;
      webCount++;
      webs.count = webCount;
    }
  };
  const lecternYaw = (m: Memory) => {
    const r = roomById.get(m.room);
    return r ? Math.atan2(r.center[0] - m.pos[0], r.center[2] - m.pos[2]) : 0;
  };
  webs.count = 0;
  mems.forEach(placeMemory);
  const setCounts = () => { lecterns.count = books.count = halos.count = mems.length; };
  setCounts();
  lecterns.computeBoundingSphere();
  root.add(lecterns, books, halos, webs);

  // dust on stale memories: grey pixel motes (normal blending, reads in daylight)
  const stale = mems.filter((m) => m.freshness < 0.3);
  const DUST_PER = 26;
  const dustPos = new Float32Array(Math.max(1, stale.length * DUST_PER) * 3);
  const dustSeed = new Float32Array(Math.max(1, stale.length * DUST_PER));
  {
    let di = 0;
    for (const m of stale) for (let k = 0; k < DUST_PER; k++, di++) {
      const a = rnd() * Math.PI * 2, rr = 0.2 + rnd() * 0.6, y = (rnd() - 0.2) * 1.1;
      dustPos.set([m.pos[0] + Math.cos(a) * rr, m.pos[1] + y, m.pos[2] + Math.sin(a) * rr], di * 3);
      dustSeed[di] = rnd() * 100;
    }
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  dustGeo.setAttribute("seed", new THREE.BufferAttribute(dustSeed, 1));
  const dustMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: innerHeight / 2 }, uDim: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float seed; uniform float uTime; uniform float uScale; varying float vA;
      void main() {
        vec3 p = position; float t = uTime * 0.25 + seed;
        p += vec3(sin(t * 1.3) * 0.1, fract(t * 0.08 + seed) * 0.5 - 0.25, cos(t * 1.1) * 0.1);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = 0.045 * uScale / -mv.z;
        vA = 0.55 + 0.3 * sin(t * 2.0 + seed * 3.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vA; uniform float uDim;
      void main() { gl_FragColor = vec4(vec3(0.62, 0.6, 0.55) * uDim, vA); }`,
    transparent: true, depthWrite: false,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.name = "dust";
  dust.frustumCulled = false;
  if (stale.length) root.add(dust);

  // ---------- spawn flourish: block particles + light column (addMemory) ----------
  const PMAX = 120;
  const parts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial({ toneMapped: false }), PMAX);
  parts.name = "spawn-particles";
  parts.frustumCulled = false;
  parts.count = 0;
  const pState: { p: THREE.Vector3; v: THREE.Vector3; life: number; max: number; c: THREE.Color }[] = [];
  const column = new THREE.Mesh(new THREE.BoxGeometry(0.9, 30, 0.9), new THREE.MeshBasicMaterial({ color: "#ffe9a8", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  column.name = "spawn-column";
  column.visible = false;
  let columnT = -1;
  root.add(parts, column);
  const burst = (at: THREE.Vector3, color: THREE.Color) => {
    for (let k = 0; k < 44; k++) {
      if (pState.length >= PMAX) pState.shift();
      const a = rnd() * Math.PI * 2, s = 1 + rnd() * 2.6;
      const c = k % 3 === 0 ? new THREE.Color("#ffffff") : k % 3 === 1 ? new THREE.Color("#ffd24a") : color.clone();
      pState.push({ p: at.clone().add(V((rnd() - 0.5) * 0.4, rnd() * 0.4, (rnd() - 0.5) * 0.4)), v: V(Math.cos(a) * s, 2.5 + rnd() * 3.5, Math.sin(a) * s), life: 0, max: 0.9 + rnd() * 0.8, c: c.multiplyScalar(1.4) });
    }
    column.position.set(at.x, 15, at.z);
    column.visible = true;
    columnT = 0;
  };

  // ---------- memory labels (layer "memoryLabels"): one atlas + one instanced billboard ----------
  let atlas = TX.labelAtlas(mems.map((m) => m.title));
  const labelGeo = new THREE.InstancedBufferGeometry();
  {
    const pl = new THREE.PlaneGeometry(1, 1);
    pl.translate(0, 0.5, 0);
    labelGeo.index = pl.index;
    labelGeo.setAttribute("position", pl.getAttribute("position"));
    labelGeo.setAttribute("uv", pl.getAttribute("uv"));
  }
  const rectAttr = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
  const anchorAttr = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
  labelGeo.setAttribute("aRect", rectAttr);
  labelGeo.setAttribute("aAnchor", anchorAttr);
  const labelMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: atlas.tex }, uH: { value: 0.17 } },
    vertexShader: /* glsl */ `
      attribute vec4 aRect; attribute vec3 aAnchor; uniform float uH; varying vec2 vUv;
      void main() {
        vec4 c = viewMatrix * modelMatrix * vec4(aAnchor, 1.0);
        c.xy += vec2(position.x * aRect.w, position.y) * uH;
        vUv = vec2(uv.x * aRect.x, mix(aRect.y, aRect.z, uv.y));
        gl_Position = projectionMatrix * c;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; varying vec2 vUv;
      void main() { vec4 t = texture2D(map, vUv); if (t.a < 0.3) discard; gl_FragColor = t;
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false,
  });
  const memLabels = new THREE.Mesh(labelGeo, labelMat);
  memLabels.name = "memory-labels";
  memLabels.frustumCulled = false;
  memLabels.visible = false;
  const writeLabels = () => {
    atlas.rows.forEach((r, i) => {
      rectAttr.setXYZW(i, r.u1, r.v0, r.v1, r.aspect);
      anchorAttr.setXYZ(i, mems[i].pos[0], mems[i].pos[1] + 0.42, mems[i].pos[2]);
    });
    rectAttr.needsUpdate = anchorAttr.needsUpdate = true;
    labelGeo.instanceCount = mems.length;
  };
  writeLabels();
  root.add(memLabels);

  // ---------- link beams (layer "links", off by default): pixel-dotted arcs ----------
  const linkPts: number[] = [], linkCol: number[] = [];
  for (const l of palace.links) {
    const a = memIndex.get(l.from), b = memIndex.get(l.to);
    if (a === undefined || b === undefined || a === b) continue;
    const A = V(...mems[a].pos), B = V(...mems[b].pos);
    const dist = A.distanceTo(B), lift = Math.min(0.6 + dist * 0.12, 2.4);
    const ca = new THREE.Color(roomHex(mems[a].room)), cb = new THREE.Color(roomHex(mems[b].room));
    const n = Math.max(4, Math.round(dist / 0.4));
    for (let s = 1; s < n; s++) {
      const t = s / n;
      const p = A.clone().lerp(B, t);
      linkPts.push(p.x, p.y + Math.sin(Math.PI * t) * lift, p.z);
      const c = ca.clone().lerp(cb, t);
      linkCol.push(c.r, c.g, c.b);
    }
  }
  const linkGeo = new THREE.BufferGeometry();
  linkGeo.setAttribute("position", new THREE.Float32BufferAttribute(linkPts, 3));
  linkGeo.setAttribute("color", new THREE.Float32BufferAttribute(linkCol, 3));
  const linkDots = new THREE.Points(linkGeo, new THREE.PointsMaterial({ size: 0.09, vertexColors: true, sizeAttenuation: true, toneMapped: false }));
  linkDots.name = "link-dots";
  linkDots.visible = false;
  root.add(linkDots);

  // ---------- signs: pixel-font wooden boards over each room entrance (one atlas, one instanced billboard) ----------
  const signDefs = palace.rooms.map((r) => {
    const isFoyer = r.id === (foyer?.id ?? "");
    const wing = wingById.get(r.wing);
    const caption = isFoyer ? "Mind Palace" : wing ? wing.label + " wing" : COMMONS[r.id] ? "Commons" : r.wing;
    const title = isFoyer ? "Hall of Quests" : r.label;
    const { tex, aspect } = TX.signTexture(title, caption, roomHex(r.id));
    const entry = r.doors.find((d) => roomById.has(d.to));
    let p: [number, number, number];
    if (isFoyer || !entry) p = [r.center[0], r.size[1] + 3.2, r.center[2]];
    else { const [x, z] = snapDoor(r, entry.pos); p = [x, r.size[1] + 1.6, z]; }
    return { canvas: tex.image as HTMLCanvasElement, aspect, h: isFoyer ? 3.2 : 2.8, p, room: r.id };
  });
  const SW = THREE.MathUtils.ceilPowerOfTwo(Math.max(...signDefs.map((d) => d.canvas.width)));
  const SH = THREE.MathUtils.ceilPowerOfTwo(signDefs.reduce((n, d) => n + d.canvas.height, 0));
  const signCanvas = document.createElement("canvas");
  signCanvas.width = SW;
  signCanvas.height = SH;
  const signG = signCanvas.getContext("2d")!;
  const signGeo = new THREE.InstancedBufferGeometry();
  {
    const pl = new THREE.PlaneGeometry(1, 1);
    signGeo.index = pl.index;
    signGeo.setAttribute("position", pl.getAttribute("position"));
    signGeo.setAttribute("uv", pl.getAttribute("uv"));
  }
  const sRect = new Float32Array(signDefs.length * 4), sAnchor = new Float32Array(signDefs.length * 3), sH = new Float32Array(signDefs.length);
  let sy = 0;
  signDefs.forEach((d, i) => {
    signG.drawImage(d.canvas, 0, sy);
    sRect.set([d.canvas.width / SW, 1 - (sy + d.canvas.height) / SH, 1 - sy / SH, d.aspect], i * 4);
    sAnchor.set(d.p, i * 3);
    sH[i] = d.h;
    roomVis.get(d.room)!.sign = i;
    sy += d.canvas.height;
  });
  const signDim = new THREE.InstancedBufferAttribute(new Float32Array(signDefs.length).fill(1), 1);
  signGeo.setAttribute("aRect", new THREE.InstancedBufferAttribute(sRect, 4));
  signGeo.setAttribute("aAnchor", new THREE.InstancedBufferAttribute(sAnchor, 3));
  signGeo.setAttribute("aH", new THREE.InstancedBufferAttribute(sH, 1));
  signGeo.setAttribute("aDim", signDim);
  signGeo.instanceCount = signDefs.length;
  const signTex = TX.pixelTex(signCanvas);
  signTex.wrapS = signTex.wrapT = THREE.ClampToEdgeWrapping;
  const signs = new THREE.Mesh(signGeo, new THREE.ShaderMaterial({
    uniforms: { map: { value: signTex } },
    vertexShader: /* glsl */ `
      attribute vec4 aRect; attribute vec3 aAnchor; attribute float aH; attribute float aDim;
      varying vec2 vUv; varying float vDim;
      void main() {
        vec4 c = viewMatrix * modelMatrix * vec4(aAnchor, 1.0);
        c.xy += vec2(position.x * aRect.w, position.y) * aH;
        vUv = vec2(uv.x * aRect.x, mix(aRect.y, aRect.z, uv.y));
        vDim = aDim;
        gl_Position = projectionMatrix * c;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; varying vec2 vUv; varying float vDim;
      void main() { vec4 t = texture2D(map, vUv); if (t.a < 0.5) discard; gl_FragColor = vec4(t.rgb * vDim, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  signs.name = "room-signs";
  signs.frustumCulled = false;
  root.add(signs);

  // ---------- ceilings (layer "ceiling", off by default: overview looks in) ----------
  const ceilCells: [number, number, number][] = [];
  for (const r of palace.rooms) {
    const hx = r.size[0] / 2, hz = r.size[2] / 2;
    for (let x = r.center[0] - hx; x <= r.center[0] + hx; x++) for (let z = r.center[2] - hz; z <= r.center[2] + hz; z++) ceilCells.push([x, r.size[1], z]);
  }
  const ceiling = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.5, 1), new THREE.MeshLambertMaterial({ map: TX.pixelTex(TX.planks([150, 112, 66], 5)) }), ceilCells.length);
  ceilCells.forEach(([x, y, z], i) => ceiling.setMatrixAt(i, m4.makeTranslation(x, y + 0.25, z)));
  ceiling.name = "ceilings";
  ceiling.castShadow = true;
  ceiling.visible = false;
  root.add(ceiling);

  // ---------- outdoors: grass, trees, flowers, sky, sun, clouds ----------
  const outdoor = new THREE.Group();
  outdoor.name = "outdoors";
  scene.add(outdoor);
  const outMats: THREE.MeshLambertMaterial[] = [];
  const grassTex = TX.pixelTex(TX.grass(), true);
  grassTex.repeat.set(700, 700);
  const grassMat = new THREE.MeshLambertMaterial({ map: grassTex });
  outMats.push(grassMat);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), grassMat);
  ground.rotateX(-Math.PI / 2);
  ground.position.set(0.5, -0.08, 0.5);
  ground.receiveShadow = true;
  ground.name = "grass";
  outdoor.add(ground);
  const blocked = (x: number, z: number, pad: number) =>
    palace.rooms.some((r) => Math.abs(x - r.center[0]) < r.size[0] / 2 + pad && Math.abs(z - r.center[2]) < r.size[2] / 2 + pad) ||
    layout.corridorFloors.some((f) => x > f.minX - pad && x < f.maxX + pad && z > f.minZ - pad && z < f.maxZ + pad);
  const trunkCells: [number, number, number][] = [], leafCells: [number, number, number][] = [];
  {
    const tr = mulberry(77);
    let tries = 0;
    const placed: [number, number][] = [];
    while (placed.length < 34 && tries++ < 3000) {
      const a = tr() * Math.PI * 2, d = 14 + tr() * 62;
      const x = Math.round(Math.cos(a) * d), z = Math.round(Math.sin(a) * d);
      if (blocked(x, z, 4.5) || placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 6)) continue;
      placed.push([x, z]);
      const h = 4 + Math.floor(tr() * 3);
      for (let y = 0; y < h; y++) trunkCells.push([x, y, z]);
      for (let y = h - 2; y <= h + 1; y++) {
        const R = y >= h ? 1 : 2;
        for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
          if (dx === 0 && dz === 0 && y < h) continue;
          if (Math.abs(dx) === R && Math.abs(dz) === R && (y === h + 1 || tr() < 0.6)) continue;
          leafCells.push([x + dx, y, z + dz]);
        }
      }
    }
  }
  const barkTile = tileOf("bark", () => TX.bark([104, 78, 48], 3)), leafTile = tileOf("leaves", () => TX.leaves());
  for (const [x, y, z] of trunkCells) solids.push({ x, y, z, tile: barkTile, room: OUT });
  for (const [x, y, z] of leafCells) solids.push({ x, y, z, tile: leafTile, room: OUT });

  // ---------- merge: every block + floor tile above -> one mesh, one atlas ----------
  const worldAtlas = buildAtlas(tiles);
  const world = buildWorld(worldAtlas, solids, flats);
  root.add(world.mesh);
  const worldU = world.uniforms;
  palace.rooms.forEach((r, i) => { if (i < OUT) worldU.uTint.value[i].set(roomHex(r.id)); });
  const plantGeo = (() => {
    const a = new THREE.PlaneGeometry(0.8, 0.8); a.rotateY(Math.PI / 4); a.translate(0, 0.4, 0);
    const b = new THREE.PlaneGeometry(0.8, 0.8); b.rotateY(-Math.PI / 4); b.translate(0, 0.4, 0);
    return mergeGeometries([a, b]);
  })();
  for (const kind of [0, 1, 2] as const) {
    const n = kind === 2 ? 320 : 70;
    const pm = new THREE.MeshLambertMaterial({ map: TX.pixelTex(TX.plant(kind)), alphaTest: 0.5, side: THREE.DoubleSide });
    outMats.push(pm);
    const mesh = new THREE.InstancedMesh(plantGeo, pm, n);
    const pr = mulberry(500 + kind);
    let i = 0, tries = 0;
    while (i < n && tries++ < 20000) {
      const a = pr() * Math.PI * 2, d = 3 + pr() * 70;
      const x = Math.round(Math.cos(a) * d), z = Math.round(Math.sin(a) * d);
      if (blocked(x, z, 1.2)) continue;
      mesh.setMatrixAt(i++, m4.compose(V(x, 0, z), Q0, V(1, 0.8 + pr() * 0.4, 1)));
    }
    mesh.count = i;
    mesh.name = `plants:${kind}`;
    outdoor.add(mesh);
  }
  // sky dome (gradient, follows camera)
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { uTop: { value: new THREE.Color("#5c9cf2") }, uHor: { value: HORIZON.clone() }, uDim: { value: 1 } },
    vertexShader: /* glsl */ `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `uniform vec3 uTop; uniform vec3 uHor; uniform float uDim; varying vec3 vP;
      void main(){ float h = clamp(normalize(vP).y, 0.0, 1.0); gl_FragColor = vec4(mix(uHor, uTop, pow(h, 0.55)) * uDim, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(480, 24, 12), skyMat);
  sky.name = "sky";
  sky.renderOrder = -10;
  scene.add(sky);
  const sunSprite = new THREE.Mesh(new THREE.PlaneGeometry(34, 34), new THREE.MeshBasicMaterial({ map: TX.pixelTex(TX.sun()), transparent: true, fog: false, depthWrite: false, toneMapped: false }));
  sunSprite.name = "sun";
  sunSprite.renderOrder = -9;
  scene.add(sunSprite);
  const cloudCells: THREE.Matrix4[] = [];
  {
    const cr = mulberry(31);
    for (let c = 0; c < 26; c++) {
      const cx = (cr() - 0.5) * 520, cz = (cr() - 0.5) * 520;
      const w = 3 + Math.floor(cr() * 5), d = 2 + Math.floor(cr() * 4);
      for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) {
        if ((i === 0 || i === w - 1) && (j === 0 || j === d - 1) && cr() < 0.7) continue;
        cloudCells.push(new THREE.Matrix4().compose(V(cx + i * 8, 70 + (c % 3) * 4, cz + j * 8), Q0, V(8, 3, 8)));
      }
    }
  }
  const clouds = new THREE.InstancedMesh(unitCube, new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.86, fog: false }), cloudCells.length);
  cloudCells.forEach((mm, i) => clouds.setMatrixAt(i, mm));
  clouds.name = "clouds";
  clouds.frustumCulled = false;
  scene.add(clouds);

  // ---------- post: bloom (layer "bloom", off by default; subtle when on) ----------
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.4, 0.92));
  composer.addPass(new OutputPass());
  let useBloom = params.has("bloom");

  // ---------- controls ----------
  const walkable = (x: number, z: number) =>
    palace.rooms.some((r) => Math.abs(x - r.center[0]) < r.size[0] / 2 - 0.1 && Math.abs(z - r.center[2]) < r.size[2] / 2 - 0.1) ||
    layout.corridorFloors.some((f) => x > f.minX && x < f.maxX && z > f.minZ && z < f.maxZ);
  const controls = createControls(camera, renderer.domElement, layout.colliders, walkable);
  if (foyer) {
    camera.position.set(foyer.center[0], EYE_HEIGHT, foyer.center[2] + foyer.size[2] * 0.32);
    camera.lookAt(foyer.center[0], EYE_HEIGHT, foyer.center[2] - 10);
  } else camera.position.set(0, EYE_HEIGHT, 4);

  // ---------- HUD (scene-owned bits) ----------
  const style = document.createElement("style");
  style.textContent = SCENE_CSS;
  document.head.appendChild(style);
  const sh = document.createElement("div");
  sh.className = "mp-scene-hud";
  sh.style.pointerEvents = "none";
  sh.innerHTML = `<div class="mp-cross"></div><div class="mp-tip"></div>${WALK ? `<div class="mp-hint"><b>Click</b> to walk &nbsp;·&nbsp; <b>WASD</b> move &nbsp;·&nbsp; <b>Shift</b> run &nbsp;·&nbsp; <b>Esc</b> release<br><span>click a glowing book to open it</span></div>` : ""}`;
  hud.appendChild(sh);
  const tip = sh.querySelector<HTMLElement>(".mp-tip")!;
  const syncHud = () => {
    sh.classList.toggle("locked", controls.locked);
    sh.classList.toggle("released", controls.released || flying !== null);
  };
  controls.onLockChange(syncHud);
  const minimap = !WALK || params.has("nominimap") ? null : createMinimap(palace, layout, sh, (r) => roomHex(r.id));
  let debugEl: HTMLElement | null = null;
  if (DEBUG) {
    debugEl = document.createElement("div");
    debugEl.className = "mp-debug";
    sh.appendChild(debugEl);
  }

  // ---------- state: glow, dim, lit, focus ----------
  let dimTarget = 1, dim = 1;
  const litRooms = new Set<string>();
  let hovered = -1;
  const flare = new Map<number, number>();
  const memGlow = (i: number) => {
    const o = glowOverride.get(i);
    let g = o ?? 0.2 + 1.8 * mems[i].freshness;
    if (i === hovered) g = Math.max(g * 1.4, 1.6);
    const f = flare.get(i);
    if (f !== undefined) g = Math.max(g, 1 + 3 * Math.min(1, f));
    return g;
  };
  const refreshMems = () => {
    for (let i = 0; i < mems.length; i++) {
      const g = memGlow(i), rf = roomF(mems[i].room);
      const k = gapped.has(i) ? 0 : 1;
      books.setColorAt(i, tmpC.copy(memBase[i]).multiplyScalar((0.45 + 0.42 * Math.min(g, 3)) * (0.3 + 0.7 * rf)));
      halos.setColorAt(i, tmpC.copy(memBase[i]).multiplyScalar(k * 0.34 * Math.max(0, Math.min(g, 4) - 0.4) * rf));
      lecterns.setColorAt(i, tmpC.setScalar(0.25 + 0.75 * rf));
    }
    books.instanceColor!.needsUpdate = true;
    halos.instanceColor!.needsUpdate = true;
    lecterns.instanceColor!.needsUpdate = true;
  };
  const applyFactors = () => {
    hemi.intensity = HEMI_I * (0.35 + 0.65 * dim);
    sun.intensity = SUN_I * (0.25 + 0.75 * dim);
    skyMat.uniforms.uDim.value = 0.45 + 0.55 * dim;
    (scene.background as THREE.Color).copy(HORIZON).multiplyScalar(0.45 + 0.55 * dim);
    (scene.fog as THREE.Fog).color.copy(scene.background as THREE.Color);
    dustMat.uniforms.uDim.value = 0.5 + 0.5 * dim;
    for (const mt of outMats) mt.color.setScalar(0.3 + 0.7 * outF);
    worldU.uF.value[OUT] = 0.3 + 0.7 * outF;
    for (const [id, v] of roomVis) {
      const f = roomF(id);
      const sl = slotOf(id);
      if (sl < OUT) worldU.uF.value[sl] = 0.25 + 0.75 * f;
      if (v.sign !== undefined) signDim.setX(v.sign, 0.3 + 0.7 * f);
    }
    signDim.needsUpdate = true;
    bannerDefs.forEach((b, i) => banners.setColorAt(i, tmpC.copy(b.color).multiplyScalar(0.3 + 0.7 * roomF(b.room))));
    banners.instanceColor!.needsUpdate = true;
  };
  refreshMems();
  refreshTorches();
  applyFactors();

  // gap verdicts: the station's book vanishes, leaving a visibly empty lectern
  events.subscribe((e) => {
    if (e.type !== "visit") return;
    const i = memIndex.get(e.memoryId);
    if (i === undefined) return;
    if (e.verdict === "gap") gapped.add(i);
    else gapped.delete(i);
  });

  // ---------- picking ----------
  const ray = new THREE.Raycaster();
  ray.far = 220; // the default camera is a 50-100 m overview
  const ndc = new THREE.Vector2();
  const pointer = new THREE.Vector2(0, 0);
  let pointerInside = false;
  const wallBoxes = layout.walls.map((w) => new THREE.Box3(V(w.min[0] - 0.5 * 0, w.min[1], w.min[2]), V(w.max[0], w.max[1], w.max[2])));
  const hitV = new THREE.Vector3();
  const pick = (at: THREE.Vector2): number => {
    ray.setFromCamera(at, camera);
    const hit = ray.intersectObjects([books, lecterns], false)[0];
    if (!hit || hit.instanceId === undefined) return -1;
    for (const b of wallBoxes) if (ray.ray.intersectBox(b, hitV) && hitV.distanceTo(ray.ray.origin) < hit.distance - 0.05) return -1;
    return hit.instanceId;
  };
  renderer.domElement.addEventListener("pointermove", (e) => {
    pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    pointerInside = true;
  });
  renderer.domElement.addEventListener("pointerleave", () => { pointerInside = false; });
  renderer.domElement.addEventListener("click", (e) => {
    const at = controls.locked ? ndc.set(0, 0) : ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    const i = pick(at);
    if (i >= 0) {
      if (controls.locked) controls.unlock();
      flare.set(i, 0.6);
      emitUI(UI_EVENTS.select, { memoryId: mems[i].id });
      return;
    }
    if (!controls.released && flying === null) controls.lock();
  });

  // ---------- flyTo ----------
  let flying: null | { t: number; dur: number; p0: THREE.Vector3; p1: THREE.Vector3; q0: THREE.Quaternion; q1: THREE.Quaternion; peak: number; idx: number } = null;
  const roomOf = (x: number, z: number): string | undefined =>
    palace.rooms.find((r) => Math.abs(x - r.center[0]) <= r.size[0] / 2 && Math.abs(z - r.center[2]) <= r.size[2] / 2)?.id;
  const flyTo = (memoryId: string) => {
    const i = memIndex.get(memoryId);
    if (i === undefined) return;
    const m = mems[i];
    const room = roomById.get(m.room);
    const orb = V(...m.pos);
    const dir = new THREE.Vector2((room ? room.center[0] : camera.position.x) - m.pos[0], (room ? room.center[2] : camera.position.z) - m.pos[2]);
    if (dir.length() < 0.5) dir.set(camera.position.x - m.pos[0], camera.position.z - m.pos[2]);
    if (dir.length() < 0.01) dir.set(0, 1);
    dir.normalize().multiplyScalar(2.7);
    let x = m.pos[0] + dir.x, z = m.pos[2] + dir.y;
    if (room) {
      x = THREE.MathUtils.clamp(x, room.center[0] - room.size[0] / 2 + 1.2, room.center[0] + room.size[0] / 2 - 1.2);
      z = THREE.MathUtils.clamp(z, room.center[2] - room.size[2] / 2 + 1.2, room.center[2] + room.size[2] / 2 - 1.2);
    }
    const p1 = V(x, EYE_HEIGHT, z);
    const q1 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(p1, orb.clone().setY(orb.y - 0.15), camera.up));
    const dist = camera.position.distanceTo(p1);
    const sameRoom = room && roomOf(camera.position.x, camera.position.z) === room.id;
    const wallTop = Math.max(...palace.rooms.map((r) => r.center[1] + r.size[1]), 4);
    if (controls.locked) controls.unlock();
    flying = {
      t: 0, dur: THREE.MathUtils.clamp(0.9 + dist * 0.035, 1, 2.6),
      p0: camera.position.clone(), p1, q0: camera.quaternion.clone(), q1,
      peak: sameRoom || dist < 4 ? 0 : wallTop + 2.5 - EYE_HEIGHT, idx: i,
    };
    syncHud();
  };
  window.addEventListener(UI_EVENTS.flyTo, (e: Event) => {
    const id = (e as CustomEvent<{ memoryId?: string }>).detail?.memoryId;
    if (id) flyTo(id);
  });
  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOutBack = (t: number) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);

  // ---------- frame loop ----------
  const frameCbs = new Set<(dt: number) => void>();
  const clock = new THREE.Clock();
  const bob = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const tilt = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), 0.22);
  const s1 = V(1, 1, 1);
  const tmpV = V();
  const yawE = new THREE.Euler(0, 0, 0, "YXZ");
  let fpsAcc = 0, fpsFrames = 0, fps = 60, perfStrikes = 0, torchAcc = 0;
  const camPrev = V(Infinity, 0, 0);

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    time += dt;
    renderer.info.reset();

    if (flying) {
      flying.t = Math.min(1, flying.t + dt / flying.dur);
      const k = ease(flying.t);
      camera.position.lerpVectors(flying.p0, flying.p1, k);
      camera.position.y += Math.sin(Math.PI * k) * flying.peak;
      camera.quaternion.slerpQuaternions(flying.q0, flying.q1, Math.min(1, k * 1.15));
      if (flying.t >= 1) {
        flare.set(flying.idx, 1.2);
        flying = null;
        if (!controls.released) controls.settle();
        syncHud();
      }
    } else controls.update(dt);

    frameCbs.forEach((cb) => cb(dt));

    // dim / lit / focus easing
    const ek = 1 - Math.exp(-dt * 5);
    let dirty = false;
    if (Math.abs(dimTarget - dim) > 1e-3) { dim += (dimTarget - dim) * ek; dirty = true; } else if (dim !== dimTarget) { dim = dimTarget; dirty = true; }
    if (Math.abs(outTarget - outF) > 1e-3) { outF += (outTarget - outF) * ek; dirty = true; } else if (outF !== outTarget) { outF = outTarget; dirty = true; }
    for (const v of focus.values()) {
      if (Math.abs(v.target - v.f) > 1e-3) { v.f += (v.target - v.f) * ek; dirty = true; } else if (v.f !== v.target) { v.f = v.target; dirty = true; }
    }
    let torchDirty = dirty;
    for (const [id, v] of roomVis) {
      if (v.lit !== v.litTarget) {
        v.lit += (v.litTarget - v.lit) * (1 - Math.exp(-dt * 6));
        if (Math.abs(v.lit - v.litTarget) < 0.01) v.lit = v.litTarget;
        torchDirty = true;
      }
      const sl = slotOf(id);
      if (sl < OUT) worldU.uLit.value[sl] = 0.16 * v.lit;
    }
    if (dirty) applyFactors();
    torchAcc += dt;
    if (torchDirty || torchAcc > 0.08) { torchAcc = 0; refreshTorches(0.08); }

    // hover
    let h = -1;
    if (!flying && (controls.locked || pointerInside)) h = pick(controls.locked ? ndc.set(0, 0) : pointer);
    if (h !== hovered) {
      hovered = h;
      renderer.domElement.style.cursor = h >= 0 ? "pointer" : "";
      tip.textContent = h >= 0 ? mems[h].title : "";
      tip.classList.toggle("on", h >= 0);
    }
    if (h >= 0 && !controls.locked) {
      tip.style.left = ((pointer.x + 1) / 2) * innerWidth + "px";
      tip.style.top = ((1 - pointer.y) / 2) * innerHeight + 22 + "px";
    } else if (h >= 0) { tip.style.left = "50%"; tip.style.top = "calc(50% + 22px)"; }

    // books: bob + slow spin; spawn animation; gap = empty lectern
    for (const [i, left] of flare) { if (left - dt <= 0) flare.delete(i); else flare.set(i, left - dt); }
    for (let i = 0; i < mems.length; i++) {
      const p = mems[i].pos;
      let sc = i === hovered ? 1.2 : 1, drop = 0, lsc = 1;
      const st = spawnT.get(i);
      if (st !== undefined) {
        const ts = st + dt;
        if (ts > 2) spawnT.delete(i); else spawnT.set(i, ts);
        lsc = ts < 0.5 ? Math.max(0.001, easeOutBack(ts / 0.5)) : 1;
        const tb = THREE.MathUtils.clamp((ts - 0.35) / 0.7, 0, 1);
        drop = (1 - tb * tb) * 2.6;
        sc *= tb > 0 ? 1 : 0.001;
        lecterns.setMatrixAt(i, m4.compose(tmpV.set(p[0], 0, p[2]), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, lecternYaw(mems[i])), s1.setScalar(lsc)));
        lecterns.instanceMatrix.needsUpdate = true;
      }
      if (gapped.has(i)) sc = 0.001;
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, time * 0.5 + i).multiply(tilt);
      bob.compose(tmpV.set(p[0], p[1] + 0.05 + Math.sin(time * 1.6 + i * 1.7) * 0.06 + drop, p[2]), q, s1.setScalar(sc));
      books.setMatrixAt(i, bob);
      halos.setMatrixAt(i, bob);
    }
    books.instanceMatrix.needsUpdate = true;
    halos.instanceMatrix.needsUpdate = true;
    refreshMems();
    dustMat.uniforms.uTime.value = time;

    // spawn particles + column
    if (pState.length) {
      let n = 0;
      for (let k = pState.length - 1; k >= 0; k--) {
        const s = pState[k];
        s.life += dt;
        if (s.life >= s.max) { pState.splice(k, 1); continue; }
        s.v.y -= 9 * dt;
        s.p.addScaledVector(s.v, dt);
        if (s.p.y < 0.05) { s.p.y = 0.05; s.v.set(s.v.x * 0.5, -s.v.y * 0.3, s.v.z * 0.5); }
      }
      for (const s of pState) {
        const f = 1 - s.life / s.max;
        parts.setMatrixAt(n, m4.compose(s.p, Q0, s1.setScalar(Math.max(0.01, f * 1.3))));
        parts.setColorAt(n, s.c);
        n++;
      }
      parts.count = n;
      parts.instanceMatrix.needsUpdate = true;
      if (parts.instanceColor) parts.instanceColor.needsUpdate = true;
      parts.visible = n > 0;
    } else parts.visible = false;
    if (columnT >= 0) {
      columnT += dt;
      const f = columnT < 0.15 ? columnT / 0.15 : Math.max(0, 1 - (columnT - 0.15) / 1.4);
      (column.material as THREE.MeshBasicMaterial).opacity = 0.55 * f;
      column.scale.set(0.4 + 0.6 * f, 1, 0.4 + 0.6 * f);
      if (f <= 0 && columnT > 0.2) { column.visible = false; columnT = -1; }
    }

    // sky follows camera; sun faces camera; clouds drift
    sky.position.copy(camera.position);
    sunSprite.position.copy(camera.position).addScaledVector(SUN_DIR, 380);
    sunSprite.lookAt(camera.position);
    clouds.position.x = ((time * 0.8) % 520);

    // minimap
    if (minimap) {
      yawE.setFromQuaternion(camera.quaternion, "YXZ");
      const k2 = camera.position.x * 1e3 + camera.position.z + yawE.y * 7;
      if (k2 !== camPrev.x || litRooms.size !== camPrev.y) {
        camPrev.set(k2, litRooms.size, 0);
        minimap.setLit(litRooms);
        minimap.draw(camera, yawE.y);
      }
    }

    if (shadowFrames > 0) { renderer.shadowMap.needsUpdate = true; shadowFrames--; }
    if (useBloom) composer.render(dt);
    else renderer.render(scene, camera);

    fpsAcc += dt;
    fpsFrames++;
    if (fpsAcc >= 1) {
      fps = fpsFrames / fpsAcc;
      fpsAcc = 0;
      fpsFrames = 0;
      if (time > 3 && fps < 45 && !params.has("nodegrade")) {
        if (++perfStrikes >= 2) {
          perfStrikes = 0;
          if (useBloom) useBloom = false;
          else if (pixelRatio > 1) { pixelRatio = 1; renderer.setPixelRatio(1); composer.setPixelRatio(1); }
          else if (sun.shadow.mapSize.x > 1024) { sun.shadow.mapSize.set(1024, 1024); sun.shadow.map?.dispose(); sun.shadow.map = null; bumpShadows(); }
        }
      } else perfStrikes = 0;
      if (debugEl) {
        const inf = renderer.info;
        debugEl.textContent = `${fps.toFixed(0)} fps · ${inf.render.calls} calls · ${(inf.render.triangles / 1000).toFixed(1)}k tris · bloom ${useBloom ? "on" : "off"} · dpr ${pixelRatio}\n` +
          `pos ${camera.position.x.toFixed(1)}, ${camera.position.z.toFixed(1)} · room ${roomOf(camera.position.x, camera.position.z) ?? "-"} · ${controls.released ? "released" : controls.locked ? "locked" : "free"}`;
      }
    }
  });

  window.addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    dustMat.uniforms.uScale.value = innerHeight / 2;
  });
  syncHud();

  const layers: Record<SceneLayer, (on: boolean) => void> = {
    links: (on) => { linkDots.visible = on; },
    roomLabels: (on) => { signs.visible = on; },
    memoryLabels: (on) => { memLabels.visible = on; },
    ceiling: (on) => { ceiling.visible = on; bumpShadows(); },
    bloom: (on) => { useBloom = on; },
  };

  const rt: PalaceRuntime = {
    palace, scene, camera, renderer, hud, events,
    memoryPosition(id) {
      const m = mems[memIndex.get(id) ?? -1];
      return m ? V(...m.pos) : undefined;
    },
    setMemoryGlow(id, intensity) {
      const i = memIndex.get(id);
      if (i === undefined) return;
      if (intensity === null) glowOverride.delete(i);
      else glowOverride.set(i, intensity);
    },
    setPalaceDim(level) { dimTarget = THREE.MathUtils.clamp(level, 0, 1); },
    setRoomLit(roomId, lit) {
      const v = roomVis.get(roomId);
      if (!v) return;
      v.litTarget = lit ? 1 : 0;
      if (lit) litRooms.add(roomId);
      else litRooms.delete(roomId);
    },
    controls: {
      release() { flying = null; controls.release(); syncHud(); },
      restore() { controls.restore(); syncHud(); },
      get locked() { return controls.locked; },
    },
    onFrame(cb) { frameCbs.add(cb); return () => { frameCbs.delete(cb); }; },
    setLayerVisible(layer, visible) { layers[layer]?.(visible); },
    focusRooms(ids) {
      const set = ids && ids.length ? new Set(ids) : null;
      for (const [id, v] of focus) v.target = !set || set.has(id) ? 1 : 0.12;
      outTarget = set ? 0.4 : 1;
    },
    addMemory(memory) {
      let i = memIndex.get(memory.id);
      if (i !== undefined) {
        mems[i] = memory;
        placeMemory(memory, i);
      } else {
        if (mems.length >= CAP) return;
        i = mems.length;
        mems.push(memory);
        memIndex.set(memory.id, i);
        if (!palace.memories.some((m) => m.id === memory.id)) palace.memories.push(memory);
        placeMemory(memory, i);
        setCounts();
        lecterns.boundingSphere = null;
        books.boundingSphere = null;
        atlas.tex.dispose();
        atlas = TX.labelAtlas(mems.map((m) => m.title));
        labelMat.uniforms.map.value = atlas.tex;
        writeLabels();
      }
      lecterns.setMatrixAt(i, m4.compose(V(memory.pos[0], 0, memory.pos[2]), Q0, V(0.001, 0.001, 0.001)));
      lecterns.instanceMatrix.needsUpdate = true;
      spawnT.set(i, 0);
      bumpShadows(80); // lectern pops in over ~0.5 s
      flare.set(i, 2.2);
      burst(V(memory.pos[0], 0.6, memory.pos[2]), new THREE.Color(roomHex(memory.room)));
    },
  };

  // QA hooks (not part of the contract)
  (window as unknown as { palaceScene: unknown }).palaceScene = {
    teleport(x: number, z: number, yawDeg = 0) {
      camera.position.set(x, EYE_HEIGHT, z);
      camera.quaternion.setFromEuler(new THREE.Euler(0, THREE.MathUtils.degToRad(yawDeg), 0, "YXZ"));
      controls.settle();
    },
    view(pos: [number, number, number], look: [number, number, number]) {
      controls.release();
      camera.position.set(...pos);
      camera.lookAt(...look);
    },
    flyTo,
    layout,
    stats: () => ({ fps, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, bloom: useBloom, shadows: renderer.shadowMap.enabled }),
    setBloom(on: boolean) { useBloom = on; },
  };
  return rt;
}

/** Loose Ends notice board: cork with pinned notes (original art). */
function noticeBoard(): HTMLCanvasElement {
  const c = TX.gravel([176, 128, 78], 404);
  const g = c.getContext("2d")!;
  const notes = ["#f4efe0", "#f6d86b", "#9fd3f0", "#f2a2a2", "#f4efe0"];
  const r = mulberry(8);
  for (let k = 0; k < 5; k++) {
    const x = 1 + Math.floor(r() * 10), y = 1 + Math.floor(r() * 10);
    g.fillStyle = notes[k];
    g.fillRect(x, y, 5, 4);
    g.fillStyle = "#8a8a8a";
    g.fillRect(x + 1, y + 2, 3, 1);
    g.fillStyle = "#d02020";
    g.fillRect(x + 2, y, 1, 1);
  }
  g.fillStyle = "#6a4a28";
  g.fillRect(0, 0, 16, 1); g.fillRect(0, 15, 16, 1); g.fillRect(0, 0, 1, 16); g.fillRect(15, 0, 1, 16);
  return c;
}

function mulberry(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PX_FONT = `ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
const SCENE_CSS = `
.mp-scene-hud { position: fixed; inset: 0; pointer-events: none; font: 13px/1.4 ${PX_FONT}; color: #f2f2f2; }
.mp-scene-hud * { pointer-events: none; }
.mp-cross { position: absolute; left: 50%; top: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px; opacity: 0;
  background: linear-gradient(#fff,#fff) center/2px 14px no-repeat, linear-gradient(#fff,#fff) center/14px 2px no-repeat; mix-blend-mode: difference; }
.mp-scene-hud.locked .mp-cross { opacity: 1; }
.mp-tip { position: absolute; transform: translateX(-50%); padding: 3px 8px; white-space: nowrap; background: rgba(16,0,16,.86);
  border: 2px solid #2a0a5e; box-shadow: inset 0 0 0 1px #5a2ab0; color: #fff; font: 600 12.5px/1.3 ${PX_FONT};
  text-shadow: 2px 2px 0 #3f3f3f; opacity: 0; }
.mp-tip.on { opacity: 1; }
.mp-hint { position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); text-align: center; padding: 8px 14px;
  background: rgba(0,0,0,.55); border: 2px solid rgba(0,0,0,.6); color: #e8e8e8; font-size: 12.5px; text-shadow: 2px 2px 0 #222; transition: opacity .35s; }
.mp-hint b { color: #ffe65c; font-weight: 700; }
.mp-hint span { color: #bdbdbd; font-size: 11.5px; }
.mp-scene-hud.locked .mp-hint, .mp-scene-hud.released .mp-hint { opacity: 0; }
.mp-minimap { position: absolute; left: 16px; bottom: 16px; padding: 4px; background: #8b8b8b;
  border: 3px solid; border-color: #fff #555 #555 #fff; box-shadow: 0 0 0 2px #000; }
.mp-minimap canvas { display: block; image-rendering: pixelated; }
.mp-debug { position: absolute; right: 16px; bottom: 120px; white-space: pre; font: 11px/1.45 ${PX_FONT};
  color: #fff; background: rgba(0,0,0,.55); padding: 4px 8px; text-shadow: 1px 1px 0 #333; }
@media (max-width: 640px) { .mp-minimap canvas { width: 120px !important; height: 120px !important; } }
`;
