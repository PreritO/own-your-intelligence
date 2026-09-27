// OWNED BY: training, ui-v3. The Gym (River AI, Tier 2): weight rack (checkpoints per team), treadmill
// lanes with ghost rollouts, scoreboard with PRs (pure function of train_step events), and the River
// leaderboard (web/src/ui/leaderboard.ts), shown while the camera is in or near the Gym or after the HUD's Gym button.
import * as THREE from "three";
import { PalaceEvent } from "../../../server/schema";
import type { PalaceRuntime } from "../api";
import { buildShell, departments, signAbove, fetchTextOptional, flyTo, framePose, makeBoard, mountOnFarWall, roundRect, teamColor, teamLabel, textSprite, type Placement } from "./layout";
import { GYM_EVENTS, mountLeaderboard } from "../ui/leaderboard";
import { PRESENCE_EVENTS } from "../agents/run";

type TrainStep = Extract<PalaceEvent, { type: "train_step" }>;
interface TeamStats { team: string; points: { step: number; reward: number }[]; checkpoints: string[]; best: number; last?: TrainStep; run?: string; sim?: boolean }
/** Local-sim checkpoints: "sim", "sim-step-N" (server/train/quest.py) and dry-run ids. Everything else is River. */
const isSimCkpt = (c?: string) => !!c && (c === "sim" || c.startsWith("sim-") || c.startsWith("river-dryrun"));

const LANES = 8; // River group size: 8 attempts per task
const MAX_PLATES = 8;

