import { Vector3 } from 'three';
import { expect, it } from 'vitest';
import { Humanoid, createSkeletonModel, idle, type DrivenRoot } from '../../src';
import { forwardOf, leftOf } from '../../src/core/math';

const dt = 1 / 60;

/** A player-like root: velocity eased at 10 m/s², facing eased over 25 ms, as a game controller drives it. */
function drive(T: number, velocity: (t: number) => Vector3, yaw: (t: number) => number = () => 0, each?: (t: number, root: DrivenRoot, h: Humanoid<unknown>) => void) {
  const root: DrivenRoot = { position: new Vector3(), velocity: new Vector3(), yaw: 0 };
  const h = new Humanoid(createSkeletonModel(), (h) => idle(h, { legs: { root } }), { dev: true });
  let lag = 0, steps = 0;
  const phases = h.feet.map((foot) => foot.phase);
  for (let t = dt; t <= T + 1e-9; t += dt) {
    root.velocity.add(velocity(t).sub(root.velocity).clampLength(0, 10 * dt));
    root.position.addScaledVector(root.velocity, dt);
    root.yaw += (yaw(t) - root.yaw) * (1 - Math.exp(-dt / 0.025));
    h.update(dt);
    each?.(t, root, h);
    const hips = h.pose.position(0);
    lag = Math.max(lag, Math.hypot(hips.x - root.position.x, hips.z - root.position.z));
    h.feet.forEach((foot, s) => { if (foot.phase === 'swing' && phases[s] === 'planted') steps++; phases[s] = foot.phase; });
  }
  return { h, lag, steps, root };
}

const moving = (from: number, to: number, v: Vector3) => (t: number) => t > from && t < to ? v.clone() : new Vector3();

it.each([
  ['straight', moving(0.5, 4, forwardOf(0).multiplyScalar(1.4))],
  ['strafe left', moving(0.5, 4, leftOf(0).multiplyScalar(1.1))],
  ['strafe right', moving(0.5, 4, leftOf(0).multiplyScalar(-1.1))],
  ['back', moving(0.5, 4, forwardOf(0).multiplyScalar(-1.1))],
  ['diagonal', moving(0.5, 4, new Vector3(0.9, 0, 0.9))],
  ['sprint start and stop', (t: number) => forwardOf(0).multiplyScalar(t > 0.5 && t < 5 ? (t > 1.5 && t < 4 ? 3.5 : 1.4) : 0)],
  ['strafe reversals', (t: number) => t < 1 ? new Vector3() : t < 3 ? forwardOf(0).multiplyScalar(1.4) : t < 4.5 ? leftOf(0).multiplyScalar(1.1) : t < 6 ? leftOf(0).multiplyScalar(-1.1) : new Vector3()],
] as const)('%s: the body is the given root; feet step without sliding, crossing or a hard touchdown', (_, velocity) => {
  const { h, lag, steps } = drive(8, velocity);
  expect(lag).toBe(0);
  expect(steps).toBeGreaterThan(4);
  expect(h.log).toEqual([]);
  // (the balance bound is only noted for a driven body)
  expect(h.notes.every((note) => note.check === 'driven XCoM outside support (m)')).toBe(true);
  expect(h.feet.every((foot) => foot.phase === 'planted')).toBe(true);
  expect(h.gait.settled).toBe(true);
});

it.each([
  ['a quarter turn in place', Math.PI / 2],
  ['a half turn in place', 0.95 * Math.PI],
])('%s: the feet step round after the facing, the pelvis within reach of them', (_, turn) => {
  const { h, lag, steps } = drive(4, () => new Vector3(), (t) => t > 0.5 ? turn : 0);
  expect(lag).toBe(0);
  expect(steps).toBeGreaterThanOrEqual(2);
  expect(h.log).toEqual([]);
  expect(Math.abs(h.gait.facing - turn)).toBeLessThan(0.01);
  for (const [s, foot] of h.feet.entries()) expect(Math.abs(foot.yaw - turn - (s === 0 ? 0.12 : -0.12))).toBeLessThan(25 * Math.PI / 180);
});

it('walks a curve while turning, then stops and turns back in place', () => {
  const { h, lag } = drive(7, (t) => t > 0.5 && t < 4 ? forwardOf(t > 1 ? (t - 1) * 0.4 : 0).multiplyScalar(1.4) : new Vector3(),
    (t) => t < 1 ? 0 : t < 4 ? (t - 1) * 0.4 : t < 4.8 ? 1.2 : -0.6);
  expect(lag).toBe(0);
  expect(h.log).toEqual([]);
  expect(Math.abs(h.gait.facing + 0.6)).toBeLessThan(0.01);
});

it('crouches as asked: the pelvis let down smoothly, feet wider, steps still clean crouch-walking', () => {
  let low = Infinity, standing = 0;
  const { h } = drive(6, moving(2, 4.5, forwardOf(0).multiplyScalar(0.8)), () => 0, (t, root, h) => {
    root.crouch = Math.min(1, Math.max(0, (t - 0.5) / 0.25), Math.max(0, (5.25 - t) / 0.25));
    if (t < 0.5) standing = h.pose.position(0).y;
    if (t > 1 && t < 5) low = Math.min(low, h.pose.position(0).y);
  });
  expect(standing - low).toBeGreaterThan(0.33);
  expect(standing - low).toBeLessThan(0.42);
  expect(h.log).toEqual([]);
});

it.each([
  ['standing', 0],
  ['from a walk', 1.4],
  ['from a sprint', 3.5],
])('jumps %s: dips, flies the ballistic arc, lands it with the knees, without a slide or a knee snap', (_, speed) => {
  let pressed = NaN, off = NaN, landed = NaN, top = 0, standing = 0;
  const { h, lag } = drive(4, moving(0.3, 3, forwardOf(0).multiplyScalar(speed)), () => 0, (t, root, h) => {
    if (Math.abs(t - 1.5) < dt / 2) [root.jump, pressed, standing] = [2.5, t, h.pose.position(0).y];
    if (root.airborne && Number.isNaN(off)) off = t;
    if (!root.airborne && !Number.isNaN(off) && Number.isNaN(landed)) landed = t;
    if (root.airborne) top = Math.max(top, h.pose.position(0).y - standing);
  });
  expect(off - pressed).toBeLessThanOrEqual(0.12);
  expect(landed - off).toBeGreaterThan(0.45);
  expect(landed - off).toBeLessThan(0.6);
  expect(top).toBeGreaterThan(0.25);
  expect(lag).toBe(0);
  expect(h.log).toEqual([]);
});
