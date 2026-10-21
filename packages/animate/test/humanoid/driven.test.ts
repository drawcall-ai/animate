import { Vector3 } from 'three';
import { person } from '../person';
import { idle } from '../../src/humanoid/idle';
import { expect, it } from 'vitest';
import { type Humanoid, createSkeletonModel, type DrivenRoot } from '../../src';
import { forwardOf, leftOf } from '../../src/core/math';
import type { Stepper } from '../../src/core/legs/stepper';

const dt = 1 / 60;

/** A player-like root: velocity eased at 10 m/s², facing eased over 25 ms, as a game controller drives it. */
function drive(T: number, velocity: (t: number) => Vector3, yaw: (t: number) => number = () => 0, each?: (t: number, root: DrivenRoot, h: Humanoid) => void) {
  const root: DrivenRoot = { position: new Vector3(), velocity: new Vector3(), yaw: 0 };
  const h = person(createSkeletonModel(), (h) => idle(h, { root }), { idle: false, dev: true });
  let lag = 0, sway = 0, steps = 0;
  const phases = h.feet.map((foot) => foot.phase);
  for (let t = dt; t <= T + 1e-9; t += dt) {
    root.velocity.add(velocity(t).sub(root.velocity).clampLength(0, 10 * dt));
    root.position.addScaledVector(root.velocity, dt);
    root.yaw += (yaw(t) - root.yaw) * (1 - Math.exp(-dt / 0.025));
    h.update(dt);
    each?.(t, root, h);
    const hips = h.pose.position(0);
    // (the root exact along the facing; the hips swaying across it only)
    const off = new Vector3(hips.x - root.position.x, 0, hips.z - root.position.z);
    lag = Math.max(lag, Math.abs(off.dot(forwardOf(h.locomotion.facing))));
    sway = Math.max(sway, Math.abs(off.dot(leftOf(h.locomotion.facing))));
    h.feet.forEach((foot, s) => { if (foot.phase === 'swing' && phases[s] === 'planted') steps++; phases[s] = foot.phase; });
  }
  return { h, lag, sway, steps, root };
}

/** the hips' sway about the root at most (m): ±1.4 cm walking */
const SWAY_BAND = 0.0141;

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
  const { h, lag, sway, steps } = drive(8, velocity);
  expect(lag).toBeLessThan(1e-9);
  expect(sway).toBeLessThanOrEqual(SWAY_BAND);
  expect(steps).toBeGreaterThan(4);
  expect(h.log).toEqual([]);
  // (the balance bound is only noted for a driven body)
  expect(h.notes.every((note) => note.check === 'driven XCoM outside support (m)')).toBe(true);
  expect(h.feet.every((foot) => foot.phase === 'planted')).toBe(true);
  expect(h.locomotion.settled).toBe(true);
});

it.each([
  ['a quarter turn in place', Math.PI / 2],
  ['a half turn in place', 0.95 * Math.PI],
])('%s: the feet step round after the facing, the pelvis within reach of them', (_, turn) => {
  const { h, lag, steps } = drive(4, () => new Vector3(), (t) => t > 0.5 ? turn : 0);
  expect(lag).toBeLessThan(1e-9);
  expect(steps).toBeGreaterThanOrEqual(2);
  expect(h.log).toEqual([]);
  expect(Math.abs(h.locomotion.facing - turn)).toBeLessThan(0.01);
  for (const [s, foot] of h.feet.entries()) expect(Math.abs(foot.yaw - turn - (s === 0 ? 0.12 : -0.12))).toBeLessThan(25 * Math.PI / 180);
});

