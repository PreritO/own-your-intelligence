// FROZEN data contracts for Mind Palace. Changing a shape needs integrator sign-off
// (propose in NOTES-<workspace>.md). The browser imports these types too.
import { z } from "zod";

export const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
export const Team = z.enum(["finance", "legal", "eng", "people", "marketing", "sales", "ops", "support"]);
export const Owner = z.enum(["finance", "legal", "eng", "marketing", "sales", "ops", "support", "shared"]);
export const Verdict = z.enum(["verified", "stale", "gap"]);

export const Wing = z.object({
  id: z.string(),
  label: z.string(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  owner: Owner,
  origin: Vec3,
  rooms: z.array(z.string()),
});

export const Door = z.object({ to: z.string(), pos: Vec3 });

export const Room = z.object({
  id: z.string(),
  wing: z.string(), // a wing id, or "foyer"
  owner: Owner,
  label: z.string(),
  center: Vec3,
  size: Vec3, // [width x, height y, depth z], axis-aligned
  doors: z.array(Door),
});

export const Memory = z.object({
  id: z.string(), // GBrain page slug. The only key.
  title: z.string(),
  type: z.string(),
  room: z.string(),
  pos: Vec3,
  freshness: z.number().min(0).max(1),
  excerpt: z.string(),
  path: z.string(),
});

export const Link = z.object({ from: z.string(), to: z.string(), kind: z.string() });

export const Agent = z.object({
  id: z.string(),
  label: z.string(),
  team: Team,
  color: z.string(),
  home: z.string(),
});

export const Route = z.object({
  id: z.string(),
  label: z.string(),
  stations: z.array(z.string()).min(1),
});

export const Palace = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  wings: z.array(Wing),
  rooms: z.array(Room),
  memories: z.array(Memory),
  links: z.array(Link),
  agents: z.array(Agent).default([]),
  routes: z.array(Route).default([]),
});

export const Hop = z.object({
  step: z.number().int().positive(),
  memoryId: z.string(),
  reason: z.string(),
  score: z.number(),
});

export const Trace = z.object({
  question: z.string(),
  hops: z.array(Hop).min(1),
  answerMemoryIds: z.array(z.string()),
  answer: z.string(),
});

// One line of GET /events and of fixtures/replays/*.jsonl. t = seconds since dispatch.
const base = { t: z.number().nonnegative(), agent: z.string(), run: z.string().optional() };
export const PalaceEvent = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("task"), text: z.string() }),
  z.object({ ...base, type: z.literal("route"), routeId: z.string(), stations: z.array(z.string()), source: z.enum(["learned", "explore", "fallback"]) }),
  z.object({ ...base, type: z.literal("move"), to: z.string() }), // a room id
  z.object({ ...base, type: z.literal("claim"), memoryId: z.string() }),
  z.object({ ...base, type: z.literal("wait"), memoryId: z.string(), heldBy: z.string() }),
  z.object({ ...base, type: z.literal("visit"), memoryId: z.string(), verdict: Verdict, note: z.string().optional(), evidence: z.string().optional(), subtask: z.string().optional() }),
  z.object({ ...base, type: z.literal("handoff"), id: z.string(), toAgent: z.string(), memoryId: z.string(), question: z.string() }),
  z.object({ ...base, type: z.literal("reply"), id: z.string(), answer: z.string() }),
  z.object({ ...base, type: z.literal("answer"), text: z.string(), citations: z.array(z.string()), gaps: z.array(z.string()).optional(), stale: z.array(z.string()).optional(), blocked: z.boolean().optional() }),
  z.object({ ...base, type: z.literal("train_step"), team: Team.optional(), step: z.number(), reward: z.number(), checkpoint: z.string().optional() }),
  // Commissioned agents: a user-specified task spawns a new agent that tours departments,
  // trains in the Gym, returns to execute, and reports completion.
  z.object({ ...base, type: z.literal("spawn"), label: z.string(), color: z.string(), home: z.string(), task: z.string().optional(), harness: z.enum(["qm", "ufo", "protocol"]).optional() }),
  z.object({ ...base, type: z.literal("phase"), phase: z.enum(["plan", "explore", "gym", "execute", "done"]), note: z.string().optional(),
    // plan phase: the task breakdown (Memorable-style task flow). visit.subtask refers to Subtask.id.
    subtasks: z.array(z.object({ id: z.string(), title: z.string(), department: z.string().optional(), stations: z.array(z.string()).optional() })).optional() }),
  z.object({ ...base, type: z.literal("artifact"), memory: Memory }), // a page the agent wrote; renderer adds a lectern
]);

export type Vec3 = z.infer<typeof Vec3>;
export type Verdict = z.infer<typeof Verdict>;
export type Wing = z.infer<typeof Wing>;
export type Room = z.infer<typeof Room>;
export type Memory = z.infer<typeof Memory>;
export type Link = z.infer<typeof Link>;
export type Agent = z.infer<typeof Agent>;
export type Route = z.infer<typeof Route>;
export type Palace = z.infer<typeof Palace>;
export type Trace = z.infer<typeof Trace>;
export type PalaceEvent = z.infer<typeof PalaceEvent>;

export const PORTS = { web: 5173, ask: 8787, bridge: 8788, protocol: 8790 } as const;
