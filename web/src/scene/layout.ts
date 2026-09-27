// OWNED BY: scene. Pure geometry: palace.json rooms/doors -> wall boxes, door gaps, corridor legs, colliders.
// No three.js objects here so it stays easy to reason about (and to reuse for the minimap).
import type { Palace, Room, Vec3 } from "../../../server/schema";

// Voxel grid: blocks are 1 m cubes centred on integer x/z (so a wall on an integer wall line is one block
// thick) and spanning integer y. Doors are 3-block gaps, 3 blocks tall; corridor walls are 2 blocks.
export const DOOR_WIDTH = 3;
export const DOOR_HEIGHT = 3;
export const WALL_T = 1;
export const CORRIDOR_WALL_H = 2;

/** Axis-aligned box: min/max corners, meters. */
export interface Box {
  min: [number, number, number];
  max: [number, number, number];
  roomId?: string; // owning room (for palette / lighting); corridors: the non-foyer room they lead to
  kind: "wall" | "lintel" | "corridor-wall";
}

export interface CorridorLeg {
  from: [number, number]; // xz
  to: [number, number];
  a: string; // room ids joined
  b: string;
}

export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }

export interface Layout {
  walls: Box[]; // room walls, lintels and corridor walls (render these)
  colliders: Box[]; // what the player collides with (walls + corridor walls, no lintels)
  corridors: CorridorLeg[]; // centre-line legs, door to door
  corridorFloors: Rect[]; // floor rectangles (incl. joints), xz
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

type Side = "N" | "S" | "E" | "W"; // N = -z, S = +z, E = +x, W = -x

const half = (r: Room) => [r.size[0] / 2, r.size[1] / 2, r.size[2] / 2] as const;

/** Which wall of the room a door sits on (nearest wall line). */
export function doorSide(r: Room, p: Vec3): Side {
  const [hx, , hz] = half(r);
  const d = {
    E: Math.abs(p[0] - (r.center[0] + hx)),
    W: Math.abs(p[0] - (r.center[0] - hx)),
    S: Math.abs(p[2] - (r.center[2] + hz)),
    N: Math.abs(p[2] - (r.center[2] - hz)),
  };
  return (Object.keys(d) as Side[]).reduce((a, b) => (d[a] <= d[b] ? a : b));
}

export function sideNormal(s: Side): [number, number] {
  return s === "E" ? [1, 0] : s === "W" ? [-1, 0] : s === "S" ? [0, 1] : [0, -1];
}

/** Snap a door onto its wall line so gaps and corridors line up even with sloppy layout. */
export function snapDoor(r: Room, p: Vec3): [number, number] {
  const [hx, , hz] = half(r);
  const s = doorSide(r, p);
  if (s === "E") return [r.center[0] + hx, p[2]];
  if (s === "W") return [r.center[0] - hx, p[2]];
  if (s === "S") return [p[0], r.center[2] + hz];
  return [p[0], r.center[2] - hz];
}

/** Split a 1D span [a,b] by gaps (centre, width) -> solid pieces. */
function splitSpan(a: number, b: number, gaps: number[], w: number): [number, number][] {
  const cuts = gaps
    .map((g) => [Math.max(a, g - w / 2), Math.min(b, g + w / 2)] as [number, number])
    .filter(([x, y]) => y > x)
    .sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  let cur = a;
  for (const [x, y] of cuts) {
    if (x > cur + 0.01) out.push([cur, x]);
    cur = Math.max(cur, y);
  }
  if (b > cur + 0.01) out.push([cur, b]);
  return out;
}

export function buildLayout(palace: Palace): Layout {
  const rooms = new Map(palace.rooms.map((r) => [r.id, r]));
  const walls: Box[] = [];
  const corridors: CorridorLeg[] = [];

  // A door is "open" (gap cut) when its partner room exists. Gaps per room side.
  const gaps = new Map<string, Record<Side, number[]>>();
  for (const r of palace.rooms) gaps.set(r.id, { N: [], S: [], E: [], W: [] });
  for (const r of palace.rooms) {
    for (const d of r.doors) {
      if (!rooms.has(d.to)) continue;
      const s = doorSide(r, d.pos);
      const [x, z] = snapDoor(r, d.pos);
      gaps.get(r.id)![s].push(s === "E" || s === "W" ? z : x);
    }
  }

  // Corridors: one per unordered room pair that has a door (either direction).
  const done = new Set<string>();
  for (const r of palace.rooms) {
    for (const d of r.doors) {
      const other = rooms.get(d.to);
      if (!other) continue;
      const key = [r.id, other.id].sort().join("|");
      if (done.has(key)) continue;
      done.add(key);
      const back = other.doors.find((x) => x.to === r.id);
      const A = snapDoor(r, d.pos);
      const nA = sideNormal(doorSide(r, d.pos));
      let B: [number, number];
      let nB: [number, number];
      if (back) {
        B = snapDoor(other, back.pos);
        nB = sideNormal(doorSide(other, back.pos));
      } else {
        // No partner door listed: project A onto the facing wall of the other room.
        const guess: Vec3 = [A[0], 0, A[1]];
        B = snapDoor(other, guess);
        nB = sideNormal(doorSide(other, guess));
        const s = doorSide(other, guess);
        gaps.get(other.id)![s].push(s === "E" || s === "W" ? B[1] : B[0]); // late gap: see NOTES
      }
      for (const leg of corridorPath(A, nA, B, nB)) corridors.push({ ...leg, a: r.id, b: other.id });
    }
  }

  // Room walls: each side split around its door gaps; a lintel above every gap.
  for (const r of palace.rooms) {
    const [hx, , hz] = half(r);
    const h = r.size[1];
    const y0 = r.center[1];
    const x0 = r.center[0] - hx, x1 = r.center[0] + hx;
    const z0 = r.center[2] - hz, z1 = r.center[2] + hz;
    const t = WALL_T / 2;
    const g = gaps.get(r.id)!;
    // N/S walls run along x (extend by t to close corners)
    for (const [side, z] of [["N", z0], ["S", z1]] as const) {
      for (const [a, b] of splitSpan(x0 - t, x1 + t, g[side], DOOR_WIDTH))
        walls.push({ min: [a, y0, z - t], max: [b, y0 + h, z + t], roomId: r.id, kind: "wall" });
      if (h > DOOR_HEIGHT)
        for (const c of g[side])
          walls.push({ min: [c - DOOR_WIDTH / 2, y0 + DOOR_HEIGHT, z - t], max: [c + DOOR_WIDTH / 2, y0 + h, z + t], roomId: r.id, kind: "lintel" });
    }
    for (const [side, x] of [["W", x0], ["E", x1]] as const) {
      for (const [a, b] of splitSpan(z0 + t, z1 - t, g[side], DOOR_WIDTH))
        walls.push({ min: [x - t, y0, a], max: [x + t, y0 + h, b], roomId: r.id, kind: "wall" });
      if (h > DOOR_HEIGHT)
        for (const c of g[side])
          walls.push({ min: [x - t, y0 + DOOR_HEIGHT, c - DOOR_WIDTH / 2], max: [x + t, y0 + h, c + DOOR_WIDTH / 2], roomId: r.id, kind: "lintel" });
    }
  }

  // Corridor side walls (low), with corner handling for L/Z shapes.
  const hw = DOOR_WIDTH / 2 + WALL_T / 2;
  const legs = corridors;
  const corridorFloors: Rect[] = [];
  const byPair = new Map<string, CorridorLeg[]>();
  for (const l of legs) {
    const k = l.a + "|" + l.b;
    (byPair.get(k) ?? byPair.set(k, []).get(k)!).push(l);
  }
  for (const chain of byPair.values()) {
    chain.forEach((leg, i) => {
      const dx = Math.sign(leg.to[0] - leg.from[0]);
      const dz = Math.sign(leg.to[1] - leg.from[1]);
      const len = Math.hypot(leg.to[0] - leg.from[0], leg.to[1] - leg.from[1]);
      if (len < 0.01) return;
      const prev = chain[i - 1];
      const next = chain[i + 1];
      const prevDir = prev ? [Math.sign(prev.to[0] - prev.from[0]), Math.sign(prev.to[1] - prev.from[1])] : null;
      const nextDir = next ? [Math.sign(next.to[0] - next.from[0]), Math.sign(next.to[1] - next.from[1])] : null;
      {
        const e0 = prevDir ? -hw : 0, e1 = len + (nextDir ? hw : 0);
        const ax = leg.from[0] + dx * e0, az = leg.from[1] + dz * e0;
        const bx = leg.from[0] + dx * e1, bz = leg.from[1] + dz * e1;
        const w = hw + WALL_T / 2;
        corridorFloors.push({
          minX: Math.min(ax, bx) - (dx ? 0 : w), maxX: Math.max(ax, bx) + (dx ? 0 : w),
          minZ: Math.min(az, bz) - (dz ? 0 : w), maxZ: Math.max(az, bz) + (dz ? 0 : w),
        });
      }
      // side offsets: perpendicular (-dz, dx) and (dz, -dx)
      for (const sgn of [1, -1]) {
        const ox = -dz * sgn, oz = dx * sgn;
        let s0 = 0, s1 = len;
        if (prevDir) s0 += (ox === -prevDir[0] && oz === -prevDir[1]) ? hw : -hw; // inner side shorter
        if (nextDir) s1 += (ox === nextDir[0] && oz === nextDir[1]) ? -hw : hw;
        if (s1 - s0 < 0.01) continue;
        const cx = leg.from[0] + ox * hw, cz = leg.from[1] + oz * hw;
        const ax = cx + dx * s0, az = cz + dz * s0;
        const bx = cx + dx * s1, bz = cz + dz * s1;
        const t = WALL_T / 2;
        walls.push({
          min: [Math.min(ax, bx) - (dx ? 0 : t), 0, Math.min(az, bz) - (dz ? 0 : t)],
          max: [Math.max(ax, bx) + (dx ? 0 : t), CORRIDOR_WALL_H, Math.max(az, bz) + (dz ? 0 : t)],
          kind: "corridor-wall",
          roomId: leg.a === "foyer" ? leg.b : leg.a,
        });
      }
    });
  }

  const colliders = walls.filter((w) => w.kind !== "lintel");
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const r of palace.rooms) {
    minX = Math.min(minX, r.center[0] - r.size[0] / 2);
    maxX = Math.max(maxX, r.center[0] + r.size[0] / 2);
    minZ = Math.min(minZ, r.center[2] - r.size[2] / 2);
    maxZ = Math.max(maxZ, r.center[2] + r.size[2] / 2);
  }
  return { walls, colliders, corridors, corridorFloors, bounds: { minX, maxX, minZ, maxZ } };
}

