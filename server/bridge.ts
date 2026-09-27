// Bridge: harness activity -> GET /events (SSE) for the palace. Bun, port 8788.
//
//   bun run bridge                                  # or: bun server/bridge.ts
//   curl -N localhost:8788/events                   # watch
//   curl -XPOST 'localhost:8788/dispatch?replay=demo-1&speed=2'   # canned replay, real timing / speed
//   curl -XPOST  localhost:8788/dispatch            # live: 3 demo tasks via the protocol service (:8790)
//
// Endpoints (all CORS *):
//   GET  /events[?catchup=0]       SSE, one `data: <PalaceEvent JSON>` per event. New subscribers get the
//                                  active run's events so far unless catchup=0. Named SSE events `run`
//                                  (start) and `end` carry {run, mode, file}; `onmessage` never sees them.
//   POST /dispatch?replay=<name>[&speed=<n>]   stream fixtures/replays/<name>.jsonl with its own timing / n
//   POST /dispatch[?fallback=0]    live: open a run, ask the protocol service to start the demo tasks and
//                                  proxy its /events. Protocol down -> falls back to replay demo-1 (unless
//                                  fallback=0). Optional JSON body {tasks:[{agent,text}]}.
//   GET  /dispatch?...             same as POST (for browsers)
//   POST /stop                     end the active run
//   GET  /route?task=<text>        pick a route (server/routes.ts): learned -> fallback -> explore
//   POST /route/record             {task, stations[], routeId?} -> fixtures/learned-routes.json (+ Memorable)
//   GET  /runs                     saved replays;  GET /health  bridge + upstream status
//
// The bridge also keeps a background subscription to the protocol service's GET /events, so events any
// harness (QM fork or UFO extension) drives through :8790 reach the palace, even without /dispatch.
// Every run is saved to fixtures/replays/run-<timestamp>.jsonl (SAVE_RUNS=0 to disable).
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { PalaceEvent, PORTS } from "./schema";
import { loadPalace, pickRoute, recordRoute } from "./routes";

const PORT = Number(process.env.BRIDGE_PORT ?? PORTS.bridge);
const PROTOCOL_URL = (process.env.PROTOCOL_URL ?? `http://localhost:${PORTS.protocol}`).replace(/\/$/, "");
const REPLAY_DIR = process.env.REPLAY_DIR ?? "fixtures/replays";
const SAVE_RUNS = process.env.SAVE_RUNS !== "0";
const LIVE_IDLE_MS = Number(process.env.LIVE_IDLE_MS ?? 15000); // live run ends after this much silence
const DEFAULT_REPLAY = process.env.DEFAULT_REPLAY ?? "demo-1";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2) + "\n", { status, headers: { ...CORS, "content-type": "application/json" } });

type Mode = "replay" | "live";
type Run = {
  id: string;
  mode: Mode;
  source: string; // replay name or protocol url
  startedAt: number;
  events: PalaceEvent[];
  file: string | null;
  lastT: number;
  learn: boolean;
  done: boolean;
  idle?: ReturnType<typeof setTimeout>;
};

let run: Run | null = null;
const subscribers = new Set<ReadableStreamDefaultController<Uint8Array>>();
const enc = new TextEncoder();
const upstream = { connected: false, lastError: "", events: 0 };

// ---------------------------------------------------------------------------------------------- SSE

function send(c: ReadableStreamDefaultController<Uint8Array>, chunk: string) {
  try {
    c.enqueue(enc.encode(chunk));
  } catch {
    subscribers.delete(c);
  }
}
function sendAll(chunk: string) {
  for (const c of subscribers) send(c, chunk);
}
const sse = (data: unknown, event?: string) => `${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(data)}\n\n`;

function eventsResponse(url: URL): Response {
  let ctrl: ReadableStreamDefaultController<Uint8Array>;
  let ping: ReturnType<typeof setInterval>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
      subscribers.add(c);
      send(c, `retry: 1000\n: mind-palace bridge\n\n`);
      if (run && !run.done && url.searchParams.get("catchup") !== "0") {
        send(c, sse(runInfo(run), "run"));
        for (const e of run.events) send(c, sse(e));
      }
      ping = setInterval(() => send(c, `: ping\n\n`), 15000);
    },
    cancel() {
      clearInterval(ping);
      subscribers.delete(ctrl);
    },
  });
  return new Response(stream, {
    headers: { ...CORS, "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
  });
}

