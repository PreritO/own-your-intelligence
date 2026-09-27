// OWNED BY: scene. The palace renderer: builds rooms, corridors, pedestals, orbs, beams, labels and the
// PalaceRuntime every plugin receives (web/src/api.ts). Museum-at-night look, < 200 draw calls.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Palace } from "../../../server/schema";
import { UI_EVENTS, emitUI, type PalaceRuntime } from "../api";
import type { EventStream } from "../events";
import { createControls, EYE_HEIGHT } from "../controls";
import { buildLayout, type Box } from "./layout";
import { marbleTexture, radialTexture, labelTexture, wingNameTexture } from "./textures";
import { createMinimap } from "./minimap";
import { createMapView, type MapView } from "./mapview";

const FOYER_COLOR = "#d9c38f";
const ORB_R = 0.22;
const params = new URLSearchParams(location.search);
const DEBUG = params.has("debug");
// Polish: the default camera is the dollhouse overview with map controls; ?walk restores first person.
const WALK = params.has("walk");
const WALL_VIS = 1.7; // overview: room walls cut down to a dollhouse height (colliders keep full height)
/** Screen area the HUD covers in the overview (left Tasks panel), used to frame the palace. */
export const HUD_INSETS = { left: 400, right: 24, top: 24, bottom: 56 };

