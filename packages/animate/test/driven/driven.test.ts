import { Vector3 } from 'three';
import type { Root } from '../../src/index';
import { expect, it } from 'vitest';
import { INDEX, dt, readings, person, feetOf } from '../kit/bodies';
import { forwardOf, leftOf } from '../kit/angles';
import { SWAY_BAND, drive, moving } from '../kit/driving';


it.each([
  ['straight', moving(0.5, 4, forwardOf(0).multiplyScalar(1.4))],
  ['strafe left', moving(0.5, 4, leftOf(0).multiplyScalar(1.1))],
  ['strafe right', moving(0.5, 4, leftOf(0).multiplyScalar(-1.1))],
  ['back', moving(0.5, 4, forwardOf(0).multiplyScalar(-1.1))],
  ['diagonal', moving(0.5, 4, new Vector3(0.9, 0, 0.9))],
  ['sprint start and stop', (t: number) => forwardOf(0).multiplyScalar(t > 0.5 && t < 5 ? (t > 1.5 && t < 4 ? 3.5 : 1.4) : 0)],
  ['strafe reversals', (t: number) =>
    t < 1 ? new Vector3() : t < 3 ? forwardOf(0).multiplyScalar(1.4) : t < 4.5 ? leftOf(0).multiplyScalar(1.1) : t < 6 ? leftOf(0).multiplyScalar(-1.1) : new Vector3()],
] as const)('%s: the body is the given root; feet step without sliding, crossing or a hard touchdown', (_, velocity) => {
  const { h, apart, steps } = drive(8, velocity);
  expect(apart).toBeLessThanOrEqual(SWAY_BAND);
  expect(steps).toBeGreaterThan(4);
  expect(h.log).toEqual([]);
  expect(feetOf(h).every((foot) => foot.phase === 'planted')).toBe(true);
  expect(h.settled).toBe(true);
});

// (a player's stop: the root brakes at 10 m/s², 0.1 s for a walk — the trunk leans to it as its own legs would feel it, over a step, not
// a lurch after it, and the pelvis rising to its standing height arrives braked — before, the head was thrown 8.5° forward and back in
// 0.25 s stopping a back-pedal, 45 m/s² off the hips, and the pelvis came to its height with a 52 m/s² jolt)
it.each([
  ['back-pedalling', forwardOf(0).multiplyScalar(-1.1)],
  ['walking', forwardOf(0).multiplyScalar(1.4)],
  ['side-stepping', leftOf(0).multiplyScalar(1.1)],
] as const)('stops %s without a jolt: the head moves with the hips, the pelvis rises braked', (_, velocity) => {
  const heads: Vector3[] = [], hips: Vector3[] = [];
  drive(4.5, moving(0.5, 3, velocity), () => 0, (t, root, h) => {
    if (t < 3 - dt / 2) return;
    heads.push(h.pose.position(INDEX.head).clone());
    hips.push(h.pose.position(INDEX.hips).clone());
  });
  const accel = (p: Vector3[], i: number) => p[i + 1].clone().sub(p[i].clone().multiplyScalar(2)).add(p[i - 1]).divideScalar(dt * dt);
  let trunk = 0, arrival = 0;
  for (let i = 1; i < heads.length - 1; i++) {
    trunk = Math.max(trunk, accel(heads, i).sub(accel(hips, i)).length());
    // (slowing as it rises to a stop: braked within the stepper's 20 m/s²)
    if (hips[i].y > hips[i - 1].y && hips[i + 1].y >= hips[i].y - 1e-9) arrival = Math.max(arrival, -accel(hips, i).y);
  }
  expect(trunk).toBeLessThan(10);
  expect(arrival).toBeLessThan(20.5);
});

// (a player standing at ease: it breathes, sways and now and then shifts its weight onto a foot — not frozen, its centre of mass over
// the feet; holding still to aim, its breathing and sway keep 30% (Era et al. 1996, as `Life` has it) — the hips within that share of
// quiet stance's ≤ 1 cm sway (Winter 1995), no weight shift)
it.each([[0], [1]] as const)('stands alive, holding still as asked (steady %s)', (steady) => {
  const root: Root = { position: new Vector3(), velocity: new Vector3(), yaw: 0 };
  const body = person({ drive: () => root, life: { seed: 3, steady }, dev: true }), h = readings(body);
  let lowest = Infinity, highest = -Infinity, left = 0, right = 0, over = -Infinity;
  for (let t = dt; t <= 40; t += dt) {
    body.update(dt);
    if (t < 2) continue;
    // (the thorax's pitch: the chest as it is turned in the world)
    const pitch = Math.asin(-new Vector3(0, 0, 1).applyQuaternion(h.pose.rotation(INDEX.chest)).y);
    [lowest, highest] = [Math.min(lowest, pitch), Math.max(highest, pitch)];
    const off = h.pose.position(0).clone().sub(root.position);
    [left, right] = [Math.max(left, off.x), Math.min(right, off.x)];
    // (the centre of mass across, past the ankle it shifts onto)
    const com = h.pose.com(new Vector3()).x, ankles = [INDEX.leftFoot, INDEX.rightFoot].map((bone) => h.pose.position(bone).x);
    over = Math.max(over, com - Math.max(...ankles), Math.min(...ankles) - com);
  }
  const breath = (highest - lowest) * 180 / Math.PI;
  expect(h.log).toEqual([]);
  expect(over).toBeLessThan(0);
  if (steady) {
    // (~30% of the 2–3° at ease, no weight shift)
    expect(breath).toBeLessThan(1.2);
    expect(Math.max(left, -right)).toBeLessThan(0.3 * 0.01);
  } else {
    expect(breath).toBeGreaterThan(1.5);
    expect(Math.max(left, -right)).toBeGreaterThan(0.008);
  }
});