// ---------------------------------------------------------------------------------------------- runs

const runInfo = (r: Run) => ({ run: r.id, mode: r.mode, source: r.source, file: r.file, events: r.events.length });

function startRun(mode: Mode, source: string, learn = mode === "live"): Run {
  if (run && !run.done) endRun("superseded");
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
  const id = `run-${ts}`;
  run = { id, mode, source, startedAt: performance.now(), events: [], file: SAVE_RUNS ? `${REPLAY_DIR}/${id}.jsonl` : null, lastT: 0, learn, done: false };
  sendAll(sse(runInfo(run), "run"));
  console.log(`▶ ${id} (${mode}: ${source})`);
  return run;
}

function endRun(reason: string) {
  const r = run;
  if (!r || r.done) return;
  r.done = true;
  clearTimeout(r.idle);
  sendAll(sse({ ...runInfo(r), reason }, "end"));
  console.log(`■ ${r.id} ended (${reason}): ${r.events.length} events${r.file && r.events.length ? ` -> ${r.file}` : ""}`);
  if (r.learn) learnFromRun(r).catch((e) => console.warn("learn failed:", e));
}

// Stamp, clamp and fan out one event. t stays the harness's logical seconds-since-dispatch; if it is
// missing or goes backwards we fall back to wall clock / last t so replays stay monotonic.
function emit(r: Run, raw: unknown): boolean {
  if (r.done || r !== run) return false;
  const obj = { ...(raw as Record<string, unknown>) };
  if (typeof obj.t !== "number") obj.t = (performance.now() - r.startedAt) / 1000;
  obj.t = Math.max(r.lastT, Math.round((obj.t as number) * 1000) / 1000);
  obj.run = r.id;
  const parsed = PalaceEvent.safeParse(obj);
  if (!parsed.success) {
    console.warn(`✗ dropped invalid event: ${parsed.error.issues[0]?.message} ${JSON.stringify(raw).slice(0, 160)}`);
    return false;
  }
  const ev = parsed.data;
  r.lastT = ev.t;
  r.events.push(ev);
  if (r.file) appendFileSync(r.file, JSON.stringify(ev) + "\n");
  sendAll(sse(ev));
  return true;
}

// After a live run, each agent whose answer wasn't blocked records its path as a learned route for its
// task. A fallback/learned route is recorded as walked (gap stations stay: the checklist must keep
// surfacing them). An explore route keeps only what paid off: its own non-gap visits plus stations it
// handed off, in order, minus visits it made to answer someone else's handoff. Run 1 wanders, run 2
// walks the clean path.
async function learnFromRun(r: Run) {
  const agents = new Set(r.events.map((e) => e.agent));
  for (const agent of agents) {
    const mine = r.events.filter((e) => e.agent === agent);
    const task = mine.find((e) => e.type === "task");
    const answer = [...mine].reverse().find((e) => e.type === "answer");
    const route = mine.find((e) => e.type === "route");
    if (!task || task.type !== "task" || !answer || answer.type !== "answer" || answer.blocked) continue;
    let stations: string[] = [];
    if (route?.type === "route" && route.source !== "explore") stations = route.stations;
    else {
      const forOthers = new Set(r.events.flatMap((e) => (e.type === "handoff" && e.toAgent === agent ? [e.memoryId] : [])));
      for (const e of mine) {
        const id = e.type === "handoff" ? e.memoryId : e.type === "visit" && e.verdict !== "gap" && !forOthers.has(e.memoryId) ? e.memoryId : null;
        if (id && !stations.includes(id)) stations.push(id);
      }
    }
    if (!stations.length) continue;
    const routeId = route?.type === "route" && route.source !== "explore" ? route.routeId : undefined;
    const saved = await recordRoute(task.text, stations, routeId);
    console.log(`  learned ${saved.routeId} (${agent}, uses=${saved.uses}): ${stations.join(" > ")}`);
  }
}

// ---------------------------------------------------------------------------------------------- replay

function readReplay(name: string): PalaceEvent[] {
  if (!/^[\w.-]+$/.test(name)) throw new Error(`bad replay name ${name}`);
  const file = `${REPLAY_DIR}/${name.replace(/\.jsonl$/, "")}.jsonl`;
  if (!existsSync(file)) throw new Error(`no such replay ${file}`);
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => PalaceEvent.parse(JSON.parse(l)))
    .map(({ run: _drop, ...e }) => e as PalaceEvent);
}

