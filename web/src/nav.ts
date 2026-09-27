// OWNED BY: presence. Door-graph navigation: waypoints that go through doors, never through walls.
// Rooms are axis-aligned boxes; doors are gaps in walls; corridors join door pairs in straight lines.
import * as THREE from "three";
import type { Palace, Room, Vec3 } from "../../server/schema";

/** Distance a waypoint is pulled inside a room from its door, so paths cross walls head-on. */
const INSET = 1.2;

export type NavTarget = string | { room: string; point: THREE.Vector3 };

export function roomById(palace: Palace, id: string): Room | undefined {
  return palace.rooms.find((r) => r.id === id);
}

/** The room whose footprint contains p (x/z only), if any. */
export function roomAt(palace: Palace, p: { x: number; z: number }, margin = 0): Room | undefined {
  return palace.rooms.find(
    (r) =>
      Math.abs(p.x - r.center[0]) <= r.size[0] / 2 + margin &&
      Math.abs(p.z - r.center[2]) <= r.size[2] / 2 + margin,
  );
}

/** Unit x/z normal pointing from the door into the room. */
function inward(room: Room, door: Vec3): [number, number] {
  const dx = door[0] - room.center[0];
  const dz = door[2] - room.center[2];
  if (Math.abs(dx) / (room.size[0] / 2) >= Math.abs(dz) / (room.size[2] / 2)) return [-Math.sign(dx) || 1, 0];
  return [0, -Math.sign(dz) || 1];
}

/** A point `d` meters inside (d > 0) or outside (d < 0) the room from a door. */
export function doorPoint(room: Room, door: Vec3, d: number, y: number): THREE.Vector3 {
  const [nx, nz] = inward(room, door);
  return new THREE.Vector3(door[0] + nx * d, y, door[2] + nz * d);
}

/** Shortest room sequence over the door graph (BFS), inclusive of both ends; null if unreachable. */
export function roomPath(palace: Palace, from: string, to: string): string[] | null {
  if (from === to) return [from];
  const prev = new Map<string, string>([[from, from]]);
  const queue = [from];
  while (queue.length) {
    const id = queue.shift()!;
    const room = roomById(palace, id);
    if (!room) continue;
    // doors are listed on both sides, but tolerate one-sided listings too
    const next = new Set(room.doors.map((d) => d.to));
    for (const r of palace.rooms) if (r.doors.some((d) => d.to === id)) next.add(r.id);
    for (const n of next) {
      if (prev.has(n)) continue;
      prev.set(n, id);
      if (n === to) {
        const out = [to];
        let cur = to;
        while (cur !== from) out.unshift((cur = prev.get(cur)!));
        return out;
      }
      queue.push(n);
    }
  }
  return null;
}

function resolveTarget(palace: Palace, to: NavTarget, y: number): { room?: Room; point: THREE.Vector3 } | null {
  if (typeof to !== "string") return { room: roomById(palace, to.room), point: to.point.clone() };
  const room = roomById(palace, to);
  if (room) return { room, point: new THREE.Vector3(room.center[0], y, room.center[2]) };
  const mem = palace.memories.find((m) => m.id === to);
  if (mem) return { room: roomById(palace, mem.room), point: new THREE.Vector3(...mem.pos) };
  return null;
}

/**
 * Waypoints from `from` to a room id, memory id, or {room, point}: room → door → partner door → … → target.
 * The start point is not included; the last waypoint is the target. Intermediate waypoints sit at height
 * `opts.y` (default from.y). `stopAtDoor` ends just outside the target room's door instead of entering.
 */
export function pathBetween(
  palace: Palace,
  from: THREE.Vector3,
  to: NavTarget,
  opts: { y?: number; stopAtDoor?: boolean } = {},
): THREE.Vector3[] {
  const y = opts.y ?? from.y;
  const target = resolveTarget(palace, to, y);
  if (!target) return [];
  const out: THREE.Vector3[] = [];

  let start = roomAt(palace, from);
  if (!start) {
    // In a corridor or outside: enter through the nearest door first.
    let best: { room: Room; pos: Vec3; d: number } | undefined;
    for (const r of palace.rooms)
      for (const d of r.doors) {
        const dist = Math.hypot(d.pos[0] - from.x, d.pos[2] - from.z);
        if (!best || dist < best.d) best = { room: r, pos: d.pos, d: dist };
      }
    if (best) {
      out.push(new THREE.Vector3(best.pos[0], y, best.pos[2]), doorPoint(best.room, best.pos, INSET, y));
      start = best.room;
    }
  }

  const rooms = start && target.room ? roomPath(palace, start.id, target.room.id) : null;
  if (rooms) {
    for (let i = 0; i < rooms.length - 1; i++) {
      const a = roomById(palace, rooms[i])!;
      const b = roomById(palace, rooms[i + 1])!;
      const da = a.doors.find((d) => d.to === b.id)?.pos;
      const db = b.doors.find((d) => d.to === a.id)?.pos ?? da;
      const dA = da ?? db!;
      const last = i === rooms.length - 2;
      out.push(doorPoint(a, dA, INSET, y), new THREE.Vector3(dA[0], y, dA[2]));
      if (last && opts.stopAtDoor) {
        out.push(doorPoint(b, db!, -0.8, y));
        return dedupe(out);
      }
      out.push(new THREE.Vector3(db![0], y, db![2]), doorPoint(b, db!, INSET, y));
    }
  }
  out.push(target.point);
  return dedupe(out);
}

function dedupe(pts: THREE.Vector3[]): THREE.Vector3[] {
  return pts.filter((p, i) => i === 0 || p.distanceTo(pts[i - 1]) > 0.05);
}

/** Total length of a polyline starting at `from`. */
export function pathLength(from: THREE.Vector3, pts: THREE.Vector3[]): number {
  let len = 0;
  let prev = from;
  for (const p of pts) (len += prev.distanceTo(p)), (prev = p);
  return len;
}