it.each([
  ['a quarter turn in place', Math.PI / 2],
  ['a half turn in place', 0.95 * Math.PI],
])('%s: the feet step round after the facing, the pelvis within reach of them', (_, turn) => {
  const { h, apart, steps } = drive(4, () => new Vector3(), (t) => t > 0.5 ? turn : 0);
  expect(apart).toBeLessThanOrEqual(SWAY_BAND);
  expect(steps).toBeGreaterThanOrEqual(2);
  expect(h.log).toEqual([]);
  expect(Math.abs(h.facing - turn)).toBeLessThan(0.01);
  for (const [s, foot] of feetOf(h).entries()) expect(Math.abs(foot.yaw - turn - (s === 0 ? 0.12 : -0.12))).toBeLessThan(25 * Math.PI / 180);
});

it('walks a curve while turning, then stops and turns back in place', () => {
  const { h, apart } = drive(7, (t) => t > 0.5 && t < 4 ? forwardOf(t > 1 ? (t - 1) * 0.4 : 0).multiplyScalar(1.4) : new Vector3(),
    (t) => t < 1 ? 0 : t < 4 ? (t - 1) * 0.4 : t < 4.8 ? 1.2 : -0.6);
  expect(apart).toBeLessThanOrEqual(SWAY_BAND);
  expect(h.log).toEqual([]);
  expect(Math.abs(h.facing + 0.6)).toBeLessThan(0.01);
});

// (a player's crouch key is a step in the root's crouch: the legs take it at their own pace, the feet on the floor going down and coming up)
it('crouches on a key press and stands on its release, the feet kept to the floor', () => {
  const { h } = drive(4, () => new Vector3(), () => 0, (t, root) => { root.crouch = t > 0.5 && t < 2.5 ? 1 : 0; });
  expect(h.log).toEqual([]);
  // (up again: its hips where they stand)
  expect(h.proportions.hipHeight - h.pose.position(0).y).toBeLessThan(0.02);
});
// (crouched: a crouch-walk, turns on the spot, a walk back and a strafe at a crouch-walk's pace, eased in over 0.25 s as a game does; the
// pelvis 0.37 m down standing, a stride's dip further walking — and a strafe's further still, its side-step taking the feet some half a
// metre apart: measured, 0.40 m walking ahead or back, 0.43 m strafing)
it.each([
  ['a walk ahead', moving(2, 4.5, forwardOf(0).multiplyScalar(0.8)), () => 0, 0.5, 5.25, 0.42],
  ['a quarter turn on the spot', () => new Vector3(), (t: number) => t > 1.5 ? Math.PI / 2 : 0, 0.3, 5, 0.42],
  ['a half turn on the spot', () => new Vector3(), (t: number) => t > 1.5 ? 0.95 * Math.PI : 0, 0.3, 5, 0.42],
  ['a walk back', moving(1, 4, forwardOf(0).multiplyScalar(-0.8)), () => 0, 0.3, 5, 0.42],
  ['a strafe', moving(1, 4, leftOf(0).multiplyScalar(0.8)), () => 0, 0.3, 5, 0.45],
] as const)('crouched, %s: the pelvis let down smoothly, steps still clean', (_, velocity, yaw, down, up, deepest) => {
  let low = Infinity, standing = 0;
  const { h } = drive(6, velocity, yaw, (t, root, h) => {
    root.crouch = Math.min(1, Math.max(0, (t - down) / 0.25), Math.max(0, (up - t) / 0.25));
    if (t < down) standing = h.pose.position(0).y;
    if (t > down + 0.5 && t < up - 0.25) low = Math.min(low, h.pose.position(0).y);
  });
  expect(standing - low).toBeGreaterThan(0.33);
  expect(standing - low).toBeLessThan(deepest);
  expect(h.log).toEqual([]);
});



it('a leap asked on the very first sub-step is taken', () => {
  let asked = false;
  const body = person({ drive: () => {
    const jump = asked ? undefined : 2.5;
    asked = true;
    return { position: new Vector3(), velocity: new Vector3(), yaw: 0, jump };
  } }), h = readings(body);
  let highest = 0;
  for (let t = 0; t < 1; t += dt) {
    body.update(dt);
    highest = Math.max(highest, h.pose.position(0).y);
  }
  expect(highest).toBeGreaterThan(h.proportions.hipHeight + 0.1);
});
