import { Vector3 } from 'three';
import { idle } from '../../src/humanoid/idle';
import { expect, it } from 'vitest';
import { INDEX, Humanoid, createSkeletonModel, type DrivenRoot } from '../../src';
import { forwardOf, leftOf, wrapAngle, yawOf } from '../../src/core/math';
import type { Stepper } from '../../src/core/legs/stepper';
import { request } from '../../src/core/asks';

const dt = 1 / 60;

/** A player-like root: velocity eased at 10 m/s², facing eased over 25 ms, as a game controller drives it. */
function drive(T: number, velocity: (t: number) => Vector3, yaw: (t: number) => number = () => 0, each?: (t: number, root: DrivenRoot, h: Humanoid) => void) {
  const root: DrivenRoot = { position: new Vector3(), velocity: new Vector3(), yaw: 0 };
  const h = new Humanoid(createSkeletonModel(), (h) => idle(h, { root }), { idle: false, dev: true });
  let apart = 0, steps = 0;
  const phases = h.feet.map((foot) => foot.phase);
  for (let t = dt; t <= T + 1e-9; t += dt) {
    root.velocity.add(velocity(t).sub(root.velocity).clampLength(0, 10 * dt));
    root.position.addScaledVector(root.velocity, dt);
    root.yaw += (yaw(t) - root.yaw) * (1 - Math.exp(-dt / 0.025));
    h.update(dt);
    each?.(t, root, h);
    // (the hips about the root: swaying over the stance foot, shifted fore and aft as the trunk nods)
    const hips = h.pose.position(0);
    apart = Math.max(apart, Math.hypot(hips.x - root.position.x, hips.z - root.position.z));
    h.feet.forEach((foot, s) => { if (foot.phase === 'swing' && phases[s] === 'planted') steps++; phases[s] = foot.phase; });
  }
  return { h, apart, steps, root };
}

/** the hips' sway about the root at most (m): recalled (Orendurff et al. 2004), the pelvis sways 3–5 cm peak to peak walking */
const SWAY_BAND = 0.025;

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
  const { h, apart, steps } = drive(8, velocity);
  expect(apart).toBeLessThanOrEqual(SWAY_BAND);
  expect(steps).toBeGreaterThan(4);
  expect(h.log).toEqual([]);
  // (the balance bound is only noted for a driven body)
  expect(h.notes.every((note) => note.check === 'driven XCoM outside support (m)')).toBe(true);
  expect(h.feet.every((foot) => foot.phase === 'planted')).toBe(true);
  expect(h.locomotion.settled).toBe(true);
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
  const root: DrivenRoot = { position: new Vector3(), velocity: new Vector3(), yaw: 0 };
  const h = new Humanoid(createSkeletonModel(), (h) => idle(h, { root, seed: 3 }), { idle: false, dev: true });
  let lowest = Infinity, highest = -Infinity, left = 0, right = 0, over = -Infinity;
  for (let t = dt; t <= 40; t += dt) {
    request(h.asks, { steady });
    h.update(dt);
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
  expect(Math.abs(h.locomotion.facing - turn)).toBeLessThan(0.01);
  for (const [s, foot] of h.feet.entries()) expect(Math.abs(foot.yaw - turn - (s === 0 ? 0.12 : -0.12))).toBeLessThan(25 * Math.PI / 180);
});

it('walks a curve while turning, then stops and turns back in place', () => {
  const { h, apart } = drive(7, (t) => t > 0.5 && t < 4 ? forwardOf(t > 1 ? (t - 1) * 0.4 : 0).multiplyScalar(1.4) : new Vector3(),
    (t) => t < 1 ? 0 : t < 4 ? (t - 1) * 0.4 : t < 4.8 ? 1.2 : -0.6);
  expect(apart).toBeLessThanOrEqual(SWAY_BAND);
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
  const h = new Humanoid(createSkeletonModel(), (h) => idle(h, { root }), { idle: false, dev: { notes: true } });
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
  const { h, apart } = drive(4, moving(0.3, 3, forwardOf(0).multiplyScalar(speed)), () => 0, (t, _, h) => {
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
  expect(apart).toBeLessThanOrEqual(SWAY_BAND);
  expect(h.log).toEqual([]);
});

/** Each yaw's first stride harmonic against the stride's phase: peak to peak (rad) and phase (rad) of `y ≈ A cos(phase − at)`. */
function harmonic(samples: { phase: number; y: number }[]) {
  const c = samples.reduce((sum, s) => sum + s.y * Math.cos(s.phase), 0) * 2 / samples.length;
  const s = samples.reduce((sum, x) => sum + x.y * Math.sin(x.phase), 0) * 2 / samples.length;
  return { range: 2 * Math.hypot(c, s), at: Math.atan2(s, c) };
}

// (the references, peak to peak: the pelvis 8–10° walking (recalled), 14–17° running 2.8–3.9 m/s (Kovše et al. 2026) and 10–16° at
// 2.4–3.3 m/s (Perpiñá-Martínez et al. 2023); the shoulders 8.1° walking 1.5 m/s and 23.75° running 3 m/s (Pontzer et al. 2009), the
// thorax below them less; the two 149° apart walking and 94 ± 61° running (Pontzer), the pelvis turning the other way running
// (MacWilliams et al. 2014))
it.each([
  ['walking', 1.4, { pelvis: [6, 12], thorax: [5, 12], apart: [120, 180] }],
  ['running', 3.5, { pelvis: [10, 18], thorax: [15, 26], apart: [0, 90] }],
] as const)('%s: the pelvis and the thorax turn with the stride as people\'s do', (_, speed, band) => {
  const pelvis: { phase: number; y: number }[] = [], thorax: { phase: number; y: number }[] = [];
  const { h } = drive(6, moving(0.3, 6, forwardOf(0).multiplyScalar(speed)), () => 0, (t, _, h) => {
    if (t < 3) return;
    const phase = h.locomotion.phase;
    pelvis.push({ phase, y: yawOf(h.pose.rotation(0)) });
    thorax.push({ phase, y: yawOf(h.pose.rotation(INDEX.chest)) });
  });
  const p = harmonic(pelvis), c = harmonic(thorax), deg = 180 / Math.PI, apart = Math.abs(wrapAngle(c.at - p.at)) * deg;
  expect(p.range * deg).toBeGreaterThanOrEqual(band.pelvis[0]);
  expect(p.range * deg).toBeLessThanOrEqual(band.pelvis[1]);
  expect(c.range * deg).toBeGreaterThanOrEqual(band.thorax[0]);
  expect(c.range * deg).toBeLessThanOrEqual(band.thorax[1]);
  expect(apart).toBeGreaterThanOrEqual(band.apart[0]);
  expect(apart).toBeLessThanOrEqual(band.apart[1]);
  // (the turn the body's own: the look and the free arms read it)
  expect(h.locomotion.thoraxYaw).not.toBe(0);
  expect(h.log).toEqual([]);
});
