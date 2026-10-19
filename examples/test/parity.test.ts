import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import type { LogEntry } from '@drawcall/animate';
import { SCENARIOS } from '../src/scenarios';
import type { Scenario } from '../src/scenario';
import { Simulation } from '../src/simulation';
import { knownFailure } from '../scripts/run';

const path = vi.hoisted((): { legs?: 'old' | 'core' } => ({}));
vi.mock('../../packages/animate/src/humanoid/idle', async (original) => {
  const actual = await original<typeof import('../../packages/animate/src/humanoid/idle')>();
  return { ...actual, idle: ((h, options = {}) => actual.idle(h, { ...options, legs: path.legs })) satisfies typeof actual.idle };
});

// Stage 0: exact check names, per scene. A disappearing failure must be removed here.
const coreFailures: Record<string, { checks: string[]; error?: string }> = {
  'stroll': {
    checks: ['XCoM outside support (m)', 'joint acceleration (°/s²)', 'leg ground (m)', 'standing CoM outside the feet (m)'],
    error: '3.033 s, "": legs cannot support root follower',
  },
  'pickup-shelf': {
    checks: ['XCoM outside support (m)'],
    error: '6.383 s, "": "item" left grip "left": 0.684 m off; "item" right grip "right": 0.692 m off after 4 s',
  },
  'hand-over': { checks: [] },
  'knight-arming': {
    checks: ['XCoM outside support (m)', 'joint acceleration (°/s²)', 'leg contact (m)'],
    error: '4.700 s, "": "item" left grip "end": 0.145 m off; "item" right grip "end": 0.069 m off after 4 s',
  },
  'idle-life': { checks: [] },
  'reach-around': {
    checks: ['reach-around: scenario unfinished'],
  },
  'lift-heavy': {
    checks: ['leg contact (m)', 'leg swing peak earliness before 35% (fraction)'],
    error: '4.583 s, "": "box" left grip "left": 0.706 m off; "box" right grip "right": 0.706 m off after 4 s',
  },
};

function measure(sc: Scenario, legs?: 'old' | 'core') {
  path.legs = legs;
  const sim = new Simulation(sc, undefined, true);
  const hash = createHash('sha256');
  const standing = sim.actors.map(() => 0);
  const step = () => {
    const before = sim.actors.map((h) => ({ go: h.asks.go, phases: h.feet.map((foot) => foot.phase) }));
    sim.step();
    sim.actors.forEach((h, i) => {
      // Count non-go standing lifts, including balancing and squaring adjustments.
      if (!before[i].go && !h.gait.moving && h.gait.velocity.length() < 0.05) {
        h.feet.forEach((foot, s) => { if (before[i].phases[s] === 'planted' && foot.phase === 'swing') standing[i]++; });
      }
      hash.update(JSON.stringify([h.pose.position(0), h.pose.skeleton.bones.map((_, b) => [h.pose.local(b), h.pose.load(b)]), h.feet, h.gait]));
    });
  };
  let error: string | undefined;
  try {
    while (sim.t < sc.duration) step();
    step(); // Observers read the last final pose.
  } catch (cause) {
    if (legs !== 'core' || !(cause instanceof Error)) throw cause;
    error = cause.message;
  }
  const log: LogEntry[] = [...sim.actors, ...sim.stage.bodies ?? []].flatMap((body) => [...body.log]);
  if (!error && !sim.stage.done()) log.push({ time: sim.t, check: `${sc.id}: scenario unfinished`, value: 1, limit: 0, where: `actor 0: ${sc.id}` });
  return { digest: hash.digest('hex'), standing, failures: { checks: [...new Set(log.filter((e) => !knownFailure(e)).map((e) => e.check))].sort(), ...(error ? { error } : {}) } };
}

for (const sc of SCENARIOS) {
  it(`${sc.id}: default and explicit old paths preserve every final pose and standing step`, () => {
    const baseline = measure(sc);
    expect(baseline.failures).toEqual({ checks: [] });
    expect(measure(sc, 'old')).toEqual(baseline);
    console.log(`${sc.id}: old non-go standing steps ${JSON.stringify(baseline.standing)}; pose ${baseline.digest}`);
  }, 20000);

  if (!(sc.id in coreFailures)) continue;
  it(`${sc.id}: core stage 0 parity failures`, () => {
    const core = measure(sc, 'core');
    console.log(`${sc.id}: core failures ${JSON.stringify(core.failures)}`);
    expect(core.failures).toEqual(coreFailures[sc.id]);
  }, 20000);
}
