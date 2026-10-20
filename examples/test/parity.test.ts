import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import { INDEX } from '../../packages/animate/src/humanoid/bones';
import { legSystem } from '../../packages/animate/src/humanoid/idle';
import { stroll, walkThere } from '../src/scenarios/stroll';
import { checks, failed, measure as metricsOf } from './metrics';
import type { Frame } from './frame';
import type { LogEntry } from '@drawcall/animate';
import { SCENARIOS } from '../src/scenarios';
import type { Scenario } from '../src/scenario';
import { Simulation } from '../src/simulation';
import { knownFailure } from '../scripts/run';

// Core-only migration scaffolding: exact remaining failures, tagged with their implementing stage.
// The complete straight stroll below has no expected failures; old-path checks remain strict.
type MigrationStage = 3 | 4;
const coreFailures: Record<string, { checks: Record<string, MigrationStage | readonly MigrationStage[]>; error?: { stage: MigrationStage; message: string } }> = {
  'stroll': { checks: {} },
  'pickup-shelf': {
    // Arrival succeeds; lowering/bowing toward the shelf needs stage 4. Behind-box reposition is stage 3.
    checks: {},
    error: { stage: 4, message: '3.267 s, "": legs cannot support root follower' },
  },
  'hand-over': { checks: {} },
  'knight-arming': {
    // Initial table turn passes. The plan assigns the later helm half-turn to stage 3; the loaded lance is stage 4.
    checks: { 'XCoM outside support (m)': 4, 'joint acceleration (°/s²)': [3, 4] },
  },
  'idle-life': { checks: {} },
  'reach-around': { checks: {} },
  'lift-heavy': {
    // Lower/bow toward the floor box, then loaded CoM and capture support.
    checks: { 'XCoM outside support (m)': 4 },
    error: { stage: 4, message: '1.133 s, "": legs cannot support root follower' },
  },
};