async function playReplay(r: Run, events: PalaceEvent[], speed: number) {
  const t0 = performance.now();
  for (const e of events) {
    const due = t0 + (e.t / speed) * 1000;
    const wait = due - performance.now();
    if (wait > 0) await Bun.sleep(wait);
    if (!emit(r, e)) return; // superseded or stopped
  }
  endRun("complete");
}

// ---------------------------------------------------------------------------------------------- live

const DEMO_AGENTS = ["legal", "finance", "eng"];
function demoTasks(): { agent: string; text: string }[] {
  try {
    const tasks = readReplay(DEFAULT_REPLAY).filter((e) => e.type === "task") as Extract<PalaceEvent, { type: "task" }>[];
    if (tasks.length) return tasks.map((t) => ({ agent: t.agent, text: t.text }));
  } catch {}
  return [
    { agent: "legal", text: "Can we sign the Gripworks contract this week?" },
    { agent: "finance", text: "What did we promise Ada in the last board meeting?" },
    { agent: "eng", text: "Who owns the SOC 2 renewal?" },
  ].filter((t) => DEMO_AGENTS.includes(t.agent));
}

// Ask the protocol service to run the tasks. Its dispatch endpoint isn't frozen, so try the likely
// shapes, then the harness-free driver (server/protocol/demo_run.py) as a last resort.
async function startProtocolRun(tasks: { agent: string; text: string }[]): Promise<string> {
  let palace: ReturnType<typeof loadPalace> | undefined;
  try {
    palace = loadPalace();
  } catch {}
  const withRoutes = tasks.map((t) => ({ ...t, route: palace ? pickRoute(t.text, palace) : undefined }));
  for (const path of ["/dispatch", "/run", "/runs"]) {
    try {
      const res = await fetch(PROTOCOL_URL + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tasks: withRoutes }),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) return `POST ${PROTOCOL_URL}${path}`;
    } catch {}
  }
  if (existsSync("server/protocol/demo_run.py")) {
    Bun.spawn(["uv", "run", "python", "server/protocol/demo_run.py"], {
      env: { ...process.env, PROTOCOL_URL },
      stdout: "inherit",
      stderr: "inherit",
    });
    return "spawned server/protocol/demo_run.py";
  }
  return "no dispatch endpoint; waiting for a harness to drive :8790";
}

async function protocolUp(): Promise<boolean> {
  if (upstream.connected) return true;
  for (const path of ["/health", "/events"]) {
    try {
      const ac = new AbortController();
      const res = await fetch(PROTOCOL_URL + path, { signal: AbortSignal.any([ac.signal, AbortSignal.timeout(1500)]) });
      ac.abort();
      if (res.status < 500) return true;
    } catch {}
  }
  return false;
}

// Background subscription to the protocol service's SSE (also accepts NDJSON). Reconnects forever.
async function followUpstream() {
  for (;;) {
    try {
      const res = await fetch(`${PROTOCOL_URL}/events`, { headers: { accept: "text/event-stream" } });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      upstream.connected = true;
      upstream.lastError = "";
      console.log(`⇄ following ${PROTOCOL_URL}/events`);
      let buf = "";
      let upstreamRun: string | undefined;
      const dec = new TextDecoder();
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          const payload = line.startsWith("data:") ? line.slice(5).trim() : line.startsWith("{") ? line : "";
          if (!payload) continue;
          let obj: Record<string, unknown>;
          try {
            obj = JSON.parse(payload);
          } catch {
            continue;
          }
          if (typeof obj.type !== "string" || typeof obj.agent !== "string") continue; // hello/keepalive frames
          upstream.events++;
          onUpstreamEvent(obj, upstreamRun, (id) => (upstreamRun = id));
        }
      }
      throw new Error("stream closed");
    } catch (e) {
      if (upstream.connected) console.log(`⇄ lost ${PROTOCOL_URL}/events: ${(e as Error).message}`);
      upstream.connected = false;
      upstream.lastError = (e as Error).message;
      await Bun.sleep(2000);
    }
  }
}

