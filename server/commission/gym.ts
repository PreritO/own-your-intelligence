// The Gym for a commissioned agent: a tiny, honest RL simulation (checkpoint "sim").
//
// Policy: one Bernoulli "keep this station on the route" per station the agent explored in run 1,
// logits start high (run 1 visited everything). Each step samples a group of candidate routes, scores
// each with the same reward shape as the palace Gym (useful evidence covered, hops cost, uncovered
// subtasks cost), and applies a group-centred REINFORCE update. The reward really climbs as wasted
// hops drop out; the learned route is every station with p >= 0.5.
//
// The per-station values come from run 1 (verdicts + what the agent's own reflection said it would
// use), so nothing here is invented: it is the Gym replaying the agent's own exploration.
export type GymStation = { id: string; subtask: string; value: number }; // value 0 = wasted hop
export type GymStep = { step: number; reward: number; keep: number; probs: Record<string, number> };

const HOP_COST = 0.3;
const UNCOVERED = 0.6;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function scoreRoute(keep: boolean[], stations: GymStation[]): number {
  let r = 0;
  const covered = new Set<string>();
  const subtasks = new Set(stations.filter((s) => s.value > 0).map((s) => s.subtask));
  stations.forEach((s, i) => {
    if (!keep[i]) return;
    r += s.value - HOP_COST;
    if (s.value > 0) covered.add(s.subtask);
  });
  for (const st of subtasks) if (!covered.has(st)) r -= UNCOVERED;
  return r;
}

export function* train(stations: GymStation[], steps = 24, group = 12, lr = 2.5, seed = 7): Generator<GymStep> {
  const rand = mulberry32(seed);
  const logit = stations.map(() => 1.5); // p ~ 0.82: run 1 kept (almost) everything
  const sig = (x: number) => 1 / (1 + Math.exp(-x));
  // Normalise to the best achievable route so the Gym's scoreboard reads 0..1.
  const best = Math.max(1e-6, scoreRoute(stations.map((s) => s.value > 0), stations));
  for (let step = 1; step <= steps; step++) {
    const samples = Array.from({ length: group }, () => stations.map((_, i) => rand() < sig(logit[i]!)));
    const rewards = samples.map((k) => scoreRoute(k, stations));
    const mean = rewards.reduce((a, b) => a + b, 0) / group;
    const sd = Math.sqrt(rewards.reduce((a, b) => a + (b - mean) ** 2, 0) / group) || 1;
    stations.forEach((_, i) => {
      const p = sig(logit[i]!);
      let g = 0;
      samples.forEach((k, j) => (g += ((rewards[j]! - mean) / sd) * ((k[i] ? 1 : 0) - p)));
      logit[i] = logit[i]! + (lr * g) / group;
    });
    const probs = Object.fromEntries(stations.map((s, i) => [s.id, Math.round(sig(logit[i]!) * 1000) / 1000]));
    yield { step, reward: Math.round((mean / best) * 1000) / 1000, keep: Object.values(probs).filter((p) => p >= 0.5).length, probs };
  }
}

if (import.meta.main) {
  const demo: GymStation[] = [
    { id: "a", subtask: "s1", value: 1 },
    { id: "b", subtask: "s1", value: 0 },
    { id: "c", subtask: "s2", value: 0.5 },
    { id: "d", subtask: "s2", value: 0 },
    { id: "e", subtask: "s3", value: 1 },
  ];
  for (const s of train(demo)) console.log(s.step, s.reward, s.keep, JSON.stringify(s.probs));
}
