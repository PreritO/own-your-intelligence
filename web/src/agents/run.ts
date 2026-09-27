// OWNED BY: presence. Shared helpers for renderers of rt.events: run boundaries and plain-word names.
import type { Palace, PalaceEvent } from "../../../server/schema";
import type { PalaceRuntime } from "../api";

/**
 * Subscribe to rt.events, calling `reset` whenever a new run starts: the run id changes, or t jumps
 * backwards (a replay restarted, or the bridge dispatched a fresh run). Pure function of the stream,
 * so ?demo and live behave the same.
 */
export function subscribeRuns(rt: PalaceRuntime, reset: () => void, onEvent: (e: PalaceEvent) => void) {
  let lastT = -1;
  let run: string | undefined;
  return rt.events.subscribe((e) => {
    if (e.type === "train_step") return onEvent(e); // training ticks have their own clock
    const newRun = (e.run !== undefined && run !== undefined && e.run !== run) || e.t + 0.25 < lastT;
    if (newRun) reset();
    lastT = e.t;
    if (e.run !== undefined) run = e.run;
    onEvent(e);
  });
}

export const PRESENCE_EVENTS = {
  camera: "presence:camera", // detail: { mode: "free" | "overhead" | agentId }
  mode: "presence:mode", // detail: { mode, label }  (presence → ui, for the HUD)
  dispatch: "presence:dispatch", // detail: {}  (ui button → presence)
  status: "presence:status", // detail: { text, tone }  (toast line)
} as const;

export function names(palace: Palace) {
  const agents = new Map(palace.agents.map((a) => [a.id, a]));
  const mems = new Map(palace.memories.map((m) => [m.id, m]));
  const rooms = new Map(palace.rooms.map((r) => [r.id, r]));
  const title = (a: string) => a.charAt(0).toUpperCase() + a.slice(1);
  return {
    agent: (id: string) => agents.get(id)?.label.replace(/\s+agent$/i, "") ?? title(id),
    color: (id: string) => agents.get(id)?.color ?? "#c0caf5",
    memory: (id: string) => mems.get(id)?.title ?? id,
    room: (id: string) => rooms.get(id)?.label ?? id,
    agents,
    mems,
    rooms,
  };
}
export type Names = ReturnType<typeof names>;