function onUpstreamEvent(obj: Record<string, unknown>, upstreamRun: string | undefined, setRun: (id?: string) => void) {
  if (run && !run.done && run.mode === "replay") return; // a canned replay owns the stream right now
  const newUpstreamRun = typeof obj.run === "string" && obj.run !== upstreamRun;
  const backwards = run && !run.done && typeof obj.t === "number" && obj.t < run.lastT - 0.5;
  if (!run || run.done || run.mode !== "live" || (newUpstreamRun && run.events.length > 0) || backwards) {
    startRun("live", `${PROTOCOL_URL}/events`);
  }
  if (typeof obj.run === "string") setRun(obj.run);
  const r = run!;
  emit(r, obj);
  clearTimeout(r.idle);
  r.idle = setTimeout(() => endRun("idle"), LIVE_IDLE_MS);
  // All tasked agents answered -> run complete (short grace for trailing events).
  const tasked = new Set(r.events.filter((e) => e.type === "task").map((e) => e.agent));
  const answered = new Set(r.events.filter((e) => e.type === "answer" && !e.blocked).map((e) => e.agent));
  if (tasked.size && [...tasked].every((a) => answered.has(a))) {
    clearTimeout(r.idle);
    r.idle = setTimeout(() => endRun("complete"), 1500);
  }
}

// ---------------------------------------------------------------------------------------------- http

async function dispatch(req: Request, url: URL): Promise<Response> {
  const speed = Math.max(0.05, Math.min(50, Number(url.searchParams.get("speed") ?? 1) || 1));
  const learn = url.searchParams.get("learn") === "1";
  let replay = url.searchParams.get("replay");
  let fellBack = false;

  if (!replay) {
    if (await protocolUp()) {
      let tasks = demoTasks();
      if (req.method === "POST") {
        try {
          const body = (await req.json()) as { tasks?: { agent: string; text: string }[] };
          if (Array.isArray(body?.tasks) && body.tasks.length) tasks = body.tasks;
        } catch {}
      }
      const r = startRun("live", `${PROTOCOL_URL}/events`, true);
      r.idle = setTimeout(() => endRun("idle"), LIVE_IDLE_MS * 2);
      const how = await startProtocolRun(tasks);
      return json({ ...runInfo(r), dispatch: how, tasks, upstream });
    }
    if (url.searchParams.get("fallback") === "0") return json({ error: `protocol service down at ${PROTOCOL_URL}`, upstream }, 503);
    replay = DEFAULT_REPLAY;
    fellBack = true;
  }

  let events: PalaceEvent[];
  try {
    events = readReplay(replay);
  } catch (e) {
    return json({ error: (e as Error).message }, 404);
  }
  const r = startRun("replay", replay, learn);
  playReplay(r, events, speed);
  const duration = events.length ? events[events.length - 1]!.t / speed : 0;
  return json({ ...runInfo(r), events: events.length, speed, seconds: Math.round(duration * 10) / 10, fallback: fellBack || undefined });
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 0, // SSE streams stay open
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    switch (url.pathname) {
      case "/events":
        return eventsResponse(url);
      case "/dispatch":
        return dispatch(req, url);
      case "/stop":
        endRun("stopped");
        return json({ ok: true });
      case "/route": {
        const task = url.searchParams.get("task");
        if (!task) return json({ error: "task required" }, 400);
        return json(pickRoute(task));
      }
      case "/route/record": {
        if (req.method !== "POST") return json({ error: "POST {task, stations, routeId?}" }, 405);
        const b = (await req.json().catch(() => ({}))) as { task?: string; stations?: string[]; routeId?: string };
        if (!b.task || !Array.isArray(b.stations) || !b.stations.length) return json({ error: "task and stations required" }, 400);
        return json(await recordRoute(b.task, b.stations, b.routeId));
      }
      case "/runs":
        return json(existsSync(REPLAY_DIR) ? readdirSync(REPLAY_DIR).filter((f) => f.endsWith(".jsonl")).sort() : []);
      case "/health":
      case "/":
        return json({ ok: true, port: PORT, protocol: PROTOCOL_URL, upstream, subscribers: subscribers.size, run: run ? { ...runInfo(run), done: run.done } : null });
      default:
        return json({ error: "not found" }, 404);
    }
  },
});

console.log(`bridge on http://localhost:${server.port}  (GET /events, POST /dispatch?replay=demo-1&speed=2)`);
if (process.env.PROXY !== "0") followUpstream();
