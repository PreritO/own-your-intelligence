// OWNED BY: presence (figure: humans workspace). One agent avatar: a blocky voxel human in team colour
// (web/src/agents/human/), a pixel nameplate, a blocky status bubble, a pixel ring on the floor and a
// short floor trail. Movement is a queue of waypoints (from nav.pathBetween) walked at a speed that
// adapts to the backlog, so the avatar always catches up with the stream and ends where the stream says.
//
// Public API is unchanged from the orb version (group, pos, walk, end, moving, setTag, setWaiting, ping,
// update, teleport, dispose, AVATAR_Y). New OPTIONAL methods, safe to ignore: setActivity, setBubble,
// face, playSpawn (see NOTES-humans.md). Without them the pose and bubble are inferred:
//   moving -> walk · setWaiting(true) -> waiting · stopped next to a memory orb -> reading · else idle.
import * as THREE from "three";
import { disposeTree } from "./fx";
import { BlockBurst, Bubble, groundRing, Nameplate, PLATE_LIFT } from "./human/pixel";
import { Animator, type Activity } from "./human/pose";
import { buildHuman, HEAD_TOP, type Human } from "./human/rig";

/** Height of `group.position` above the floor (beams and cameras attach here: head height). */
export const AVATAR_Y = 1.75;
const BASE_SPEED = 5; // m/s at 1x
const CATCH_UP = 1.6; // s: the whole backlog is walked in about this long at 1x
const TRAIL = 48;
const STATION_R = 2.4; // m: stopping this close to a memory orb counts as "at the station"
const HAT_H = 0.16; // headroom for hats above HEAD_TOP

export type HumanActivity = Exclude<Activity, "walk">;

let firstBorn = -1;

export class Avatar {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3();
  private queue: THREE.Vector3[] = [];
  private floor = new THREE.Group(); // at floor level under the avatar
  private figure = new THREE.Group(); // the human: yaw + overview boost
  private human: Human;
  private anim: Animator;
  private plate: Nameplate;
  private bubble = new Bubble();
  private ring: ReturnType<typeof groundRing>;
  private burst: BlockBurst;
  private trail: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private trailPts: THREE.Vector3[] = [];
  private trailAcc = 0;
  private pulse = 0;
  private spawnT = 1;
  private time = Math.random() * 10;
  private base = new THREE.Color();
  private cruise = BASE_SPEED;
  private yaw = 0;
  private boost = 1;
  private camPos = new THREE.Vector3(0, 60, 0);
  private prev = new THREE.Vector3();
  // inferred / explicit state
  private explicitActivity: HumanActivity | null = null;
  private explicitBubble: string | null = null;
  private faceTarget: THREE.Vector3 | null = null;
  private station: THREE.Vector3 | null = null; // orb we stopped next to
  private waitingOn = "";
  private status = ""; // suffix from setTag ("✓", "⚠", "✕", or free text)
  private tagText = "";
  private orbCache: THREE.Vector3[] | null = null;
  waiting = false;

  constructor(
    private scene: THREE.Scene,
    readonly id: string,
    readonly name: string,
    readonly color: string,
    home: THREE.Vector3,
  ) {
    this.base.set(color);
    this.human = buildHuman(id, color);
    this.anim = new Animator(this.human.bones);
    // remember where the camera is (for the overview size boost); frustumCulled=false so this always runs
    this.human.mesh.onBeforeRender = (_r, _s, cam) => void this.camPos.setFromMatrixPosition(cam.matrixWorld);

    this.floor.position.y = -AVATAR_Y;
    this.figure.add(this.human.mesh);
    this.ring = groundRing(color);
    this.burst = new BlockBurst(color);
    this.floor.add(this.ring.mesh, this.figure, this.burst.mesh);

    this.plate = new Nameplate(color);
    this.plate.set(name);
    this.tagText = name;
    this.bubble.set(null);
    this.group.add(this.floor, this.plate.sprite, this.bubble.sprite);
    scene.add(this.group);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    this.trail = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.trail.frustumCulled = false;
    scene.add(this.trail);

    this.teleport(home);
    // agents created well after the first ones were spawned at runtime: pop them in
    const now = performance.now();
    if (firstBorn < 0) firstBorn = now;
    else if (now - firstBorn > 2500) this.playSpawn();
  }

  teleport(p: THREE.Vector3) {
    this.queue = [];
    this.pos.copy(p);
    this.prev.copy(p);
    this.group.position.copy(p);
    this.trailPts = [];
    this.station = null;
    this.explicitActivity = null;
    this.explicitBubble = null;
    this.faceTarget = null;
    this.setWaiting(false);
  }

