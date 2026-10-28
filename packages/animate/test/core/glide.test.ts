import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Glide } from '../../src/kernel/glide';

const dt = 1 / 60;

/** each step's speed of a glide of `seconds` from rest at the origin to `goal(k)` (moving at `going`) */
function glided(seconds: number, goal: (k: number) => Vector3, going = new Vector3(), steps = Math.round(seconds / dt) + 30) {
  const glide = new Glide(seconds);
  const out = { position: new Vector3(), velocity: new Vector3() };
  const at: Vector3[] = [];
  for (let k = 0; k < steps; k++) at.push(glide.step(new Vector3(), new Vector3(), goal(k), going, dt, out).position.clone());
  return { at, speeds: at.slice(1).map((p, k) => p.distanceTo(at[k]) / dt) };
}

describe('Glide', () => {
  it('goes to a still goal in its time along a bell of speed: no snap as it sets off, its peak 1.875× its mean, at rest there', () => {
    const goal = new Vector3(0.5, 0.1, 0.2);
    const { at, speeds } = glided(1, () => goal);
    const peak = Math.max(...speeds);
    expect(peak / (goal.length() / 1)).toBeCloseTo(1.875, 1);
    // (setting off: its speed grows from nothing, a little each step)
    expect(speeds[0]).toBeLessThan(0.02);
    expect(speeds[3]).toBeLessThan(0.1 * peak);
    // (one bell, there by its time and still)
    const top = speeds.indexOf(peak);
    expect(speeds.slice(0, top).every((v, k) => k === 0 || v >= speeds[k - 1] - 1e-9)).toBe(true);
    expect(at[Math.round(1 / dt)].distanceTo(goal)).toBeLessThan(1e-6);
    expect(speeds.at(-1)).toBeLessThan(1e-6);
  });

  it('follows a goal that moves on, arriving with it', () => {
    const going = new Vector3(0.3, 0, 0);
    const goal = (k: number) => new Vector3(0.4, 0, 0.3).addScaledVector(going, k * dt);
    const { at } = glided(0.8, goal, going, 90);
    expect(at[60].distanceTo(goal(60))).toBeLessThan(0.02);
    expect(at[89].distanceTo(goal(89))).toBeLessThan(1e-6);
  });
});