function measure(sc: Scenario, legs?: 'old' | 'core') {
  legSystem.path = legs ?? 'old';
  const sim = new Simulation(sc, undefined, true);
  const hash = createHash('sha256');
  const standing = sim.actors.map(() => 0);
  const step = () => {
    const before = sim.actors.map((h) => ({ go: h.asks.go, phases: h.feet.map((foot) => foot.phase) }));
    sim.step();
    sim.actors.forEach((h, i) => {
      // Count non-go standing lifts, including balancing and squaring adjustments.
      if (!before[i].go && !h.locomotion.moving && h.locomotion.velocity.length() < 0.05) {
        h.feet.forEach((foot, s) => { if (before[i].phases[s] === 'planted' && foot.phase === 'swing') standing[i]++; });
      }
      hash.update(JSON.stringify([h.pose.position(0), h.pose.skeleton.bones.map((_, b) => [h.pose.local(b), h.pose.load(b)]), h.feet, h.locomotion]));
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
  if (legs === 'core' && sc.id === 'knight-arming')
    expect(log.filter((entry) => entry.time < 15 && entry.check !== 'XCoM outside support (m)' && !knownFailure(entry))).toEqual([]);
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
  it(`${sc.id}: core migration parity failures`, () => {
    const core = measure(sc, 'core');
    console.log(`${sc.id}: core failures ${JSON.stringify(core.failures)}`);
    const expected = coreFailures[sc.id];
    expect(core.failures).toEqual({ checks: Object.keys(expected.checks).sort(), ...(expected.error ? { error: expected.error.message } : {}) });
  }, 20000);
}

function straight(legs: 'old' | 'core') {
  legSystem.path = legs;
  const sim = new Simulation(stroll({ radius: Infinity }), undefined, true);
  const previous = ['planted', 'planted'];
  const contacts = new Map<number, Vector3>();
  const heights: { t: number; y: number; knee: number; planted: boolean }[] = [], landings: number[] = [];
  let touchdown = 0, vertical = 0;
  function* frames(): Generator<Frame[]> {
    while (sim.t < sim.scenario.duration) {
      sim.step();
      const h = sim.actors[0];
      h.feet.forEach((foot, s) => {
        if (foot.phase === 'planted' && previous[s] === 'swing') {
          landings.push(sim.t);
          const bone = s === 0 ? INDEX.leftFoot : INDEX.rightFoot;
          const heel = h.pose.point(bone, h.proportions.sole.heel, new Vector3());
          const was = h.frame.prev2.point(bone, h.proportions.sole.heel, new Vector3());
          touchdown = Math.max(touchdown, heel.distanceTo(was) * 60);
          vertical = Math.max(vertical, Math.abs(heel.y - was.y) * 60);
          if (s === 0) contacts.set(sim.t, foot.position.clone());
        }
        previous[s] = foot.phase;
      });
      const knee = h.pose.position(INDEX.leftLowerLeg);
      const flexion = Math.PI - h.pose.position(INDEX.leftUpperLeg).clone().sub(knee).angleTo(h.pose.position(INDEX.leftFoot).clone().sub(knee));
      heights.push({ t: sim.t, y: h.pose.position(0).y, knee: flexion * 180 / Math.PI, planted: h.feet[0].phase === 'planted' });
      yield sim.actors.map((h) => ({ t: sim.t, h, asked: sim.stage.report.at(sim.t), solids: [] }));
    }
  }
  const metrics = metricsOf('stroll', frames());
  sim.step(); // Check the last completed pose too.
  const strides = metrics.gait.strides;
  const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const length = median(strides.map((s) => {
    const a = contacts.get(s.from), b = contacts.get(s.to);
    if (!a || !b) throw new Error('stride without touchdown positions');
    return a.distanceTo(b);
  }));
  const lows = landings.filter((t) => strides.some((s) => t >= s.from && t < s.to)).map((t) => {
    const near = heights.filter((s) => Math.abs(s.t - t) < 0.15);
    return near.reduce((low, s) => s.y < low.y ? s : low).t - t;
  });
  // [C] Perry/Winter: contact 0–5°, loading 15–20°, mid-stance 0–5°, swing ~60°.
  // Observe completed poses over steady left heel-strike cycles; 25–50% is the mid-stance window.
  const knees = strides.map(({ from, to }) => {
    const samples = heights.filter((s) => s.t >= from - 1e-9 && s.t <= to + 1e-9);
    const phase = (t: number) => (t - from) / (to - from);
    const mid = samples.filter((s) => phase(s.t) >= 0.25 && phase(s.t) <= 0.5).reduce((a, b) => a.knee < b.knee ? a : b);
    return { contact: samples[0].knee, loading: Math.max(...samples.filter((s) => phase(s.t) <= 0.15).map((s) => s.knee)),
      mid: mid.knee, swing: Math.max(...samples.filter((s) => !s.planted).map((s) => s.knee)),
      height: mid.y, ratio: mid.y / sim.actors[0].proportions.legLength };
  });
  const rates = metrics.gait.rates();
  if (!rates) throw new Error(`${legs}: no steady strides`);
  return { sim, metrics, rates, lows, knees, length, cadence: median(strides.map((s) => 120 / (s.to - s.from))), touchdown, vertical,
    bob: metrics.gait.summary(false, false)?.pelvisUp };
}

it('core stage 1: straight strides, start/stop, rest stance and final-pose development checks', () => {
  const old = straight('old'), core = straight('core');
  console.log('straight knee comparison', JSON.stringify([old, core].map((r, i) => ({ path: i ? 'core' : 'old',
    ...Object.fromEntries((['contact', 'loading', 'mid', 'swing', 'height', 'ratio'] as const).map((key) => [key, r.knees.map((s) => s[key]).sort((a, b) => a - b)[Math.floor(r.knees.length / 2)]])) }))));
  console.log('straight stroll comparison', JSON.stringify([old, core].map((result, i) => ({ path: i === 0 ? 'old' : 'core', stride: result.length, cadence: result.cadence, bob: result.bob, lowPointMs: [Math.min(...result.lows) * 1000, Math.max(...result.lows) * 1000], touchdown: result.touchdown, vertical: result.vertical, start: result.rates.start, stop: result.rates.stop }))));
  for (const result of [old, core]) {
    expect(result.sim.stage.done(), 'straight stroll finished').toBe(true);
    expect(checks(result.metrics, { strides: { straight: 3, curve: 0 }, startStop: null }).filter(failed)).toEqual([]);
    expect(result.sim.actors.flatMap((h) => [...h.log])).toEqual([]);
  }
  for (const stride of core.knees) expect(stride.mid).toBeLessThanOrEqual(10);
  expect(core.touchdown).toBeLessThanOrEqual(0.1);
  expect(core.bob).toBeGreaterThanOrEqual(0.035);
  expect(core.bob).toBeLessThanOrEqual(0.05);
  expect(core.lows.length).toBeGreaterThanOrEqual(6);
  for (const lag of core.lows) {
    expect(lag).toBeGreaterThanOrEqual(0);
    expect(lag).toBeLessThanOrEqual(0.12);
  }
  for (const transition of ['start', 'stop'] as const) for (const part of ['trunk', 'pelvis'] as const) {
    expect(core.rates[transition][part]).toBeLessThanOrEqual(1.25 * old.rates[transition][part]);
    expect(core.rates[transition][part]).toBeGreaterThanOrEqual(old.rates[transition][part] / 1.25);
  }

}, 20000);

for (const [name, scene, stages] of [
  ['curve', stroll(), {}],
  ['tighter arc', stroll({ radius: 2.4 }), {}],
  ['wider arc', stroll({ radius: 3.6 }), {}],
  ['left yaw', stroll({ yaw: 0.3 }), {}],
  ['right yaw', stroll({ yaw: -0.3 }), {}],
  ['quarter turn', stroll({ yaw: Math.PI / 2 }), { 'XCoM outside support (m)': 4 }],
  ['half turn', stroll({ yaw: Math.PI }), { 'XCoM outside support (m)': 4 }],
  ['turn in place', walkThere(new Vector3(), Math.PI), {}],
  ['turning arrival', walkThere(new Vector3(0, 0, 4), Math.PI), { 'XCoM outside support (m)': 4 }],
] as const) it(`core stage 2: ${name}`, async () => {
  // Let the runner flush progress between synchronous simulations.
  await new Promise<void>((resolve) => setImmediate(resolve));
  const result = measure(scene, 'core');
  console.log(name, result.failures);
  expect(result.failures).toEqual({ checks: Object.keys(stages).sort() });
}, 20000);
