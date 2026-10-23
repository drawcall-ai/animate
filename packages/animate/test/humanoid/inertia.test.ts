import { Euler, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { expect, it } from 'vitest';
import { Body } from '../../src/core/body';
import { createSkeletonModel, human, INDEX, walkTo, type Frame, type Humanoid } from '../../src';
import { idle } from '../../src/humanoid/idle';

const dt = 1 / 60, DEG = Math.PI / 180;
/** half a step walking at 1.3 m/s (sub-steps: ~0.47 s a step, ~2.1 steps/s) */
const STEP = 15;

/** a person walking 5 m ahead from standing and stopping there: its chest's pitch (rad, + forward) and its ground speed each sub-step */
function walk(leaning: boolean) {
  const species = human(createSkeletonModel());
  if (!leaning) delete species.inertia;
  const h = new Body(species, (b) => function* () {
    yield* parallel<Frame>('all', idle(b), walkTo(b, { to: new Vector3(0, 0, 5) }));
  }, { idle: false, dev: true }) as Humanoid;
  const pitch: number[] = [], speed: number[] = [];
  for (let t = 0; t < 8; t += dt) {
    h.update(dt);
    pitch.push(new Euler().setFromQuaternion(h.pose.rotation(INDEX.chest), 'YXZ').x);
    speed.push(h.locomotion.velocity.z);
  }
  return { pitch, speed, log: h.log };
}

// (setting off, the trunk leans into the walk's first steps about as far as atan(a / g): ~7° at ~1 m/s² — read: Leteneur et al. 2013,
// PLoS ONE 8:e55256; stopping, it leans back but is held nearly upright — read: Harper et al. 2022, Sports Med 52:2321 — and swings a
// little past upright as it comes to rest; measured against the same walk without the lean)
it('leans into setting off and back from stopping, as far as people do, swings a little past upright and settles', () => {
  const leaning = walk(true), upright = walk(false);
  expect(leaning.log).toEqual([]);
  // (each walk's pitch averaged over a step (±`STEP` sub-steps), so the stride's own nod drops out: the lean shifts the centre of mass, and the
  // legs, keeping it over the feet, step a little off the upright walk's — subtracted frame by frame, the two nods read as ±2° of lean)
  const smooth = (pitch: number[]) => pitch.map((_, i) => { const window = pitch.slice(Math.max(0, i - STEP), i + STEP + 1); return window.reduce((a, b) => a + b, 0) / window.length; });
  const averaged = smooth(upright.pitch);
  const lean = smooth(leaning.pitch).map((x, i) => x - averaged[i]);
  const accel = leaning.speed.map((v, i) => i ? (v - leaning.speed[i - 1]) / dt : 0);
  const stopped = leaning.speed.findIndex((v, i) => i > 60 && v < 1e-3);
  // (setting off at its most; stopping, as it slows over its last second)
  const [starting, stopping] = [Math.max(...accel.slice(0, 120)), leaning.speed[stopped - 60] / 1];
  const ahead = Math.max(...lean.slice(0, 150)), back = Math.min(...lean.slice(stopped - 60, stopped + 30));
  // (setting off: 1.2 m/s² asks 7°; leaning 0.9 of it, felt over a step)
  expect(ahead / Math.atan2(starting, 9.81)).toBeGreaterThan(0.6);
  expect(ahead / Math.atan2(starting, 9.81)).toBeLessThan(1.1);
  expect(ahead / DEG).toBeGreaterThan(4);
  expect(ahead / DEG).toBeLessThan(8);
  // (stopping: back, but nearly upright — a third of it at most)
  expect(back).toBeLessThan(-0.5 * DEG);
  expect(-back / Math.atan2(stopping, 9.81)).toBeLessThan(0.4);
  // (a little past upright once stopped, and settled a second and a half on)
  const past = Math.max(...lean.slice(stopped, stopped + 90));
  expect(past).toBeGreaterThan(0.05 * -back);
  expect(past).toBeLessThan(-back);
  expect(Math.max(...lean.slice(stopped + 90).map(Math.abs))).toBeLessThan(0.3 * DEG);
});