it('walks a curve while turning, then stops and turns back in place', () => {
  const { h, lag } = drive(7, (t) => t > 0.5 && t < 4 ? forwardOf(t > 1 ? (t - 1) * 0.4 : 0).multiplyScalar(1.4) : new Vector3(),
    (t) => t < 1 ? 0 : t < 4 ? (t - 1) * 0.4 : t < 4.8 ? 1.2 : -0.6);
  expect(lag).toBeLessThan(1e-9);
  expect(h.log).toEqual([]);
  expect(Math.abs(h.locomotion.facing + 0.6)).toBeLessThan(0.01);
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

// (a player's crouch key is a step in the root's crouch: the legs take it at their own pace, the feet on the floor going down and coming up)
it('crouches on a key press and stands on its release, the feet kept to the floor', () => {
  const { h } = drive(4, () => new Vector3(), () => 0, (t, root) => { root.crouch = t > 0.5 && t < 2.5 ? 1 : 0; });
  expect(h.log).toEqual([]);
  expect((h.stepper as Stepper).crouch).toBe(0);
});
// (crouched: turns on the spot, a walk back and a strafe at a crouch-walk's pace, eased in over 0.25 s as a game does)
it.each([
  ['a quarter turn on the spot', () => new Vector3(), (t: number) => t > 1.5 ? Math.PI / 2 : 0],
  ['a half turn on the spot', () => new Vector3(), (t: number) => t > 1.5 ? 0.95 * Math.PI : 0],
  ['a walk back', moving(1, 4, forwardOf(0).multiplyScalar(-0.8)), () => 0],
  ['a strafe', moving(1, 4, leftOf(0).multiplyScalar(0.8)), () => 0],
] as const)('crouched, %s: clean', (_, velocity, yaw) => {
  const { h } = drive(6, velocity, yaw, (t, root) => { root.crouch = Math.min(1, Math.max(0, (t - 0.3) / 0.25), Math.max(0, (5 - t) / 0.25)); });
  expect(h.log).toEqual([]);
});
// (a driven body's balance is its player's: its XCoM past its feet is a note, recorded only when asked for)
it('notes a driven XCoM only when asked', () => {
  // (a sprint stopped dead: the root halts at once, the body's momentum carries its centre of mass on past its feet)
  const sprint = (t: number) => forwardOf(0).multiplyScalar(t > 0.5 && t < 3 ? 3.5 : 0);
  expect(drive(4, sprint).h.notes).toEqual([]);
  const root: DrivenRoot = { position: new Vector3(), velocity: new Vector3(), yaw: 0 };
  const h = person(createSkeletonModel(), (h) => idle(h, { root }), { idle: false, dev: { notes: true } });
  for (let t = dt; t <= 4; t += dt) {
    root.velocity.copy(sprint(t));
    root.position.addScaledVector(root.velocity, dt);
    h.update(dt);
  }
  expect(h.notes.length).toBeGreaterThan(0);
  expect(h.notes.every((note) => note.check === 'driven XCoM outside support (m)')).toBe(true);
});

it.each([
  ['standing', 0],
  ['from a walk', 1.4],
  ['from a sprint', 3.5],
])('jumps %s: dips, flies the ballistic arc, lands it with the knees, without a slide or a knee snap', (_, speed) => {
  let pressed = NaN, off = NaN, landed = NaN, top = 0, standing = 0;
  const { h, lag } = drive(4, moving(0.3, 3, forwardOf(0).multiplyScalar(speed)), () => 0, (t, _, h) => {
    const legs = h.stepper!;
    if (Math.abs(t - 1.5) < dt / 2) { legs.jump(2.5); [pressed, standing] = [t, h.pose.position(0).y]; }
    if (legs.airborne && Number.isNaN(off)) off = t;
    if (!legs.airborne && !Number.isNaN(off) && Number.isNaN(landed)) landed = t;
    if (legs.airborne) top = Math.max(top, h.pose.position(0).y - standing);
  });
  expect(off - pressed).toBeLessThanOrEqual(0.12);
  expect(landed - off).toBeGreaterThan(0.45);
  expect(landed - off).toBeLessThan(0.6);
  expect(top).toBeGreaterThan(0.25);
  expect(lag).toBeLessThan(1e-9);
  expect(h.log).toEqual([]);
});
