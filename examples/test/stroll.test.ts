import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import { cases } from '../../packages/animate/test/open';
import { stroll, walkThere } from '../src/scenarios/stroll';
import { checks, failed, measure } from './metrics';
import { frames, type Frame } from './frame';
import { Simulation } from '../src/simulation';
import { knownFailure, run } from '../scripts/run';

// A straight stroll's strides as people walk them, and strolls round bends and turns with an empty dev log.
// Open (expected to fail: fixed, it comes off the list): each heel still moves 8–9 mm in the two frames before its foot is planted
// (0.53 m/s; the baseline's touchdowns kept under 0.1 m/s).
const test = cases(['strolls straight on: soft touchdowns']);

/** a straight stroll, measured, with each touchdown's heel speed (m/s, over the two frames before it is planted) */
function straightStroll() {
  const sim = new Simulation(stroll({ radius: Infinity }), { dev: true });
  const previous = ['planted', 'planted'];
  const heights: { t: number; y: number; knee: number }[] = [], landings: number[] = [];
  // (each heel two frames back and one: its speed as it lands, over the last two frames)
  const heels: Vector3[][] = [[], []];
  let touchdown = 0;
  function* observed(): Generator<Frame[]> {
    for (const each of frames(sim)) {
      const person = each[0].h;
      person.feet.forEach((foot, side) => {
        const heel = person.joint(side === 0 ? 'leftHeel' : 'rightHeel');
        if (foot.phase === 'planted' && previous[side] === 'swing') {
          landings.push(sim.t);
          if (heels[side].length === 2) touchdown = Math.max(touchdown, heel.distanceTo(heels[side][0]) * 60);
        }
        heels[side] = [...heels[side], heel].slice(-2);
        previous[side] = foot.phase;
      });
      const hip = person.joint('leftUpperLeg'), knee = person.joint('leftLowerLeg'), ankle = person.joint('leftFoot');
      const flexion = Math.PI - hip.sub(knee).angleTo(ankle.sub(knee));
      heights.push({ t: sim.t, y: person.joint('hips').y, knee: (flexion * 180) / Math.PI });
      yield each;
    }
  }
  const metrics = measure('stroll', observed());
  return { sim, metrics, heights, landings, touchdown };
}

test('strolls straight on: soft touchdowns', () => {
  expect(straightStroll().touchdown).toBeLessThanOrEqual(0.1);
});

it('strolls straight on: knees near straight at mid-stance, a 3.5–5 cm bob lowest just after contact', () => {
  const { sim, metrics, heights, landings } = straightStroll();
  expect(sim.stage.done(), 'straight stroll finished').toBe(true);
  expect(checks(metrics, { strides: { straight: 3, curve: 0 }, startStop: null }).filter(failed)).toEqual([]);
  expect(sim.people.flatMap((person) => [...person.log])).toEqual([]);
  const strides = metrics.gait.strides;
  // Perry/Winter, recalled: mid-stance knee 0–5° (here ≤ 10°), over the steady left heel-strike cycles' 25–50%
  for (const { from, to } of strides) {
    const phase = (t: number) => (t - from) / (to - from);
    const mid = heights.filter((s) => s.t >= from - 1e-9 && s.t <= to + 1e-9 && phase(s.t) >= 0.25 && phase(s.t) <= 0.5);
    expect(Math.min(...mid.map((s) => s.knee))).toBeLessThanOrEqual(10);
  }
  const bob = metrics.gait.summary(false, false)?.pelvisUp;
  expect(bob).toBeGreaterThanOrEqual(0.035);
  expect(bob).toBeLessThanOrEqual(0.05);
  // (the pelvis lowest within 0.12 s after each contact: the loading response)
  const lows = landings.filter((t) => strides.some((s) => t >= s.from && t < s.to)).map((t) => {
    const near = heights.filter((s) => Math.abs(s.t - t) < 0.15);
    return near.reduce((low, s) => (s.y < low.y ? s : low)).t - t;
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
