// INTEGRATOR-OWNED. One source of PalaceEvents: ?demo[=name] replays fixtures/replays/<name>.jsonl,
// otherwise the bridge's SSE stream at :8788/events. Renderers must be pure functions of this stream.
import { PalaceEvent, PORTS, type PalaceEvent as Ev } from "../../server/schema";

export interface EventStream {
  subscribe(cb: (e: Ev) => void): () => void;
  /** Replay speed multiplier (demo only). */
  speed: number;
  /** Restart a replay from t=0 (demo only). */
  restart(name?: string): void;
  readonly mode: "demo" | "live";
}

export function createEventStream(): EventStream {
  const subs = new Set<(e: Ev) => void>();
  const emit = (e: Ev) => subs.forEach((cb) => cb(e));
  const params = new URLSearchParams(location.search);
  const demo = params.has("demo");
  let timers: number[] = [];

  const stream: EventStream = {
    subscribe(cb) { subs.add(cb); return () => subs.delete(cb); },
    speed: Number(params.get("speed") ?? 1),
    mode: demo ? "demo" : "live",
    async restart(name = params.get("demo") || "demo-1") {
      timers.forEach(clearTimeout);
      timers = [];
      const text = await (await fetch(`/replays/${name}.jsonl`)).text();
      for (const line of text.split("\n").filter(Boolean)) {
        const e = PalaceEvent.parse(JSON.parse(line));
        timers.push(window.setTimeout(() => emit(e), (e.t * 1000) / stream.speed));
      }
    },
  };

  if (!demo) {
    const src = new EventSource(`http://localhost:${PORTS.bridge}/events`);
    src.onmessage = (m) => {
      const e = PalaceEvent.safeParse(JSON.parse(m.data));
      if (e.success) emit(e.data);
    };
  }
  return stream;
}
