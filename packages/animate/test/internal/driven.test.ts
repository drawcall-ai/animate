import { expect, it } from 'vitest';
import { forwardOf, wrapAngle, yawOf } from '../kit/angles';
import { INDEX, dt, run } from '../kit/bodies';
import { SWAY_BAND, drive, driven, moving } from '../kit/driving';
import { airborne, personSelf } from './self';

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
  let thoraxYaw = 0;
  const { h } = drive(6, moving(0.3, 6, forwardOf(0).multiplyScalar(speed)), () => 0, (t, _, h, body) => {
    if (t < 3) return;
    const phase = personSelf(body).gaitState.phase;
    pelvis.push({ phase, y: yawOf(h.pose.rotation(0)) });
    thorax.push({ phase, y: yawOf(h.pose.rotation(INDEX.chest)) });
    thoraxYaw = personSelf(body).gaitState.thoraxYaw;
  });
  const p = harmonic(pelvis), c = harmonic(thorax), deg = 180 / Math.PI, apart = Math.abs(wrapAngle(c.at - p.at)) * deg;
  expect(p.range * deg).toBeGreaterThanOrEqual(band.pelvis[0]);
  expect(p.range * deg).toBeLessThanOrEqual(band.pelvis[1]);
  expect(c.range * deg).toBeGreaterThanOrEqual(band.thorax[0]);
  expect(c.range * deg).toBeLessThanOrEqual(band.thorax[1]);
  expect(apart).toBeGreaterThanOrEqual(band.apart[0]);
  expect(apart).toBeLessThanOrEqual(band.apart[1]);
  // (the turn the body's own: the look and the free arms read it)
  expect(thoraxYaw).not.toBe(0);
  expect(h.log).toEqual([]);
});

it.each([
  ['standing', 0],
  ['from a walk', 1.4],
  ['from a sprint', 3.5],
])('jumps %s: dips, flies the ballistic arc, lands it with the knees, without a slide or a knee snap', (_, speed) => {
  let pressed = NaN, off = NaN, landed = NaN, top = 0, standing = 0;
  const { h, apart } = drive(4, moving(0.3, 3, forwardOf(0).multiplyScalar(speed)), () => 0, (t, root, h, body) => {
    root.jump = Math.abs(t - 1.5 + dt) < dt / 2 ? 2.5 : undefined;
    if (Math.abs(t - 1.5) < dt / 2) [pressed, standing] = [t, h.pose.position(0).y];
    if (airborne(body) && Number.isNaN(off)) off = t;
    if (!airborne(body) && !Number.isNaN(off) && Number.isNaN(landed)) landed = t;
    if (airborne(body)) top = Math.max(top, h.pose.position(0).y - standing);
  });
  expect(off - pressed).toBeLessThanOrEqual(0.12);
  expect(landed - off).toBeGreaterThan(0.45);
  expect(landed - off).toBeLessThan(0.6);
  expect(top).toBeGreaterThan(0.25);
  expect(apart).toBeLessThanOrEqual(SWAY_BAND);
  expect(h.log).toEqual([]);
});

it.each([0, 0.6, -0.6])('lands on the actual support at %s m and absorbs the impact with its knees', (level) => {
  const floor = (_x: number, z: number) => z > 1 ? level : 0;
  const { root, body, h } = driven(floor);
  const standing = h.pose.position(0).y;
  root.support = null;
  root.position.set(0, 1.2, 2);
  root.velocity.y = -3;
  run(body, 0.2);
  while (root.position.y > level + 0.001) {
    root.position.y = Math.max(level, root.position.y + root.velocity.y * dt);
    body.update(dt);
    expect(airborne(body)).toBe(true);
    expect(body.feet.every((foot) => !foot.planted)).toBe(true);
  }
  root.support = root.position.clone();
  root.velocity.y = 0;
  let lowest = Infinity;
  run(body, 0.4, () => {
    expect(airborne(body)).toBe(false);
    lowest = Math.min(lowest, h.pose.position(0).y);
  });
  expect(standing + level - lowest).toBeGreaterThan(0.04);
  expect(standing + level - lowest).toBeLessThan(0.2);
  run(body, 0.6);
  expect(Math.abs(h.pose.position(0).y - level - standing)).toBeLessThan(0.015);
  expect(body.feet.every((foot) => foot.planted)).toBe(true);
  for (const index of [INDEX.leftFoot, INDEX.rightFoot]) {
    expect(Math.abs(h.pose.position(index).y - level - h.proportions.ankleHeight)).toBeLessThan(0.01);
  }
});