export function mountGym(rt: PalaceRuntime, pl: Placement) {
  const g = buildShell(rt, pl, "The Gym", "#9ece6a");
  const TEAMS = departments(rt.palace); // every department in palace.json (7 with the outer wings)
  const sx = Math.sign(pl.center.x) || 1, sz = Math.sign(pl.center.z) || 1;

  // ---------- scoreboard ----------
  const board = makeBoard(8, 4.4, 2048);
  mountOnFarWall(pl, board.mesh, 4.4);
  g.add(board.mesh);
  signAbove(g, board.mesh, 4.4);

  // ---------- weight rack: one post per team, a plate per saved checkpoint ----------
  const racks = new Map<string, THREE.Group>();
  TEAMS.forEach((team, i) => {
    const rack = new THREE.Group();
    const color = teamColor(rt.palace, team);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 8), new THREE.MeshStandardMaterial({ color: "#8a90a6", metalness: 0.8, roughness: 0.3 }));
    post.position.y = 1.3;
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.7), new THREE.MeshStandardMaterial({ color: "#20242f" }));
    const label = textSprite(teamLabel(rt.palace, team), color, 40);
    label.position.y = 3.1;
    label.scale.multiplyScalar(0.6);
    rack.add(post, base, label);
    // Weight rack along the near-x wall (clear of the tilted scoreboard and the door).
    const step = Math.min(1.5, 5 / Math.max(1, TEAMS.length - 1));
    rack.position.set(-sx * (pl.size[0] / 2 - 1.1), 0, sz * (0.4 + i * step));
    g.add(rack);
    racks.set(team, rack);
  });

  // ---------- treadmill lanes with ghosts ----------
  const lanes = new THREE.Group();
  const ghostGeo = new THREE.CapsuleGeometry(0.22, 0.5, 4, 10);
  const ghosts: { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; phase: number; reward: number }[] = [];
  const laneLen = 5.2;
  for (let i = 0; i < LANES; i++) {
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, laneLen), new THREE.MeshStandardMaterial({ color: "#151821", roughness: 0.6 }));
    belt.position.set((i - (LANES - 1) / 2) * 0.78, 0.08, 0);
    const mat = new THREE.MeshStandardMaterial({ color: "#c8d0ff", emissive: "#c8d0ff", emissiveIntensity: 0.2, transparent: true, opacity: 0.35 });
    const ghost = new THREE.Mesh(ghostGeo, mat);
    ghost.position.set(belt.position.x, 0.62, 0);
    lanes.add(belt, ghost);
    ghosts.push({ mesh: ghost, mat, phase: i * 0.7, reward: 0 });
  }
  lanes.position.set(-sx * 2.2, 0, -sz * 2.2);
  lanes.rotation.y = Math.atan2(-pl.center.x, -pl.center.z); // lanes run toward the foyer
  g.add(lanes);

  // ---------- state: one row per trainee (a team, or a commissioned agent like quest-1) ----------
  const stats = new Map<string, TeamStats>(TEAMS.map((t) => [t, { team: t, points: [], checkpoints: [], best: -Infinity }]));
  const agentColor = new Map<string, string>(rt.palace.agents.map((a) => [a.id, a.color]));
  const agentLabel = new Map<string, string>(rt.palace.agents.map((a) => [a.id, a.label]));
  let activeKey = TEAMS[0] ?? "legal";
  let lastStepAt = 0;
  /** Team specialists train under their team; any other agent (quest-N) gets its own row and colour. */
  const keyOf = (e: TrainStep) => (e.team && (e.agent === e.team || !e.agent.startsWith("quest")) ? e.team : e.agent);
  const colorOf = (k: string) => (TEAMS.includes(k) ? teamColor(rt.palace, k) : agentColor.get(k) ?? "#7dcfff");
  const labelOf = (k: string) => (TEAMS.includes(k) ? teamLabel(rt.palace, k) : agentLabel.get(k) ?? k);

  function ingest(e: TrainStep) {
    const k = keyOf(e);
    const s = stats.get(k) ?? { team: k, points: [], checkpoints: [], best: -Infinity };
    stats.set(k, s);
    // A replay restart re-sends step 1..n; reset that curve when steps go backwards.
    if (s.points.length && e.step < s.points[s.points.length - 1].step) { s.points = []; s.best = -Infinity; }
    s.points.push({ step: e.step, reward: e.reward });
    s.best = Math.max(s.best, e.reward);
    s.last = e;
    s.run = e.run;
    if (isSimCkpt(e.checkpoint) || e.run?.includes("dryrun")) s.sim = true;
    if (e.checkpoint && !s.checkpoints.includes(e.checkpoint)) { s.checkpoints.push(e.checkpoint); addPlate(k, s.checkpoints.length); }
    activeKey = k;
    lastStepAt = performance.now();
    spreadGhosts(e.step, e.reward, colorOf(k));
    redraw();
  }

  function rackFor(k: string): THREE.Group | undefined {
    if (racks.has(k) || racks.size >= 4) return racks.get(k);
    const rack = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 8), new THREE.MeshStandardMaterial({ color: "#8a90a6" }));
    post.position.y = 1.3;
    const label = textSprite(labelOf(k), colorOf(k), 40);
    label.position.y = 3.1;
    label.scale.multiplyScalar(0.6);
    rack.add(post, label);
    rack.position.set(-sx * (pl.size[0] / 2 - 1.1), 0, sz * (0.8 + racks.size * 1.5));
    g.add(rack);
    racks.set(k, rack);
    return rack;
  }

  function addPlate(k: string, n: number) {
    const rack = rackFor(k);
    if (!rack || n > MAX_PLATES) return;
    const color = colorOf(k);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.42 - n * 0.02, 0.42 - n * 0.02, 0.1, 24), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, metalness: 0.5, roughness: 0.4 }));
    plate.position.y = 0.2 + n * 0.13;
    rack.add(plate);
  }

  /** 8 attempts per task: deterministic spread around the step's mean reward (display only). */
  function spreadGhosts(step: number, reward: number, hex: string) {
    const color = new THREE.Color(hex);
    const rewards = ghosts.map((_, i) => reward + 0.35 * Math.sin(step * 12.9898 + i * 78.233));
    const ranked = [...rewards].sort((a, b) => b - a);
    ghosts.forEach((gh, i) => {
      gh.reward = rewards[i];
      const top = rewards[i] >= ranked[2];
      // Ghosts wear the trainee's colour; the best attempts of the step glow brighter.
      gh.mat.color.copy(color);
      gh.mat.emissive.copy(top ? new THREE.Color("#9ece6a") : color);
      gh.mat.emissiveIntensity = top ? 0.9 : 0.25;
      gh.mat.opacity = top ? 0.9 : 0.5;
    });
  }

  let clock = 0;
  let acc = 0;
  const offFrame = rt.onFrame((dt) => {
    clock += dt;
    const live = performance.now() - lastStepAt < 8000;
    ghosts.forEach((gh) => {
      const speed = live ? 5 + 5 * Math.max(0, gh.reward) : 1.2;
      gh.phase += dt * speed;
      gh.mesh.position.y = 0.62 + Math.abs(Math.sin(gh.phase)) * (live ? 0.18 : 0.04);
      gh.mesh.position.z = Math.sin(gh.phase * 0.23) * (live ? 0.9 : 0.1);
    });
    acc += dt;
    if (live && acc > 0.5) { acc = 0; redraw(); }
  });

  const offEvents = rt.events.subscribe((e) => {
    if (e.type === "spawn") { agentColor.set(e.agent, e.color); agentLabel.set(e.agent, e.label); }
    if (e.type === "train_step") ingest(e);
  });

  function redraw() {
    board.draw((ctx, W, H) => {
      ctx.fillStyle = "rgba(12,20,14,0.94)";
      roundRect(ctx, 0, 0, W, H, 36);
      ctx.fill();
      ctx.strokeStyle = "rgba(158,206,106,0.6)";
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.textBaseline = "top";
      ctx.fillStyle = "#e6e8ef";
      ctx.font = "700 64px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText("THE GYM · SCOREBOARD", 56, 40);
      const any = [...stats.values()].some((s) => s.points.length);
      const run = [...stats.values()].find((s) => s.run)?.run;
      ctx.font = "400 32px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "#9aa0b4";
      const act = stats.get(activeKey);
      const sim = !!run?.includes("dryrun") || !!act?.sim;
      ctx.fillText(any ? `${sim ? "local RL sim (same palace env + reward), not River" : "River RL (real, noisy)"} · reward/mean per step · ${act?.run ?? run ?? ""}` : "waiting for train_step events from server/train…", 56, 116);

      // Commissioned agent (most recent) first, then the teams that have trained, padded with the rest
      // in wing order; at most 4 rows so the numbers stay readable with 7 departments.
      const others = [...stats.keys()].filter((k) => !TEAMS.includes(k)).sort((a, b) => (b === activeKey ? 1 : 0) - (a === activeKey ? 1 : 0));
      const trained = TEAMS.filter((t) => stats.get(t)!.points.length).sort((a, b) => (b === activeKey ? 1 : 0) - (a === activeKey ? 1 : 0));
      const keys = [...others.slice(0, 1), ...trained];
      for (const t of TEAMS) if (keys.length < 4 && !keys.includes(t)) keys.push(t);
      keys.length = Math.min(keys.length, 4);
      const rowH = (H - 200) / keys.length;
      keys.forEach((key, i) => {
        const s = stats.get(key)!;
        const y = 180 + i * rowH;
        const color = colorOf(key);
        ctx.fillStyle = key === activeKey && any ? "rgba(158,206,106,0.08)" : "rgba(255,255,255,0.03)";
        roundRect(ctx, 40, y, W - 80, rowH - 20, 20);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.font = "700 48px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(labelOf(key), 72, y + 24);
        ctx.font = "500 30px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = "#9aa0b4";
        ctx.fillText(`${s.checkpoints.length} checkpoint${s.checkpoints.length === 1 ? "" : "s"}`, 72, y + 86);
        if (s.last?.checkpoint) ctx.fillText(shortCkpt(s.last.checkpoint), 72, y + 126);

        // numbers
        const nx = 520;
        const stat = (label: string, value: string, x: number, c = "#e6e8ef") => {
          ctx.fillStyle = "#9aa0b4";
          ctx.font = "500 28px ui-sans-serif, system-ui, sans-serif";
          ctx.fillText(label, x, y + 24);
          ctx.fillStyle = c;
          ctx.font = "800 64px ui-sans-serif, system-ui, sans-serif";
          ctx.fillText(value, x, y + 60);
        };
        const last = s.points[s.points.length - 1];
        stat("step", last ? String(last.step) : "–", nx);
        stat("reward", last ? last.reward.toFixed(2) : "–", nx + 190);
        stat("PR", Number.isFinite(s.best) ? s.best.toFixed(2) : "–", nx + 440, "#9ece6a");

        // sparkline
        const px = nx + 700, pw = W - px - 80, ph = rowH - 80, py = y + 30;
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.lineWidth = 2;
        ctx.strokeRect(px, py, pw, ph);
        if (s.points.length > 1) {
          const lo = Math.min(-1, ...s.points.map((p) => p.reward)), hi = Math.max(1.5, ...s.points.map((p) => p.reward));
          const x0 = s.points[0].step, x1 = s.points[s.points.length - 1].step;
          ctx.beginPath();
          s.points.forEach((p, k) => {
            const X = px + ((p.step - x0) / Math.max(1, x1 - x0)) * pw;
            const Y = py + ph - ((p.reward - lo) / (hi - lo)) * ph;
            k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
          });
          ctx.strokeStyle = color;
          ctx.lineWidth = 5;
          ctx.stroke();
          const zeroY = py + ph - ((0 - lo) / (hi - lo)) * ph;
          ctx.strokeStyle = "rgba(255,255,255,0.18)";
          ctx.setLineDash([8, 8]);
          ctx.beginPath(); ctx.moveTo(px, zeroY); ctx.lineTo(px + pw, zeroY); ctx.stroke();
          ctx.setLineDash([]);
        }
      });
    });
  }
  redraw();

  // In ?demo, also play a canned train_step replay if one has been dropped into fixtures/replays/
  // (server/train writes out/gym-legal.jsonl; ?gym=<name> picks another). Parsed with the frozen schema.
  const params = new URLSearchParams(location.search);
  // Outside ?demo the same real River curve is drawn at once (static board), so the Gym is never empty.
  const gymName = params.get("gym") || "gym-legal";
  const animate = rt.events.mode === "demo" || params.has("gym");
  const timers: number[] = [];
  if (gymName) {
    fetchTextOptional(`/replays/${gymName}.jsonl`).then((text) => {
      if (!text) return;
      const delay = Number(params.get("gymDelay") ?? 2);
      for (const line of text.split("\n").filter(Boolean)) {
        let parsed;
        try { parsed = PalaceEvent.safeParse(JSON.parse(line)); } catch { continue; }
        if (parsed.success && parsed.data.type === "train_step") {
          const e = parsed.data;
          if (animate) timers.push(window.setTimeout(() => ingest(e), ((delay + e.t) * 1000) / (rt.events.speed || 1)));
          else ingest(e);
        }
      }
    });
  }

  const pose = () => {
    // Higher and further back than the other boards so the lanes and racks are in frame.
    const { eye, target } = framePose(pl, board.mesh, 16);
    target.lerp(pl.center.clone().setY(1), 0.45);
    return { eye, target };
  };

  // ---------- River leaderboard (DOM): opens only from the HUD's "Gym" button ----------
  // Never auto-opens when the camera passes the Gym (e.g. following a quest agent); it closes with ✕
  // or once the camera leaves the Gym.
  const lb = mountLeaderboard(rt.hud, rt.palace);
  const gymPoint = pl.center.clone().setY(2);
  const FAR = 38; // metres from the camera; the overview camera sits well beyond FAR
  let pinned = false; // opened by the button: stay open until the fly ends or the camera leaves
  let endFly: (() => void) | null = null;
  lb.onClose(() => { pinned = false; });
  const offNear = rt.onFrame(() => {
    if (!pinned && rt.camera.position.distanceTo(gymPoint) > FAR) lb.hide();
  });
  const onGo = () => {
    pinned = true;
    const p = pose();
    endFly = flyTo(rt, p.eye, p.target);
    lb.show();
  };
  // Leaving for the map, an agent, or a new quest ends the Gym cinematic.
  const onLeave = () => { pinned = false; if (endFly) { const f = endFly; endFly = null; f(); } };
  const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") { pinned = false; endFly = null; } };
  addEventListener(GYM_EVENTS.go, onGo);
  addEventListener(PRESENCE_EVENTS.camera, onLeave);
  addEventListener(PRESENCE_EVENTS.commission, onLeave);
  addEventListener("keydown", onEsc);

  return {
    group: g,
    pose,
    dispose() {
      offFrame(); offEvents(); offNear(); timers.forEach(clearTimeout); rt.scene.remove(g);
      removeEventListener(GYM_EVENTS.go, onGo);
      removeEventListener(PRESENCE_EVENTS.camera, onLeave);
      removeEventListener(PRESENCE_EVENTS.commission, onLeave);
      removeEventListener("keydown", onEsc);
      lb.el.parentElement?.remove();
    },
  };
}

function shortCkpt(path: string): string {
  const tail = path.split("/").slice(-2).join("/");
  return tail.length > 34 ? "…" + tail.slice(-33) : tail;
}