/** Axis-aligned polyline from door A (outward normal nA) to door B: straight, L or Z. */
function corridorPath(A: [number, number], nA: [number, number], B: [number, number], nB: [number, number]) {
  const pts: [number, number][] = [A];
  const alongX = nA[0] !== 0;
  const eq = (p: number, q: number) => Math.abs(p - q) < 0.05;
  if (alongX ? eq(A[1], B[1]) : eq(A[0], B[0])) {
    // straight
  } else if ((nB[0] !== 0) !== alongX) {
    pts.push(alongX ? [B[0], A[1]] : [A[0], B[1]]); // L
  } else {
    const mid = alongX ? (A[0] + B[0]) / 2 : (A[1] + B[1]) / 2; // Z
    pts.push(alongX ? [mid, A[1]] : [A[0], mid]);
    pts.push(alongX ? [mid, B[1]] : [B[0], mid]);
  }
  pts.push(B);
  const legs: { from: [number, number]; to: [number, number] }[] = [];
  for (let i = 0; i < pts.length - 1; i++) legs.push({ from: pts[i], to: pts[i + 1] });
  return legs;
}

/** Circle (xz, radius) vs boxes: push the circle out of any overlapping box. */
export function resolveCollision(x: number, z: number, radius: number, boxes: Box[], eyeY = 1.6): [number, number] {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const b of boxes) {
      if (b.max[1] < 0.3 || b.min[1] > eyeY) continue;
      const cx = Math.max(b.min[0], Math.min(x, b.max[0]));
      const cz = Math.max(b.min[2], Math.min(z, b.max[2]));
      const dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * radius;
        z = cz + (dz / d) * radius;
      } else {
        // centre inside the box: exit via the nearest face
        const opts = [
          [b.min[0] - radius - x, 0], [b.max[0] + radius - x, 0],
          [0, b.min[2] - radius - z], [0, b.max[2] + radius - z],
        ];
        const best = opts.reduce((p, q) => (Math.abs(p[0] + p[1]) <= Math.abs(q[0] + q[1]) ? p : q));
        x += best[0];
        z += best[1];
      }
      moved = true;
    }
    if (!moved) break;
  }
  return [x, z];
}

/** Voxel cells (integer x/z centres, integer y floors) covered by a box. See the grid note at the top. */
export function boxCells(b: Box): [number, number, number][] {
  const out: [number, number, number][] = [];
  const e = 1e-6;
  for (let x = Math.ceil(b.min[0] - e); x <= Math.floor(b.max[0] + e); x++)
    for (let z = Math.ceil(b.min[2] - e); z <= Math.floor(b.max[2] + e); z++)
      for (let y = Math.floor(b.min[1] + e); y <= Math.ceil(b.max[1] - e) - 1; y++) out.push([x, y, z]);
  return out;
}