  /** Append waypoints to the walk. */
  walk(path: THREE.Vector3[]) {
    if (!path.length) return;
    this.queue.push(...path.map((p) => p.clone()));
    this.station = null;
    // cruise speed: finish the whole backlog in ~CATCH_UP s (never exponential, so it always lands)
    this.cruise = Math.max(BASE_SPEED, this.remaining() / CATCH_UP);
  }

  private remaining() {
    let len = 0;
    let prev = this.pos;
    for (const p of this.queue) (len += prev.distanceTo(p)), (prev = p);
    return len;
  }

  /** Where the avatar will be once its queue drains (plan new paths from here). */
  end(): THREE.Vector3 {
    return (this.queue[this.queue.length - 1] ?? this.pos).clone();
  }

  get moving() {
    return this.queue.length > 0;
  }

  /**
   * Nameplate text. "<name>  <suffix>" keeps the plate as the name and shows the suffix in the bubble:
   * "⌛ Eng" -> "waiting on Eng", "✓" -> "answered", "⚠" -> "answered, gaps", "✕" -> "blocked".
   */
  setTag(text: string) {
    if (text.startsWith(this.name)) {
      const suffix = text.slice(this.name.length).trim();
      this.plate.set(this.name);
      this.tagText = this.name;
      if (suffix.startsWith("⌛")) this.waitingOn = suffix.slice(1).trim();
      else this.status = suffix;
    } else {
      this.plate.set(text);
      this.tagText = text;
    }
  }

  setWaiting(on: boolean) {
    this.waiting = on;
    this.waitingOn = "";
    this.status = "";
    if (this.tagText !== this.name) this.plate.set(this.name), (this.tagText = this.name);
  }

  /** A short bright pulse and a little hop (task received, answer posted). */
  ping() {
    this.pulse = 1;
  }

  // ---------- optional API (humans workspace) ----------

  /**
   * Force a pose: "reading" | "waiting" | "asking" | "idle"; null = infer (default). Walking always
   * wins while the avatar is moving. `lookAt` turns the avatar to face a world point when it stops.
   */
  setActivity(kind: HumanActivity | null, lookAt?: THREE.Vector3 | null) {
    this.explicitActivity = kind;
    if (lookAt !== undefined) this.face(lookAt);
  }

  /** Status bubble text ("asking Finance", "⌛ waiting on Eng", "✓ done"); null = back to inferred. */
  setBubble(text: string | null) {
    this.explicitBubble = text;
  }

  /** Face a world point whenever standing still (null = inferred: the nearest orb at a station). */
  face(target: THREE.Vector3 | null) {
    this.faceTarget = target ? target.clone() : null;
  }

  /** Spawn flourish: the character pops in with a burst of team-colour blocks. */
  playSpawn() {
    this.spawnT = 0;
    this.pulse = 1;
    this.burst.play();
  }

  /** What the figure is doing right now (for QA / UI). */
  get activity(): Activity {
    if (this.queue.length) return "walk";
    if (this.explicitActivity) return this.explicitActivity;
    if (this.waiting) return "waiting";
    if (this.station && !this.status) return "reading";
    return "idle";
  }

  private bubbleText(act: Activity): string | null {
    if (this.explicitBubble !== null) return this.explicitBubble;
    if (this.waiting) return this.waitingOn ? `⌛ waiting on ${this.waitingOn}` : "⌛ waiting";
    if (act === "walk") return null;
    if (this.explicitActivity === "reading") return "📖 reading";
    if (this.explicitActivity === "asking") return "? asking";
    if (this.explicitActivity === "waiting") return "⌛ waiting";
    if (this.status === "✓") return "✓ answered";
    if (this.status === "⚠") return "⚠ answered, gaps";
    if (this.status === "✕") return "✕ blocked";
    if (this.status) return this.status;
    if (act === "reading") return "📖 reading";
    if (act === "asking") return "? asking";
    return null;
  }

  /** Nearest memory orb (scene InstancedMesh "orbs") within STATION_R of p, horizontally. */
  private nearestOrb(p: THREE.Vector3): THREE.Vector3 | null {
    if (!this.orbCache?.length) {
      const orbs = this.scene.getObjectByName("orbs") as THREE.InstancedMesh | undefined;
      this.orbCache = [];
      if (orbs?.isInstancedMesh) {
        orbs.updateWorldMatrix(true, false);
        const m = new THREE.Matrix4();
        for (let i = 0; i < orbs.count; i++) {
          orbs.getMatrixAt(i, m);
          this.orbCache.push(new THREE.Vector3().setFromMatrixPosition(m).applyMatrix4(orbs.matrixWorld));
        }
      }
    }
    let best: THREE.Vector3 | null = null;
    let bd = STATION_R;
    for (const o of this.orbCache) {
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      if (d < bd) (bd = d), (best = o);
    }
    return best;
  }