export function buildScene(palace: Palace, mount: HTMLElement, hud: HTMLElement, events: EventStream): PalaceRuntime {
  // ---------- renderer / scene ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  let pixelRatio = Math.min(devicePixelRatio, 1.75);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.info.autoReset = false;
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const BG = new THREE.Color("#07080d");
  scene.background = BG;
  scene.fog = new THREE.FogExp2("#07080d", 0.018);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  const ENV_I = 0.06;
  scene.environmentIntensity = ENV_I;

  const HEMI_I = 0.6, MOON_I = 0.4;
  const hemi = new THREE.HemisphereLight("#8e9cd6", "#0b0a10", HEMI_I);
  const moon = new THREE.DirectionalLight("#a9b8ff", MOON_I);
  moon.position.set(18, 40, 12);
  scene.add(hemi, moon);

  const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.08, 400);

  // ---------- lookups ----------
  const wingById = new Map(palace.wings.map((w) => [w.id, w]));
  const roomById = new Map(palace.rooms.map((r) => [r.id, r]));
  const memIndex = new Map(palace.memories.map((m, i) => [m.id, i]));
  const wingHex = (wing: string) => wingById.get(wing)?.color ?? FOYER_COLOR;
  const roomColor = (roomId?: string) => new THREE.Color(roomId ? wingHex(roomById.get(roomId)?.wing ?? "") : FOYER_COLOR);

  const layout = buildLayout(palace);
  const sceneRoot = new THREE.Group();
  sceneRoot.name = "palace";
  scene.add(sceneRoot);

  // ---------- floors ----------
  const marble = marbleTexture();
  const radial = radialTexture(0, 1.2);
  radial.channel = 1;
  const worldUV = (geo: THREE.BufferGeometry) => {
    const pos = geo.getAttribute("position");
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = pos.getX(i) / 2;
      uv[i * 2 + 1] = pos.getZ(i) / 2;
    }
    geo.setAttribute("uv1", geo.getAttribute("uv").clone());
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  };
  interface RoomVis { floor: THREE.MeshStandardMaterial; label: THREE.SpriteMaterial; lit: number; litTarget: number }
  const roomVis = new Map<string, RoomVis>();
  for (const r of palace.rooms) {
    const geo = new THREE.PlaneGeometry(r.size[0], r.size[2]);
    geo.rotateX(-Math.PI / 2);
    geo.translate(r.center[0], r.center[1], r.center[2]);
    worldUV(geo);
    const mat = new THREE.MeshStandardMaterial({
      map: marble, color: "#8e94a2", roughness: 0.55, metalness: 0.1,
      emissive: roomColor(r.id), emissiveMap: radial, emissiveIntensity: 0.03,
    });
    const floor = new THREE.Mesh(geo, mat);
    floor.name = `floor:${r.id}`;
    sceneRoot.add(floor);
    roomVis.set(r.id, { floor: mat, label: null as unknown as THREE.SpriteMaterial, lit: 0, litTarget: 0 });
  }
  if (layout.corridorFloors.length) {
    const geos = layout.corridorFloors.map((f) => {
      const g = new THREE.PlaneGeometry(f.maxX - f.minX, f.maxZ - f.minZ);
      g.rotateX(-Math.PI / 2);
      g.translate((f.minX + f.maxX) / 2, -0.004, (f.minZ + f.maxZ) / 2);
      worldUV(g);
      return g;
    });
    const merged = mergePlanes(geos);
    const corridorFloor = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ map: marble, color: "#7d8290", roughness: 0.4, metalness: 0.15 }));
    corridorFloor.name = "corridor-floors";
    sceneRoot.add(corridorFloor);
  }

  // ---------- walls (one InstancedMesh) ----------
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  unitBox.translate(0.5, 0.5, 0.5); // min corner at origin -> scale = size
  const m4 = new THREE.Matrix4();
  const boxMatrix = (b: Box, grow = 0) =>
    m4.compose(
      new THREE.Vector3(b.min[0] - grow, b.min[1], b.min[2] - grow),
      new THREE.Quaternion(),
      new THREE.Vector3(b.max[0] - b.min[0] + grow * 2, b.max[1] - b.min[1], b.max[2] - b.min[2] + grow * 2),
    );
  const wallMat = new THREE.MeshStandardMaterial({ color: "#3a4052", emissive: "#0c0e15", roughness: 0.82, metalness: 0.05 });
  const shownWalls: Box[] = WALK
    ? layout.walls
    : layout.walls
        .filter((w) => w.kind !== "lintel")
        .map((w) => ({ ...w, max: [w.max[0], Math.min(w.max[1], w.kind === "corridor-wall" ? 1.1 : WALL_VIS), w.max[2]] as [number, number, number] }));
  const walls = new THREE.InstancedMesh(unitBox, wallMat, shownWalls.length);
  walls.name = "walls";
  shownWalls.forEach((b, i) => walls.setMatrixAt(i, boxMatrix(b)));
  walls.computeBoundingSphere();
  sceneRoot.add(walls);

  // ---------- wing-coloured trim (one InstancedMesh, per-instance colour) ----------
  interface TrimDef { box: Box; room?: string; base: THREE.Color; strength: number }
  const trims: TrimDef[] = [];
  const addTrim = (box: Box, room: string | undefined, base: THREE.Color, strength = 1) => trims.push({ box, room, base, strength });
  for (const w of shownWalls) {
    const c = w.kind === "corridor-wall" ? new THREE.Color(FOYER_COLOR) : roomColor(w.roomId);
    const thinX = w.max[0] - w.min[0] < w.max[2] - w.min[2];
    const gx = thinX ? 0.025 : 0, gz = thinX ? 0 : 0.025;
    const grow = (b: Box): Box => ({ ...b, min: [b.min[0] - gx, b.min[1], b.min[2] - gz], max: [b.max[0] + gx, b.max[1], b.max[2] + gz] });
    if (w.kind === "wall") {
      addTrim(grow({ ...w, min: [w.min[0], w.min[1], w.min[2]], max: [w.max[0], w.min[1] + 0.09, w.max[2]] }), w.roomId, c, 0.8);
      addTrim(grow({ ...w, min: [w.min[0], w.max[1] - 0.06, w.min[2]], max: [w.max[0], w.max[1] + 0.02, w.max[2]] }), w.roomId, c, 1);
    } else if (w.kind === "lintel") {
      // glowing door frame on both wall faces: header + two jambs (thin, not the whole reveal)
      const alongX = !thinX; // the gap runs along x
      const s = 0.06, d = 0.05, o = 0.02;
      const faces = alongX
        ? [[w.min[2] - o, w.min[2] + d - o], [w.max[2] - d + o, w.max[2] + o]]
        : [[w.min[0] - o, w.min[0] + d - o], [w.max[0] - d + o, w.max[0] + o]];
      const g0 = alongX ? w.min[0] : w.min[2], g1 = alongX ? w.max[0] : w.max[2];
      for (const [f0, f1] of faces) {
        const mk = (a0: number, a1: number, y0: number, y1: number): Box =>
          alongX ? { ...w, min: [a0, y0, f0], max: [a1, y1, f1] } : { ...w, min: [f0, y0, a0], max: [f1, y1, a1] };
        addTrim(mk(g0, g1, w.min[1] - s, w.min[1]), w.roomId, c, 1.1);
        addTrim(mk(g0, g0 + s, 0, w.min[1]), w.roomId, c, 1.1);
        addTrim(mk(g1 - s, g1, 0, w.min[1]), w.roomId, c, 1.1);
      }
    } else {
      addTrim(grow({ ...w, min: [w.min[0], w.max[1] - 0.05, w.min[2]], max: [w.max[0], w.max[1] + 0.02, w.max[2]] }), undefined, c, 0.7);
    }
  }
  const trimMesh = new THREE.InstancedMesh(unitBox, new THREE.MeshBasicMaterial({ toneMapped: false }), trims.length);
  trimMesh.name = "trim";
  trims.forEach((t, i) => trimMesh.setMatrixAt(i, boxMatrix(t.box)));
  sceneRoot.add(trimMesh);

  // ---------- pedestals + orbs + floor light pools ----------
  const N = palace.memories.length;
  const pedGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.0, 0), new THREE.Vector2(0.36, 0), new THREE.Vector2(0.36, 0.08), new THREE.Vector2(0.27, 0.12),
      new THREE.Vector2(0.21, 0.2), new THREE.Vector2(0.19, 0.86), new THREE.Vector2(0.27, 0.92), new THREE.Vector2(0.3, 1),
      new THREE.Vector2(0.0, 1),
    ],
    10,
  );
  const pedestals = new THREE.InstancedMesh(pedGeo, new THREE.MeshStandardMaterial({ color: "#c9c2b3", roughness: 0.45, metalness: 0.05 }), Math.max(N, 1));
  pedestals.name = "pedestals";
  pedestals.count = N;
  // Orb: glowing core shader (bright centre, softer rim) so it reads as light even with bloom off.
  const orbMat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vC; varying float vF;
      void main() {
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vec3 n = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vec3 v = normalize(cameraPosition - wp.xyz);
        vF = clamp(dot(n, v), 0.0, 1.0);
        vC = instanceColor;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC; varying float vF;
      void main() {
        float core = pow(vF, 2.5);
        vec3 c = vC * (0.55 + 0.9 * core) + vec3(1.0, 0.95, 0.85) * core * 0.35 * min(1.0, dot(vC, vec3(0.33)));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const orbs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(ORB_R, 2), orbMat, Math.max(N, 1));
  orbs.name = "orbs";
  orbs.count = N;
  const poolGeo = new THREE.PlaneGeometry(2.6, 2.6);
  poolGeo.rotateX(-Math.PI / 2);
  const pools = new THREE.InstancedMesh(
    poolGeo,
    new THREE.MeshBasicMaterial({ map: radialTexture(0, 0.8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    Math.max(N, 1),
  );
  pools.name = "orb-pools";
  pools.count = N;
  // Halo: camera-facing soft disc per orb (instanced billboard), additive.
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
        float d = length(vUv - 0.5) * 2.0;
        float a = pow(max(0.0, 1.0 - d), 2.2);
        gl_FragColor = vec4(vC * a, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const halos = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.5, 1.5), haloMat, Math.max(N, 1));
  halos.name = "orb-halos";
  halos.count = N;
  halos.frustumCulled = false;
  const FRESH = new THREE.Color("#ffcf86"), STALE = new THREE.Color("#8f8272");
  const orbBase: THREE.Color[] = [];
  const glowOverride = new Map<number, number>();
  palace.memories.forEach((m, i) => {
    const pedH = Math.max(0.2, m.pos[1] - ORB_R - 0.08);
    pedestals.setMatrixAt(i, m4.compose(new THREE.Vector3(m.pos[0], 0, m.pos[2]), new THREE.Quaternion(), new THREE.Vector3(1, pedH, 1)));
    orbs.setMatrixAt(i, m4.makeTranslation(m.pos[0], m.pos[1], m.pos[2]));
    pools.setMatrixAt(i, m4.makeTranslation(m.pos[0], 0.015, m.pos[2]));
    orbBase.push(STALE.clone().lerp(FRESH, m.freshness));
  });
  pedestals.computeBoundingSphere();
  orbs.computeBoundingSphere();
  sceneRoot.add(pedestals, orbs, pools, halos);

  // ---------- dust on stale memories (one Points, shader-animated) ----------
  const stale = palace.memories.filter((m) => m.freshness < 0.3);
  const DUST_PER = 46;
  const dustPos = new Float32Array(stale.length * DUST_PER * 3);
  const dustSeed = new Float32Array(stale.length * DUST_PER);
  let di = 0;
  const rnd = mulberry(42);
  for (const m of stale) {
    for (let k = 0; k < DUST_PER; k++, di++) {
      const a = rnd() * Math.PI * 2, rr = 0.15 + rnd() * 0.75, y = (rnd() - 0.3) * 1.3;
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
        vec3 p = position;
        float t = uTime * 0.25 + seed;
        p += vec3(sin(t * 1.3) * 0.12, sin(t * 0.7 + seed) * 0.18, cos(t * 1.1) * 0.12);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (0.022 + 0.018 * fract(seed)) * uScale / -mv.z;
        vA = 0.35 + 0.35 * sin(t * 2.0 + seed * 3.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vA; uniform float uDim;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        gl_FragColor = vec4(vec3(0.85, 0.76, 0.6) * uDim, vA * smoothstep(0.5, 0.0, d));
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.name = "dust";
  dust.frustumCulled = false;
  if (stale.length) sceneRoot.add(dust);

  // ---------- link beams (one LineSegments, arcs, vertex colours) ----------
  const SEG = 18;
  const links = palace.links
    .map((l) => ({ a: memIndex.get(l.from), b: memIndex.get(l.to) }))
    .filter((l): l is { a: number; b: number } => l.a !== undefined && l.b !== undefined && l.a !== l.b);
  const beamPos = new Float32Array(links.length * SEG * 2 * 3);
  const beamCol = new Float32Array(beamPos.length);
  const beamBaseA: THREE.Color[] = [], beamBaseB: THREE.Color[] = [];
  const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3();
  links.forEach((l, li) => {
    const A = palace.memories[l.a], B = palace.memories[l.b];
    pa.fromArray(A.pos);
    pb.fromArray(B.pos);
    const dist = pa.distanceTo(pb);
    const lift = Math.min(0.5 + dist * 0.12, 2.2);
    const pt = (t: number) => pc.lerpVectors(pa, pb, t).setY(pc.y + Math.sin(Math.PI * t) * lift).toArray();
    for (let s = 0; s < SEG; s++) {
      beamPos.set(pt(s / SEG), (li * SEG + s) * 6);
      beamPos.set(pt((s + 1) / SEG), (li * SEG + s) * 6 + 3);
    }
    beamBaseA.push(roomColor(A.room).lerp(new THREE.Color("#fff1d6"), 0.35));
    beamBaseB.push(roomColor(B.room).lerp(new THREE.Color("#fff1d6"), 0.35));
  });
  const beamGeo = new THREE.BufferGeometry();
  beamGeo.setAttribute("position", new THREE.BufferAttribute(beamPos, 3));
  const beamColAttr = new THREE.BufferAttribute(beamCol, 3);
  beamColAttr.setUsage(THREE.DynamicDrawUsage);
  beamGeo.setAttribute("color", beamColAttr);
  const beams = new THREE.LineSegments(
    beamGeo,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  beams.name = "link-beams";
  beams.frustumCulled = false;
  if (links.length) sceneRoot.add(beams);
  beams.visible = WALK || params.has("links");
  // HUD toggles and follow mode talk to the scene through window events (scene-internal, not api.ts)
  window.addEventListener("mp:links", (e) => { beams.visible = !!(e as CustomEvent).detail?.on; });
  window.addEventListener("mp:focus", (e) => {
    const following = !!(e as CustomEvent).detail?.agent;
    for (const l of roomLabels) l.visible = !following; // room names only in the overview
  });
  window.addEventListener("mp:home", () => mapView?.home());

  // ---------- room labels ----------
  const roomLabels: THREE.Sprite[] = [];
  for (const r of palace.rooms) {
    const wing = wingById.get(r.wing);
    const caption = wing ? wing.label : r.wing === "foyer" ? "Mind Palace" : r.wing;
    const { tex, aspect } = labelTexture(r.label, caption, wingHex(r.wing));
    const mat = new THREE.SpriteMaterial({ map: tex, color: "#c8c4bc", transparent: true, depthWrite: false, fog: true, opacity: 0.95 });
    const sp = new THREE.Sprite(mat);
    const h = WALK ? 0.95 : 1.9;
    sp.scale.set(h * aspect, h, 1);
    sp.position.set(r.center[0], r.center[1] + (WALK ? Math.min(r.size[1] - 0.55, 3.35) : 3.2), r.center[2]);
    roomLabels.push(sp);
    sp.name = `label:${r.id}`;
    sceneRoot.add(sp);
    roomVis.get(r.id)!.label = mat;
  }

  // ---------- wing names on the ground outside each wing (read from overhead; fade in with height) ----------
  const wingLabels: THREE.MeshBasicMaterial[] = [];
  for (const w of palace.wings) {
    const rooms = palace.rooms.filter((r) => r.wing === w.id);
    if (!rooms.length) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const r of rooms) {
      x0 = Math.min(x0, r.center[0] - r.size[0] / 2); x1 = Math.max(x1, r.center[0] + r.size[0] / 2);
      z0 = Math.min(z0, r.center[2] - r.size[2] / 2); z1 = Math.max(z1, r.center[2] + r.size[2] / 2);
    }
    const { tex, aspect } = wingNameTexture(w.label, w.color);
    const H = 2.6, W = H * aspect;
    const geo = new THREE.PlaneGeometry(W, H);
    geo.rotateX(-Math.PI / 2); // flat, text reads with -z up (overhead "north")
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0, fog: false });
    const mesh = new THREE.Mesh(geo, mat);
    const horizontal = x1 - x0 >= z1 - z0;
    if (horizontal) mesh.position.set((x0 + x1) / 2, 0.03, z0 - H / 2 - 0.9); // north of an east/west wing
    else mesh.position.set(x0 - W / 2 - 1.2, 0.03, (z0 + z1) / 2); // west of a north/south wing
    mesh.name = `wing-name:${w.id}`;
    mesh.renderOrder = 2;
    sceneRoot.add(mesh);
    wingLabels.push(mat);
  }

  // ---------- night sky ----------
  {
    const n = 1400, p = new Float32Array(n * 3), rs = mulberry(9);
    for (let i = 0; i < n; i++) {
      const th = rs() * Math.PI * 2, ph = Math.acos(rs() * 0.92), R = 180;
      p.set([Math.sin(ph) * Math.cos(th) * R, Math.cos(ph) * R, Math.sin(ph) * Math.sin(th) * R], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: "#c9d2ff", size: 1.4, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.7 }));
    stars.name = "stars";
    scene.add(stars);
  }

  // ---------- post: bloom ----------
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), WALK ? 0.85 : 0.42, 0.45, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  let useBloom = !params.has("nobloom");

  // ---------- controls ----------
  const walkable = (x: number, z: number) =>
    palace.rooms.some((r) => Math.abs(x - r.center[0]) < r.size[0] / 2 - 0.1 && Math.abs(z - r.center[2]) < r.size[2] / 2 - 0.1) ||
    layout.corridorFloors.some((f) => x > f.minX && x < f.maxX && z > f.minZ && z < f.maxZ);
  const mapView: MapView | null = WALK ? null : createMapView(camera, renderer.domElement, layout.bounds, HUD_INSETS);
  const controls = mapView ?? createControls(camera, renderer.domElement, layout.colliders, walkable);
  const foyer = roomById.get("foyer") ?? palace.rooms[0];
  if (!WALK) {
    // map view already framed the palace
  } else if (foyer) {
    // Stage start pose (polish): west side of the foyer, facing the Legal wing (+x), so the tour beat
    // walks straight ahead; People and Finance doors sit on the side walls.
    const legal = palace.rooms.find((r) => r.wing === "legal");
    const dir = legal ? Math.sign(legal.center[0] - foyer.center[0]) || 1 : 1;
    camera.position.set(foyer.center[0] - dir * foyer.size[0] * 0.3, EYE_HEIGHT, foyer.center[2]);
    camera.lookAt(foyer.center[0] + dir * 10, EYE_HEIGHT, foyer.center[2]);
  } else {
    camera.position.set(0, EYE_HEIGHT, 4);
  }

  // ---------- HUD (scene-owned bits) ----------
  const style = document.createElement("style");
  style.textContent = SCENE_CSS;
  document.head.appendChild(style);
  const sh = document.createElement("div");
  sh.className = "mp-scene-hud";
  sh.style.pointerEvents = "none";
  sh.innerHTML = `<div class="mp-cross"></div><div class="mp-tip"></div><div class="mp-hint">${WALK
    ? `<b>Click</b> to walk &nbsp;·&nbsp; <b>WASD</b> move &nbsp;·&nbsp; <b>Shift</b> run &nbsp;·&nbsp; <b>Esc</b> release<br><span>click a glowing memory to open it</span>`
    : `<b>Drag</b> to move &nbsp; <b>Right-drag</b> to turn &nbsp; <b>Scroll</b> to zoom<br><span>Click a glowing memory to read it</span>`}</div>`;
  hud.appendChild(sh);
  const cross = sh.querySelector<HTMLElement>(".mp-cross")!;
  const tip = sh.querySelector<HTMLElement>(".mp-tip")!;
  const hint = sh.querySelector<HTMLElement>(".mp-hint")!;
  const syncHud = () => {
    sh.classList.toggle("locked", controls.locked);
    sh.classList.toggle("released", controls.released || flying !== null);
  };
  controls.onLockChange(syncHud);
  const minimap = params.has("nominimap") || !WALK ? null : createMinimap(palace, layout, sh, wingHex);
  let debugEl: HTMLElement | null = null;
  if (DEBUG) {
    debugEl = document.createElement("div");
    debugEl.className = "mp-debug";
    sh.appendChild(debugEl);
  }

  // ---------- state: glow, dim, lit ----------
  let dimTarget = 1, dim = 1;
  const litRooms = new Set<string>();
  let hovered = -1;
  let flare = new Map<number, number>(); // memory index -> seconds left (arrival flare)
  const tmpC = new THREE.Color();
  const orbGlow = (i: number) => {
    const o = glowOverride.get(i);
    let g = o ?? (0.2 + 1.8 * palace.memories[i].freshness) * (0.35 + 0.65 * dim);
    if (i === hovered) g = Math.max(g * 1.5, 1.6);
    const f = flare.get(i);
    if (f !== undefined) g = Math.max(g, 1 + 3 * Math.min(1, f));
    return g;
  };
  const refreshOrbs = () => {
    for (let i = 0; i < N; i++) {
      const g = orbGlow(i);
      orbs.setColorAt(i, tmpC.copy(orbBase[i]).multiplyScalar(0.55 * g));
      pools.setColorAt(i, tmpC.copy(orbBase[i]).multiplyScalar(0.2 * Math.min(g, 3)));
      halos.setColorAt(i, tmpC.copy(orbBase[i]).multiplyScalar(0.16 * Math.min(g, 4)));
    }
    if (halos.instanceColor) halos.instanceColor.needsUpdate = true;
    if (orbs.instanceColor) orbs.instanceColor.needsUpdate = true;
    if (pools.instanceColor) pools.instanceColor.needsUpdate = true;
  };
  const refreshTrim = () => {
    trims.forEach((t, i) => {
      const lit = t.room ? (roomVis.get(t.room)?.lit ?? 0) : 0;
      const k = t.strength * (0.45 + 0.6 * lit) * (0.3 + 0.7 * dim);
      trimMesh.setColorAt(i, tmpC.copy(t.base).multiplyScalar(k));
    });
    if (trimMesh.instanceColor) trimMesh.instanceColor.needsUpdate = true;
  };
  const applyDim = () => {
    hemi.intensity = HEMI_I * (0.35 + 0.65 * dim);
    moon.intensity = MOON_I * dim;
    scene.environmentIntensity = ENV_I * dim;
    dustMat.uniforms.uDim.value = 0.4 + 0.6 * dim;
    for (const v of roomVis.values()) v.label.opacity = 0.35 + 0.6 * dim + 0.05 * v.lit;
  };
  refreshOrbs();
  refreshTrim();

  // ---------- picking ----------
  const ray = new THREE.Raycaster();
  ray.far = WALK ? 30 : 500;
  const ndc = new THREE.Vector2();
  const pointer = new THREE.Vector2(0, 0);
  let pointerInside = false;
  const pickTargets = [orbs, pedestals, walls];
  const pick = (at: THREE.Vector2): number => {
    ray.setFromCamera(at, camera);
    const hit = ray.intersectObjects(pickTargets, false)[0];
    if (!hit || hit.object === walls || hit.instanceId === undefined) return -1;
    return hit.instanceId;
  };
  renderer.domElement.addEventListener("pointermove", (e) => {
    pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    pointerInside = true;
  });
  renderer.domElement.addEventListener("pointerleave", () => { pointerInside = false; });
  let downAt = { x: 0, y: 0 };
  renderer.domElement.addEventListener("pointerdown", (e) => { downAt = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener("click", (e) => {
    if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return; // that was a drag (pan/rotate)
    if (mapView) sh.classList.add("touched");
    const at = controls.locked ? ndc.set(0, 0) : ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    const i = pick(at);
    if (i >= 0) {
      const memoryId = palace.memories[i].id;
      if (controls.locked) controls.unlock(); // free the mouse for the side panel
      flare.set(i, 0.6);
      emitUI(UI_EVENTS.select, { memoryId });
      return;
    }
    if (!controls.released && flying === null) controls.lock();
  });

  // ---------- flyTo ----------
  let flying: null | { t: number; dur: number; p0: THREE.Vector3; p1: THREE.Vector3; q0: THREE.Quaternion; q1: THREE.Quaternion; peak: number; idx: number } = null;
  const flyTo = (memoryId: string) => {
    const i = memIndex.get(memoryId);
    if (i === undefined) return;
    if (mapView) {
      mapView.focus(new THREE.Vector3(...palace.memories[i].pos));
      flare.set(i, 1.2);
      return;
    }
    const m = palace.memories[i];
    const room = roomById.get(m.room);
    const orb = new THREE.Vector3(...m.pos);
    const dir = new THREE.Vector2(
      (room ? room.center[0] : camera.position.x) - m.pos[0],
      (room ? room.center[2] : camera.position.z) - m.pos[2],
    );
    if (dir.length() < 0.5) dir.set(camera.position.x - m.pos[0], camera.position.z - m.pos[2]);
    if (dir.length() < 0.01) dir.set(0, 1);
    dir.normalize().multiplyScalar(2.7);
    let x = m.pos[0] + dir.x, z = m.pos[2] + dir.y;
    if (room) {
      x = THREE.MathUtils.clamp(x, room.center[0] - room.size[0] / 2 + 0.7, room.center[0] + room.size[0] / 2 - 0.7);
      z = THREE.MathUtils.clamp(z, room.center[2] - room.size[2] / 2 + 0.7, room.center[2] + room.size[2] / 2 - 0.7);
    }
    const p1 = new THREE.Vector3(x, EYE_HEIGHT, z);
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
  const onFlyTo = (e: Event) => {
    const id = (e as CustomEvent<{ memoryId?: string }>).detail?.memoryId;
    if (id) flyTo(id);
  };
  window.addEventListener(UI_EVENTS.flyTo, onFlyTo);
  const roomOf = (x: number, z: number): string | undefined =>
    palace.rooms.find((r) => Math.abs(x - r.center[0]) <= r.size[0] / 2 && Math.abs(z - r.center[2]) <= r.size[2] / 2)?.id;
  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  // ---------- frame loop ----------
  const frameCbs = new Set<(dt: number) => void>();
  const clock = new THREE.Clock();
  let time = 0;
  const bob = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s1 = new THREE.Vector3(1, 1, 1);
  const tmpV = new THREE.Vector3();
  const yawE = new THREE.Euler(0, 0, 0, "YXZ");
  let fpsAcc = 0, fpsFrames = 0, fps = 60, perfStrikes = 0;
  const camPrev = new THREE.Vector3(Infinity, 0, 0);

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    time += dt;
    renderer.info.reset();

    // player / flight
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
    } else {
      controls.update(dt);
    }

    // plugins
    frameCbs.forEach((cb) => cb(dt));

    // dim / lit easing
    const dimNext = dim + (dimTarget - dim) * (1 - Math.exp(-dt * 5));
    let trimDirty = false;
    if (Math.abs(dimNext - dim) > 1e-4) { dim = dimNext; applyDim(); trimDirty = true; } else if (dim !== dimTarget) { dim = dimTarget; applyDim(); trimDirty = true; }
    for (const [id, v] of roomVis) {
      if (v.lit !== v.litTarget) {
        v.lit += (v.litTarget - v.lit) * (1 - Math.exp(-dt * 6));
        if (Math.abs(v.lit - v.litTarget) < 0.01) v.lit = v.litTarget;
        trimDirty = true;
      }
      v.floor.emissiveIntensity = (0.012 + 0.28 * v.lit) * (0.4 + 0.6 * dim);
      void id;
    }
    if (trimDirty) refreshTrim();

    // hover (crosshair when locked, mouse otherwise)
    let h = -1;
    if (!flying && (controls.locked || pointerInside)) h = pick(controls.locked ? ndc.set(0, 0) : pointer);
    if (h !== hovered) {
      hovered = h;
      renderer.domElement.style.cursor = h >= 0 ? "pointer" : "";
      tip.textContent = h >= 0 ? palace.memories[h].title : "";
      tip.classList.toggle("on", h >= 0);
    }
    if (h >= 0 && !controls.locked) {
      tip.style.left = ((pointer.x + 1) / 2) * innerWidth + "px";
      tip.style.top = ((1 - pointer.y) / 2) * innerHeight + 22 + "px";
    } else if (h >= 0) {
      tip.style.left = "50%";
      tip.style.top = "calc(50% + 22px)";
    }

    // orbs: bob + spin, glow
    for (const [i, left] of flare) { if (left - dt <= 0) flare.delete(i); else flare.set(i, left - dt); }
    for (let i = 0; i < N; i++) {
      const p = palace.memories[i].pos;
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, time * 0.4 + i);
      const sc = i === hovered ? 1.18 : 1;
      bob.compose(tmpV.set(p[0], p[1] + Math.sin(time * 1.3 + i * 1.7) * 0.035, p[2]), q, s1.setScalar(sc));
      orbs.setMatrixAt(i, bob);
      halos.setMatrixAt(i, bob);
    }
    orbs.instanceMatrix.needsUpdate = true;
    halos.instanceMatrix.needsUpdate = true;
    refreshOrbs();

    // dust
    dustMat.uniforms.uTime.value = time;

    // beams: brighten within 6 m of either end, soft travelling shimmer
    // overhead / establishing shots: fade link-beam clutter, fade in the wing names
    const high = smooth(9, 24, camera.position.y);
    for (const m of wingLabels) m.opacity = 0.9 * high;
    if (links.length && beams.visible) {
      const cp = camera.position;
      for (let li = 0; li < links.length; li++) {
        const A = palace.memories[links[li].a].pos, B = palace.memories[links[li].b].pos;
        const dA = Math.hypot(cp.x - A[0], cp.y - A[1], cp.z - A[2]);
        const dB = Math.hypot(cp.x - B[0], cp.y - B[1], cp.z - B[2]);
        const near = Math.max(smooth(6, 1.5, dA), smooth(6, 1.5, dB));
        const hot = hovered === links[li].a || hovered === links[li].b ? 1 : 0;
        const base = (0.09 + 0.75 * Math.max(near, hot)) * (0.4 + 0.6 * dim) * (1 - 0.8 * high);
        const ca = beamBaseA[li], cb = beamBaseB[li];
        for (let s = 0; s <= SEG * 2 - 1; s++) {
          const u = (Math.floor(s / 2) + (s % 2)) / SEG;
          const shimmer = 0.75 + 0.25 * Math.sin(time * 2.2 - u * 9 + li);
          const k = base * shimmer;
          const o = (li * SEG * 2 + s) * 3;
          beamCol[o] = (ca.r + (cb.r - ca.r) * u) * k;
          beamCol[o + 1] = (ca.g + (cb.g - ca.g) * u) * k;
          beamCol[o + 2] = (ca.b + (cb.b - ca.b) * u) * k;
        }
      }
      beamColAttr.needsUpdate = true;
    }

    // minimap (only when the camera moved or turned)
    if (minimap) {
      yawE.setFromQuaternion(camera.quaternion, "YXZ");
      const key = camera.position.x * 1e3 + camera.position.z + yawE.y * 7;
      if (key !== camPrev.x || litRooms.size !== camPrev.y) {
        camPrev.set(key, litRooms.size, 0);
        minimap.setLit(litRooms);
        minimap.draw(camera, yawE.y);
      }
    }

    // render
    if (useBloom) composer.render(dt);
    else renderer.render(scene, camera);

    // perf: fps meter + auto-degrade (drop bloom, then pixel ratio) if the laptop can't keep up
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

  const rt: PalaceRuntime = {
    palace, scene, camera, renderer, hud, events,
    memoryPosition(id) {
      const m = palace.memories[memIndex.get(id) ?? -1];
      return m ? new THREE.Vector3(...m.pos) : undefined;
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
  };

  // QA hooks (not part of the contract): window.palaceScene.teleport(x, z, yawDeg) etc.
  (window as unknown as { palaceScene: unknown }).palaceScene = {
    teleport(x: number, z: number, yawDeg = 0) {
      camera.position.set(x, EYE_HEIGHT, z);
      camera.quaternion.setFromEuler(new THREE.Euler(0, THREE.MathUtils.degToRad(yawDeg), 0, "YXZ"));
      controls.settle();
    },
    flyTo,
    layout,
    stats: () => ({ fps, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, bloom: useBloom }),
    setBloom(on: boolean) { useBloom = on; },
  };
  return rt;
}

function smooth(e0: number, e1: number, x: number) {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
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

/** Merge non-indexed-compatible plane geometries (position, normal, uv, uv1, index). */
function mergePlanes(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const names = ["position", "normal", "uv", "uv1"] as const;
  let vCount = 0, iCount = 0;
  for (const g of geos) { vCount += g.getAttribute("position").count; iCount += g.getIndex()!.count; }
  const index: number[] = new Array(iCount);
  const arrays = names.map((n) => new Float32Array(vCount * geos[0].getAttribute(n).itemSize));
  let vo = 0, io = 0;
  for (const g of geos) {
    names.forEach((n, k) => { const a = g.getAttribute(n); arrays[k].set(a.array as Float32Array, vo * a.itemSize); });
    const idx = g.getIndex()!;
    for (let j = 0; j < idx.count; j++) index[io++] = idx.getX(j) + vo;
    vo += g.getAttribute("position").count;
  }
  names.forEach((n, k) => out.setAttribute(n, new THREE.BufferAttribute(arrays[k], geos[0].getAttribute(n).itemSize)));
  out.setIndex(index);
  return out;
}


const SCENE_CSS = `
.mp-scene-hud { position: fixed; inset: 0; pointer-events: none; font: 13px/1.4 ui-sans-serif, system-ui, sans-serif; color: #e9e3d6; }
.mp-scene-hud * { pointer-events: none; }
.mp-cross { position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%;
  background: rgba(255,240,215,.9); box-shadow: 0 0 8px rgba(255,210,150,.8); opacity: 0; transition: opacity .2s; }
.mp-scene-hud.locked .mp-cross { opacity: 1; }
.mp-tip { position: absolute; transform: translateX(-50%); padding: 4px 10px; border-radius: 999px; white-space: nowrap;
  background: rgba(12,13,18,.78); border: 1px solid rgba(255,214,160,.35); color: #fbe9cc; letter-spacing: .01em;
  font: 500 12.5px/1.3 ui-serif, Georgia, serif; opacity: 0; transition: opacity .15s; }
.mp-tip.on { opacity: 1; }
.mp-hint { position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); text-align: center; padding: 10px 18px;
  border-radius: 12px; background: rgba(10,11,16,.55); border: 1px solid rgba(255,255,255,.08); backdrop-filter: blur(6px);
  color: #d8d2c4; font-size: 12.5px; letter-spacing: .02em; transition: opacity .35s; }
.mp-hint b { color: #ffe2b0; font-weight: 600; }
.mp-hint span { color: #9a9486; font-size: 11.5px; }
.mp-scene-hud.locked .mp-hint, .mp-scene-hud.released .mp-hint, .mp-scene-hud.touched .mp-hint { opacity: 0; }
.mp-minimap { position: absolute; left: 16px; bottom: 16px; padding: 6px; border-radius: 14px;
  background: rgba(8,9,13,.72); border: 1px solid rgba(255,255,255,.08); box-shadow: 0 8px 30px rgba(0,0,0,.45); backdrop-filter: blur(6px); }
.mp-minimap canvas { display: block; }
.mp-minimap { transition: opacity .4s; }
body.mp-overhead .mp-minimap { opacity: 0; }
.mp-debug { position: absolute; left: 16px; top: 16px; white-space: pre; font: 11px/1.45 ui-monospace, Menlo, monospace;
  color: #b8f7c8; background: rgba(0,0,0,.6); padding: 6px 9px; border-radius: 8px; }
@media (max-width: 640px) { .mp-minimap canvas { width: 120px !important; height: 120px !important; } }
`;
