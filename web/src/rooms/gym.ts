// OWNED BY: training. The Gym (River AI, Tier 2): weight rack (checkpoints per team), treadmill
// lanes with ghost rollouts, scoreboard with PRs. Pure function of train_step events.
import * as THREE from "three";
import { PalaceEvent } from "../../../server/schema";
import type { PalaceRuntime } from "../api";
import { buildShell, fetchTextOptional, framePose, makeBoard, mountOnFarWall, roundRect, teamColor, textSprite, type Placement } from "./layout";

type TrainStep = Extract<PalaceEvent, { type: "train_step" }>;
interface TeamStats { team: string; points: { step: number; reward: number }[]; checkpoints: string[]; best: number; last?: TrainStep; run?: string }

const TEAMS = ["legal", "finance", "eng"];
const LANES = 8; // River group size: 8 attempts per task
const MAX_PLATES = 8;

export function mountGym(rt: PalaceRuntime, pl: Placement) {
  const g = buildShell(rt, pl, "The Gym", "#9ece6a");
  const sx = Math.sign(pl.center.x) || 1, sz = Math.sign(pl.center.z) || 1;

  // ---------- scoreboard ----------
  const board = makeBoard(9, 5, 2048);
  mountOnFarWall(pl, board.mesh, 3.4, 0.36);
  g.add(board.mesh);

  // ---------- weight rack: one post per team, a plate per saved checkpoint ----------
  const racks = new Map<string, THREE.Group>();
  TEAMS.forEach((team, i) => {
    const rack = new THREE.Group();
    const color = teamColor(rt.palace, team);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 8), new THREE.MeshStandardMaterial({ color: "#8a90a6", metalness: 0.8, roughness: 0.3 }));
    post.position.y = 1.3;
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 1.1), new THREE.MeshStandardMaterial({ color: "#20242f" }));
    const label = textSprite(team[0].toUpperCase() + team.slice(1), color, 40);
    label.position.y = 3.1;
    rack.add(post, base, label);
    // Rack line runs along the room's inner-x side.
    rack.position.set(-sx * (pl.size[0] / 2 - 1.2), 0, -sz * 3 + i * sz * 3);
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
  lanes.position.set(sx * 0.6, 0, sz * 0.4);
  lanes.rotation.y = Math.atan2(-pl.center.x, -pl.center.z); // lanes run toward the foyer
  g.add(lanes);

  // ---------- state ----------
  const stats = new Map<string, TeamStats>(TEAMS.map((t) => [t, { team: t, points: [], checkpoints: [], best: -Infinity }]));
  let activeTeam = "legal";
  let lastStepAt = 0;

  function ingest(e: TrainStep) {
    const s = stats.get(e.team) ?? { team: e.team, points: [], checkpoints: [], best: -Infinity };
    stats.set(e.team, s);
    // A replay restart re-sends step 1..n; reset that team's curve when steps go backwards.
    if (s.points.length && e.step < s.points[s.points.length - 1].step) { s.points = []; s.best = -Infinity; }
    s.points.push({ step: e.step, reward: e.reward });
    s.best = Math.max(s.best, e.reward);
    s.last = e;
    s.run = e.run;
    if (e.checkpoint && !s.checkpoints.includes(e.checkpoint)) { s.checkpoints.push(e.checkpoint); addPlate(e.team, s.checkpoints.length); }
    activeTeam = e.team;
    lastStepAt = performance.now();
    spreadGhosts(e);
    redraw();
  }

  function addPlate(team: string, n: number) {
    const rack = racks.get(team);
    if (!rack || n > MAX_PLATES) return;
    const color = teamColor(rt.palace, team);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.42 - n * 0.02, 0.42 - n * 0.02, 0.1, 24), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, metalness: 0.5, roughness: 0.4 }));
    plate.position.y = 0.2 + n * 0.13;
    rack.add(plate);
  }

  /** 8 attempts per task: deterministic spread around the step's mean reward (display only). */
  function spreadGhosts(e: TrainStep) {
    const color = new THREE.Color(teamColor(rt.palace, e.team));
    const rewards = ghosts.map((_, i) => e.reward + 0.35 * Math.sin(e.step * 12.9898 + i * 78.233));
    const ranked = [...rewards].sort((a, b) => b - a);
    ghosts.forEach((gh, i) => {
      gh.reward = rewards[i];
      const top = rewards[i] >= ranked[2];
      gh.mat.color.copy(top ? new THREE.Color("#9ece6a") : color);
      gh.mat.emissive.copy(gh.mat.color);
      gh.mat.emissiveIntensity = top ? 1.4 : 0.3;
      gh.mat.opacity = top ? 0.85 : 0.45;
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

  const offEvents = rt.events.subscribe((e) => { if (e.type === "train_step") ingest(e); });

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
      ctx.fillText(any ? `River RL · reward/mean per step${run ? ` · run ${run}` : ""}` : "waiting for train_step events from server/train…", 56, 116);

      const rowH = (H - 200) / TEAMS.length;
      TEAMS.forEach((team, i) => {
        const s = stats.get(team)!;
        const y = 180 + i * rowH;
        const color = teamColor(rt.palace, team);
        ctx.fillStyle = team === activeTeam && any ? "rgba(158,206,106,0.08)" : "rgba(255,255,255,0.03)";
        roundRect(ctx, 40, y, W - 80, rowH - 20, 20);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.font = "700 48px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(team[0].toUpperCase() + team.slice(1), 72, y + 24);
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
  const gymName = params.get("gym") || (rt.events.mode === "demo" ? "gym-legal" : "");
  const timers: number[] = [];
  if (gymName) {
    fetchTextOptional(`/replays/${gymName}.jsonl`).then((text) => {
      if (!text) return;
      const delay = Number(params.get("gymDelay") ?? 2);
      for (const line of text.split("\n").filter(Boolean)) {
        const parsed = PalaceEvent.safeParse(JSON.parse(line));
        if (parsed.success && parsed.data.type === "train_step") {
          const e = parsed.data;
          timers.push(window.setTimeout(() => ingest(e), ((delay + e.t) * 1000) / (rt.events.speed || 1)));
        }
      }
    });
  }

  return {
    group: g,
    pose: () => framePose(pl, board.mesh, 10, 1.2),
    dispose() { offFrame(); offEvents(); timers.forEach(clearTimeout); rt.scene.remove(g); },
  };
}

function shortCkpt(path: string): string {
  const tail = path.split("/").slice(-2).join("/");
  return tail.length > 34 ? "…" + tail.slice(-33) : tail;
}