  update(dt: number, speed: number) {
    this.time += dt;
    this.prev.copy(this.pos);
    if (this.queue.length) {
      // cruise, then ease into the final stop over the last couple of meters
      const v = Math.min(this.cruise, Math.max(BASE_SPEED * 0.6, this.remaining() * 3));
      let step = v * speed * dt;
      while (step > 0 && this.queue.length) {
        const next = this.queue[0];
        const d = this.pos.distanceTo(next);
        if (d <= step) {
          this.pos.copy(next);
          this.queue.shift();
          step -= d;
        } else {
          this.pos.addScaledVector(next.clone().sub(this.pos).divideScalar(d), step);
          step = 0;
        }
      }
      if (!this.queue.length) this.station = this.nearestOrb(this.pos);
    }
    this.group.position.copy(this.pos);

    // ---- facing: travel direction while moving, else the explicit target or the station orb
    const dx = this.pos.x - this.prev.x, dz = this.pos.z - this.prev.z;
    const moved = Math.hypot(dx, dz);
    let want: number | null = null;
    if (moved > 1e-4) want = Math.atan2(dx, dz);
    else {
      const t = this.faceTarget ?? this.station;
      if (t && Math.hypot(t.x - this.pos.x, t.z - this.pos.z) > 0.05) want = Math.atan2(t.x - this.pos.x, t.z - this.pos.z);
    }
    if (want !== null) {
      let d = want - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-dt * Math.max(1, speed) * 10));
    }
    this.figure.rotation.y = this.yaw;

    // ---- pose
    const act = this.activity;
    this.pulse = Math.max(0, this.pulse - dt * 1.6);
    this.anim.update(dt, moved, act, this.pulse > 0 ? 1 - this.pulse : 0);
    this.human.book.visible = act === "reading";
    this.human.glow.value = this.pulse;

    // ---- size: grow a little when the camera is far (overview readability), pop in on spawn
    const dist = this.camPos.distanceTo(this.group.position);
    const wantBoost = THREE.MathUtils.clamp(1 + (dist - 14) / 28, 1, 2.3);
    this.boost += (wantBoost - this.boost) * (1 - Math.exp(-dt * 4));
    this.spawnT = Math.min(1, this.spawnT + dt / 0.5);
    const pop = this.spawnT >= 1 ? 1 : easeOutBack(this.spawnT);
    const s = this.boost * pop;
    this.figure.scale.setScalar(Math.max(0.001, s));
    this.ring.mesh.scale.setScalar(this.boost * (1 + 0.5 * this.pulse) * (this.waiting ? 1 + 0.06 * Math.sin(this.time * 5) : 1));
    this.burst.update(dt);

    // ---- labels: nameplate above the head (and hat), bubble stacked above the plate
    const top = -AVATAR_Y + (HEAD_TOP + HAT_H) * this.boost + 0.08;
    this.plate.sprite.position.y = top;
    this.bubble.sprite.position.y = top;
    this.bubble.set(this.bubbleText(act));
    this.plate.layout();
    this.bubble.layout();
    this.bubble.sprite.center.set(0.5, -(this.plate.cssH * (1 + PLATE_LIFT) + 3) / Math.max(1, this.bubble.cssH));

    // ---- trail on the floor: sample positions, fade tail to black (additive => invisible)
    this.trailAcc += dt;
    if (this.trailAcc > 0.04) {
      this.trailAcc = 0;
      const last = this.trailPts[this.trailPts.length - 1];
      if (!last || last.distanceTo(this.pos) > 0.05) this.trailPts.push(this.pos.clone());
      else if (this.trailPts.length) this.trailPts.shift(); // idle: let the tail retract
      if (this.trailPts.length > TRAIL) this.trailPts.shift();
    }
    const posA = this.trail.geometry.getAttribute("position") as THREE.BufferAttribute;
    const colA = this.trail.geometry.getAttribute("color") as THREE.BufferAttribute;
    const n = this.trailPts.length;
    for (let i = 0; i < n; i++) {
      const p = this.trailPts[i];
      posA.setXYZ(i, p.x, p.y - AVATAR_Y + 0.05, p.z);
      const k = ((i + 1) / n) * 0.8;
      colA.setXYZ(i, this.base.r * k, this.base.g * k, this.base.b * k);
    }
    posA.needsUpdate = colA.needsUpdate = true;
    this.trail.geometry.setDrawRange(0, n);
  }

  dispose() {
    this.plate.dispose();
    this.bubble.dispose();
    this.ring.dispose();
    this.burst.dispose();
    this.human.dispose();
    this.group.removeFromParent();
    disposeTree(this.trail);
  }
}

function easeOutBack(x: number) {
  const c1 = 1.9, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
