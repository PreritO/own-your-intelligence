// Deterministic palace layout: foyer at the origin, four wings radiating N/E/S/W,
// rooms of at most 12 memories, pedestals on a ring that keeps clear of doors.
// Pure: no I/O, no randomness, no clock. Same input -> same output.
import type { Room, Vec3, Wing } from "./schema";

export type WingId = "people" | "legal" | "finance" | "eng" | "marketing" | "sales" | "ops" | "support";

export const ROOM_SIZE: Vec3 = [12, 4, 12];
export const FIRST_ROOM_DIST = 20; // foyer center -> first room center, meters
export const ROOM_STEP = 14; // each overflow room sits this much further out
export const MAX_PER_ROOM = 12;
export const PEDESTAL_Y = 1.1;
export const RING_RADIUS = 3.8; // 2.2 m clear of the side walls
export const DOOR_CLEARANCE_DEG = 30; // no pedestal within ±30° of a door direction

export const WINGS: readonly {
  id: WingId; label: string; color: string; owner: Wing["owner"]; dir: [number, number];
  /** continues outward along the same axis after this wing's last room */
  after?: WingId;
}[] = [
  { id: "people", label: "People", color: "#7aa2f7", owner: "shared", dir: [0, -1] }, // N (-z)
  { id: "legal", label: "Legal", color: "#bb9af7", owner: "legal", dir: [1, 0] }, // E (+x)
  { id: "finance", label: "Finance", color: "#e0af68", owner: "finance", dir: [0, 1] }, // S (+z)
  { id: "eng", label: "Eng", color: "#9ece6a", owner: "eng", dir: [-1, 0] }, // W (-x)
  // Outer departments continue each axis past the inner wing.
  { id: "marketing", label: "Marketing", color: "#f7768e", owner: "marketing", dir: [0, -1], after: "people" },
  { id: "sales", label: "Sales", color: "#2ac3de", owner: "sales", dir: [1, 0], after: "legal" },
  { id: "ops", label: "Ops", color: "#ff9e64", owner: "ops", dir: [0, 1], after: "finance" },
  { id: "support", label: "Support", color: "#73daca", owner: "support", dir: [-1, 0], after: "eng" },
];

export interface LayoutPage {
  id: string;
  wing: WingId;
  type: string;
  /** optional room label from the page's `room:` frontmatter; pages sharing it cluster together */
  group?: string;
}

export interface LayoutOptions {
  /** memory id -> room id it must live in (e.g. derived from the demo replay). */
  pins?: Map<string, string>;
  /** minimum number of rooms per wing (so replay/route room ids always exist). */
  minRooms?: Partial<Record<WingId, number>>;
}

export interface LayoutResult {
  wings: Wing[];
  rooms: Room[];
  placement: Map<string, { room: string; pos: Vec3 }>;
  warnings: string[];
}

const r2 = (n: number) => {
  const v = Math.round(n * 100) / 100;
  return Object.is(v, -0) ? 0 : v;
};
const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byId = (a: { id: string }, b: { id: string }) => cmpStr(a.id, b.id);
export const roomId = (wing: string, i: number) => `room-${wing}-${i}`;

export const COMMONS: readonly { id: string; label: string; center: Vec3; from: string; fromDoor: Vec3; door: Vec3 }[] = [
  { id: "room-gym", label: "The Gym", center: [24, 0, 24], from: "room-finance-0", fromDoor: [6, 0, 20], door: [17, 0, 20] },
  { id: "room-workshop", label: "The Workshop", center: [24, 0, -24], from: "room-legal-0", fromDoor: [20, 0, -6], door: [20, 0, -17] },
  { id: "room-loose-ends", label: "Loose Ends", center: [-24, 0, -24], from: "room-eng-0", fromDoor: [-20, 0, -6], door: [-20, 0, -17] },
];

