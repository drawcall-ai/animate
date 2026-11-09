import { Vector3 } from 'three';
import { expect, it } from 'vitest';
import { Inertia, type Inertial } from '../../src/kernel/inertia';

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
