import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import { INDEX } from '../../packages/animate/src/humanoid/bones';
import { stroll, walkThere } from '../src/scenarios/stroll';
import { checks, failed, measure } from './metrics';
import type { Frame } from './frame';
import { Simulation } from '../src/simulation';
import { knownFailure, run } from '../scripts/run';

// A straight stroll's strides as people walk them, and strolls round bends and turns with an empty dev log (kept from the old-and-core
// parity tests when the old legs went, 2026-10-23: the bounds are the walk's own, not the old legs').
it('strolls straight on: knees near straight at mid-stance, soft touchdowns, a 3.5–5 cm bob lowest just after contact', () => {
  const sim = new Simulation(stroll({ radius: Infinity }), undefined, true);
  const previous = ['planted', 'planted'];
  const heights: { t: number; y: number; knee: number; planted: boolean }[] = [], landings: number[] = [];
  let touchdown = 0;
  function* frames(): Generator<Frame[]> {
    while (sim.t < sim.scenario.duration) {
      sim.step();
      const h = sim.actors[0];
      h.feet.forEach((foot, s) => {
        if (foot.phase === 'planted' && previous[s] === 'swing') {
          landings.push(sim.t);
          const bone = s === 0 ? INDEX.leftFoot : INDEX.rightFoot;
          const heel = h.pose.point(bone, h.proportions.sole.heel, new Vector3());
          touchdown = Math.max(touchdown, heel.distanceTo(h.frame.prev2.point(bone, h.proportions.sole.heel, new Vector3())) * 60);
        }
        previous[s] = foot.phase;
      });
      const knee = h.pose.position(INDEX.leftLowerLeg);
      const flexion = Math.PI - h.pose.position(INDEX.leftUpperLeg).clone().sub(knee).angleTo(h.pose.position(INDEX.leftFoot).clone().sub(knee));
      heights.push({ t: sim.t, y: h.pose.position(0).y, knee: flexion * 180 / Math.PI, planted: h.feet[0].phase === 'planted' });
      yield sim.actors.map((h) => ({ t: sim.t, h, asked: sim.stage.report.at(sim.t), solids: [] }));
    }
  }
  const metrics = measure('stroll', frames());
  sim.step(); // Check the last completed pose too.
  expect(sim.stage.done(), 'straight stroll finished').toBe(true);
  expect(checks(metrics, { strides: { straight: 3, curve: 0 }, startStop: null }).filter(failed)).toEqual([]);
  expect(sim.actors.flatMap((h) => [...h.log])).toEqual([]);
  const strides = metrics.gait.strides;
  // [C] Perry/Winter: mid-stance knee 0–5° (here ≤ 10°), over the steady left heel-strike cycles' 25–50%
  for (const { from, to } of strides) {
    const phase = (t: number) => (t - from) / (to - from);
    const mid = heights.filter((s) => s.t >= from - 1e-9 && s.t <= to + 1e-9 && phase(s.t) >= 0.25 && phase(s.t) <= 0.5);
    expect(Math.min(...mid.map((s) => s.knee))).toBeLessThanOrEqual(10);
  }
  expect(touchdown).toBeLessThanOrEqual(0.1);
  const bob = metrics.gait.summary(false, false)?.pelvisUp;
  expect(bob).toBeGreaterThanOrEqual(0.035);
  expect(bob).toBeLessThanOrEqual(0.05);
  // (the pelvis lowest within 0.12 s after each contact: the loading response)
  const lows = landings.filter((t) => strides.some((s) => t >= s.from && t < s.to)).map((t) => {
    const near = heights.filter((s) => Math.abs(s.t - t) < 0.15);
    return near.reduce((low, s) => s.y < low.y ? s : low).t - t;
  });
  expect(lows.length).toBeGreaterThanOrEqual(6);
  for (const lag of lows) {
    expect(lag).toBeGreaterThanOrEqual(0);
    expect(lag).toBeLessThanOrEqual(0.12);
  }
}, 20000);

for (const [name, scene] of [
  ['round a curve', stroll()],
  ['round a tighter arc', stroll({ radius: 2.4 })],
  ['round a wider arc', stroll({ radius: 3.6 })],
  ['setting off turned left', stroll({ yaw: 0.3 })],
  ['setting off turned right', stroll({ yaw: -0.3 })],
  ['setting off a quarter turn away', stroll({ yaw: Math.PI / 2 })],
  ['setting off facing away', stroll({ yaw: Math.PI })],
  ['turning round in place', walkThere(new Vector3(), Math.PI)],
  ['turning round on arrival', walkThere(new Vector3(0, 0, 4), Math.PI)],
] as const) it(`strolls ${name} with an empty dev log, and arrives`, () => {
  expect(run(scene).filter((entry) => !knownFailure(entry)).map((e) => `${e.check} ${e.where} @${e.time.toFixed(2)}`)).toEqual([]);
}, 20000);
