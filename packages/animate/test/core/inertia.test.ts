import { Vector3 } from 'three';
import { expect, it } from 'vitest';
import { Inertia, type Inertial } from '../../src/kernel/inertia';
import { GRAVITY } from '../../src/kernel/math';

const dt = 1 / 60, LEAN: Inertial = { ahead: 0.9, back: 0.3, roll: 0.6, most: 0.35, frequency: 0.8, damping: 0.7 };

/** the lean over `seconds` of a root whose velocity is `velocity(t)`, facing `yaw(t)` */
function lean(velocity: (t: number) => Vector3, seconds: number, yaw = (_t: number) => 0) {
  const inertia = new Inertia(LEAN), pitch: number[] = [], roll: number[] = [];
  for (let t = 0; t < seconds; t += dt) {
    inertia.step(velocity(t), yaw(t), dt);
    pitch.push(inertia.pitch);
    roll.push(inertia.roll);
  }
  return { pitch, roll };
}

it('leans into a steady acceleration as far as its share of atan(a / g): forward speeding up, a third as far back slowing down', () => {
  const a = 1.2, up = lean((t) => new Vector3(0, 0, a * t), 4).pitch, down = lean((t) => new Vector3(0, 0, 5 - a * t), 4).pitch;
  const most = LEAN.most * Math.tanh(LEAN.ahead * Math.atan2(a, GRAVITY) / LEAN.most);
  expect(up[up.length - 1]).toBeCloseTo(most, 3);
  expect(down[down.length - 1]).toBeCloseTo(-LEAN.most * Math.tanh(LEAN.back * Math.atan2(a, GRAVITY) / LEAN.most), 3);
});

it('leans into a bend: rolled toward the inside, as far as its share of atan(v² / r g)', () => {
  // (round a 3 m circle to the left at 1.5 m/s, facing the way: the left side down)
  const v = 1.5, r = 3, { roll } = lean((t) => new Vector3(Math.sin(v * t / r), 0, Math.cos(v * t / r)).multiplyScalar(v), 6, (t) => v * t / r);
  expect(roll[roll.length - 1]).toBeCloseTo(-LEAN.most * Math.tanh(LEAN.roll * Math.atan2(v * v / r, GRAVITY) / LEAN.most), 3);
});

it('takes a stop over about a step and overshoots it a little: the lean back swings past upright and settles', () => {
  // (walking at 1.3 m/s, brought to a dead stop within a sixth of a second)
  const { pitch } = lean((t) => new Vector3(0, 0, Math.max(0, 1.3 * Math.min(1, (1 - t) / 0.17))), 4);
  const back = Math.min(...pitch), at = pitch.indexOf(back), past = Math.max(...pitch.slice(at));
  expect(back).toBeLessThan(-0.02);
  // (no faster than a step: its most back no sooner than 0.1 s into the stop; ζ 0.7's ~5% overshoot, swinging forward past upright
  // with the share it leans forward with — three times the back's: ~14% — settled by 2 s)
  expect(at * dt - 0.83).toBeGreaterThan(0.1);
  expect(past / -back).toBeGreaterThan(0.05);
  expect(past / -back).toBeLessThan(0.2);
  expect(Math.abs(pitch[Math.round(3 / dt)])).toBeLessThan(0.05 * -back);
  // (smooth: a stop as hard as this — 7.6 m/s² — leans it no faster than 30°/s, its rate changing by no more than 400°/s²: far within the
  // trunk joints' dev ceilings, 1200°/s and 40000°/s²)
  const rates = pitch.slice(1).map((x, i) => (x - pitch[i]) / dt), DEG = Math.PI / 180;
  expect(Math.max(...rates.map(Math.abs))).toBeLessThan(30 * DEG);
  expect(Math.max(...rates.slice(1).map((x, i) => Math.abs(x - rates[i]) / dt))).toBeLessThan(400 * DEG);
});

it('spawned on the move, it does not lean from nothing', () => {
  const { pitch, roll } = lean(() => new Vector3(0.5, 0, 1.3), 1);
  expect(Math.max(...pitch.map(Math.abs), ...roll.map(Math.abs))).toBe(0);
});