export function layout(pagesIn: LayoutPage[], opts: LayoutOptions = {}): LayoutResult {
  const warnings: string[] = [];
  const pins = opts.pins ?? new Map<string, string>();
  const pages = [...pagesIn].sort(byId);

  const foyer: Room = {
    id: "foyer", wing: "foyer", owner: "shared", label: "Foyer",
    center: [0, 0, 0], size: [...ROOM_SIZE], doors: [],
  };
  const rooms: Room[] = [foyer];
  const wings: Wing[] = [];
  const members = new Map<string, LayoutPage[]>(); // room id -> pages
  const lastRoom = new Map<string, { id: string; dist: number }>(); // wing -> outermost room

  for (const w of WINGS) {
    const wingPages = pages.filter((p) => p.wing === w.id);
    const n = wingPages.length;

    // Which room index is each pinned page asking for?
    const pinnedIdx = new Map<string, number>();
    for (const p of wingPages) {
      const want = pins.get(p.id);
      if (!want) continue;
      const m = /^room-([a-z]+)-(\d+)$/.exec(want);
      if (!m || m[1] !== w.id) {
        warnings.push(`pin ${p.id} -> ${want} ignored (not a ${w.id} room)`);
        continue;
      }
      pinnedIdx.set(p.id, Number(m[2]));
    }

    let count = Math.max(1, Math.ceil(n / MAX_PER_ROOM), opts.minRooms?.[w.id] ?? 0);
    for (const i of pinnedIdx.values()) count = Math.max(count, i + 1);
    const buckets: LayoutPage[][] = Array.from({ length: count }, () => []);

    for (const p of wingPages) {
      const i = pinnedIdx.get(p.id);
      if (i === undefined) continue;
      if (buckets[i].length >= MAX_PER_ROOM) {
        warnings.push(`pin ${p.id} -> ${roomId(w.id, i)} dropped (room full)`);
        pinnedIdx.delete(p.id);
        continue;
      }
      buckets[i].push(p);
    }

    // Unpinned pages fill rooms balanced across the wing's rooms, clustered by `room:` group.
    // Groups go in the order of the lowest room their pinned members need, then by name.
    const groupRank = new Map<string, number>();
    for (const [id, i] of pinnedIdx) {
      const g = wingPages.find((p) => p.id === id)!.group ?? "";
      groupRank.set(g, Math.min(groupRank.get(g) ?? Infinity, i));
    }
    const gkey = (p: LayoutPage) => groupRank.get(p.group ?? "") ?? Infinity;
    const rest = wingPages
      .filter((p) => !pinnedIdx.has(p.id))
      .sort((a, b) => gkey(a) - gkey(b) || cmpStr(a.group ?? "￿", b.group ?? "￿") || cmpStr(a.id, b.id));
    const cap = Math.min(MAX_PER_ROOM, Math.ceil(n / count));
    let k = 0;
    for (const limit of [cap, MAX_PER_ROOM]) {
      for (const b of buckets) while (k < rest.length && b.length < limit) b.push(rest[k++]);
    }
    while (k < rest.length) buckets.push(rest.slice(k, (k += MAX_PER_ROOM)));

    const ids: string[] = [];
    const labels = new Map<string, number>();
    buckets.forEach((bucket, i) => {
      const start = w.after ? lastRoom.get(w.after)!.dist + ROOM_STEP : FIRST_ROOM_DIST;
      const dist = start + i * ROOM_STEP;
      const center: Vec3 = [r2(w.dir[0] * dist), 0, r2(w.dir[1] * dist)];
      const id = roomId(w.id, i);
      const prevId = i > 0 ? roomId(w.id, i - 1) : w.after ? lastRoom.get(w.after)!.id : "foyer";
      lastRoom.set(w.id, { id, dist });
      const prev = rooms.find((x) => x.id === prevId)!;
      // Doors on both ends of the corridor joining prev and this room.
      prev.doors.push({ to: id, pos: [r2(prev.center[0] + w.dir[0] * 6), 0, r2(prev.center[2] + w.dir[1] * 6)] });
      const base = roomLabel(bucket, w.label);
      const seen = (labels.get(base) ?? 0) + 1;
      labels.set(base, seen);
      rooms.push({
        id, wing: w.id, owner: w.owner,
        label: seen === 1 ? base : `${base} ${roman(seen)}`,
        center, size: [...ROOM_SIZE],
        doors: [{ to: prevId, pos: [r2(center[0] - w.dir[0] * 6), 0, r2(center[2] - w.dir[1] * 6)] }],
      });
      members.set(id, [...bucket].sort(byId));
      ids.push(id);
    });
    wings.push({
      id: w.id, label: w.label, color: w.color, owner: w.owner,
      origin: rooms.find((x) => x.id === ids[0])!.center, rooms: ids,
    });
  }

  // Commons: special rooms in the diagonal corners, each joined to a first wing room
  // by a straight corridor so agents can walk there (Gym, Workshop, Loose Ends).
  for (const c of COMMONS) {
    const from = rooms.find((x) => x.id === c.from);
    if (!from) continue;
    from.doors.push({ to: c.id, pos: c.fromDoor });
    rooms.push({
      id: c.id, wing: "commons", owner: "shared", label: c.label,
      center: c.center, size: [14, 4, 14], doors: [{ to: c.from, pos: c.door }],
    });
  }

  const placement = new Map<string, { room: string; pos: Vec3 }>();
  for (const room of rooms) {
    const list = members.get(room.id) ?? [];
    ringSlots(room, list.length).forEach((pos, i) => placement.set(list[i].id, { room: room.id, pos }));
  }
  return { wings, rooms, placement, warnings };
}

/**
 * n pedestal positions on a ring around the room center, spread evenly over the
 * arcs that stay at least DOOR_CLEARANCE_DEG away from every wall axis that has
 * (or could get) a door. Wing rooms always reserve both ends of their axis so an
 * overflow room added later never moves existing pedestals.
 */
export function ringSlots(room: Room, n: number): Vec3[] {
  if (n === 0) return [];
  const [cx, , cz] = room.center;
  const doorAngles = new Set<number>();
  const axis = room.wing === "foyer" ? null : WINGS.find((w) => w.id === room.wing)?.dir;
  if (axis) {
    const a = Math.atan2(axis[1], axis[0]);
    doorAngles.add(a).add(a + Math.PI);
  }
  for (const d of room.doors) doorAngles.add(Math.atan2(d.pos[2] - cz, d.pos[0] - cx));
  const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const doors = [...new Set([...doorAngles].map((a) => r2(norm(a) * 1000) / 1000))].sort((a, b) => a - b);
  const clear = (DOOR_CLEARANCE_DEG * Math.PI) / 180;

  // Allowed arcs between consecutive door exclusions.
  const arcs: [number, number][] = [];
  if (doors.length === 0) arcs.push([0, 2 * Math.PI]);
  else doors.forEach((d, i) => {
    const next = i + 1 < doors.length ? doors[i + 1] : doors[0] + 2 * Math.PI;
    if (next - d > 2 * clear) arcs.push([d + clear, next - clear]);
  });
  const total = arcs.reduce((s, [a, b]) => s + (b - a), 0);
  const step = total / n;
  const out: Vec3[] = [];
  for (let k = 0; k < n; k++) {
    let t = (k + 0.5) * step;
    for (const [a, b] of arcs) {
      if (t <= b - a + 1e-9) {
        const ang = a + t;
        out.push([r2(cx + Math.cos(ang) * RING_RADIUS), PEDESTAL_Y, r2(cz + Math.sin(ang) * RING_RADIUS)]);
        break;
      }
      t -= b - a;
    }
  }
  return out;
}

const PLURAL: Record<string, string> = {
  person: "People", company: "Companies", policy: "Policies", reference: "References",
  meeting: "Meetings", budget: "Budgets", contract: "Contracts", log: "Logs", role: "Roles",
  project: "Projects", memo: "Memos", process: "Processes", plan: "Plans", page: "Pages",
};
function plural(type: string): string {
  if (PLURAL[type]) return PLURAL[type];
  const t = type.replace(/[-_]+/g, " ").trim();
  const cap = t.charAt(0).toUpperCase() + t.slice(1);
  if (/[^aeiou]y$/.test(cap)) return cap.slice(0, -1) + "ies";
  if (/(s|x|ch|sh)$/.test(cap)) return cap + "es";
  return cap + "s";
}

/** Majority `room:` label; else "Contracts", or "People & Companies" when no single type dominates. */
function roomLabel(pages: LayoutPage[], fallback: string): string {
  if (pages.length === 0) return fallback;
  const groups = new Map<string, number>();
  for (const p of pages) if (p.group) groups.set(p.group, (groups.get(p.group) ?? 0) + 1);
  const g = [...groups].sort((a, b) => b[1] - a[1] || cmpStr(a[0], b[0]))[0];
  if (g) return g[0];
  const counts = new Map<string, number>();
  for (const p of pages) counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const [top, second] = ranked;
  if (!second || top[1] / pages.length >= 0.6) return plural(top[0]);
  return `${plural(top[0])} & ${plural(second[0])}`;
}

function roman(n: number): string {
  return ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][n] ?? String(n);
}
