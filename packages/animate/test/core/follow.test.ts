import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { follow, followRotation, type FollowOptions } from '../../src';
import { turn } from './rigs';

const dt = 1 / 60;

/** `steps` steps of `follow` from a history moving at `velocity` through `start`, toward `target(k)` */
function run(start: Vector3, velocity: Vector3, target: (k: number) => Vector3, options: (k: number) => FollowOptions<Vector3>, steps: number) {
  const path = [start.clone().addScaledVector(velocity, -dt), start.clone()];
  for (let k = 1; k <= steps; k++) path.push(follow(path[k - 1], path[k], target(k), options(k), dt));
  return path;
}

/** each step's acceleration */
const accelerations = (path: Vector3[]) => path.slice(2).map((p, k) => p.clone().sub(path[k + 1]).sub(path[k + 1].clone().sub(path[k])).length() / dt ** 2);

describe('follow', () => {
  it('accelerates at most `accel` and closes in at most at `speed`, from any motion', () => {
    const goal = new Vector3(1, 0.5, 0);
    for (const velocity of [new Vector3(), new Vector3(-2, 0, 1), new Vector3(3, 1.5, 0)]) {
      const path = run(new Vector3(), velocity, () => goal, () => ({ accel: 8, speed: 1.5 }), 240);
      expect(Math.max(...accelerations(path))).toBeLessThan(8 + 1e-9);
      expect(path.at(-1)?.distanceTo(goal)).toBeLessThan(1e-12);
    }
    const calm = run(new Vector3(), new Vector3(), () => goal, () => ({ accel: 100, speed: 1 }), 60);
    expect(Math.max(...calm.slice(1).map((p, k) => p.distanceTo(calm[k]) / dt))).toBeLessThan(1 + 1e-9);
  });

  it('stops on a still target without overshooting it, down to the last step', () => {
    for (const distance of [0.0005, 0.003, 0.25, 1]) {
      for (const speed of [0, 0.5, 2]) {
        const path = run(new Vector3(), new Vector3(speed, 0, 0), () => new Vector3(distance, 0, 0), () => ({ accel: 10 }), 120);
        // (only a start too fast to brake in time carries it past)
        const past = Math.max(0, (speed * speed) / 20 + speed * dt - distance);
        expect(Math.max(...path.map((p) => p.x)) - distance).toBeLessThanOrEqual(past + 1e-12);
        expect(path.at(-1)?.x).toBeCloseTo(distance, 12);
      }
    }
  });

  it('passes a still goal by at most v⊥² / accel when it starts with velocity across the line to it', () => {
    for (const accel of [2, 8, 30]) {
      for (const [distance, across, along] of [[0.3, 1, 0], [0.05, 0.5, 0], [1, 2, 0.5], [0.3, 1, -1], [2, 4, 1]]) {
        const path = run(new Vector3(), new Vector3(along, across, 0), () => new Vector3(distance, 0, 0), () => ({ accel }), 1200);
        const past = Math.max(...path.map((p) => p.x - distance));
        expect(past).toBeLessThanOrEqual((across * across) / accel);
        expect(path.at(-1)?.distanceTo(new Vector3(distance, 0, 0))).toBeLessThan(1e-12);
      }
    }
  });

  it('refuses what it cannot follow', () => {
    const at = new Vector3();
    expect(() => follow(at, at, new Vector3(NaN, 0, 0), { accel: 1 }, dt)).toThrow(/not finite/);
    expect(() => follow(at, at, at, { accel: Infinity }, dt)).toThrow(/acceleration/);
    expect(() => follow(at, at, at, { accel: 1, speed: -1 }, dt)).toThrow(/speed/);
    expect(() => follow(at, at, at, { accel: 1 }, 0)).toThrow(/step/);
  });

  it('follows a goal moving steadily without lag once caught up, given its velocity', () => {
    const velocity = new Vector3(1.2, 0, -0.4);
    const at = (k: number) => new Vector3(0.5, 1, 0).addScaledVector(velocity, k * dt);
    const path = run(new Vector3(), new Vector3(), at, () => ({ accel: 10, velocity }), 300);
    expect(path.at(-1)?.distanceTo(at(300))).toBeLessThan(1e-12);
    expect(Math.max(...accelerations(path))).toBeLessThan(10 + 1e-9);
  });

  it('hands over continuously: a new goal starts from the motion there is', () => {
    const first = new Vector3(2, 0, 0);
    const second = new Vector3(0, 1, 0);
    const path = run(new Vector3(), new Vector3(), (k) => (k < 40 ? first : second), () => ({ accel: 6 }), 300);
    expect(Math.max(...accelerations(path))).toBeLessThan(6 + 1e-9);
    expect(path.at(-1)?.distanceTo(second)).toBeLessThan(1e-12);
  });

  it('follows scalars the same way', () => {
    let [a, b] = [0, 0];
    for (let k = 0; k < 120; k++) [a, b] = [b, follow(a, b, 2, { accel: 20, speed: 3 }, dt)];
    expect(b).toBe(2);
  });
});

describe('followRotation', () => {
  it('turns to a still rotation within its acceleration, and follows a steady spin without lag', () => {
    const goal = turn(1, 2, 0, 2);
    const path = [new Quaternion(), new Quaternion()];
    for (let k = 1; k < 240; k++) path.push(followRotation(path[k - 1], path[k], goal, { accel: 20, speed: 4 }, dt));
    expect(path.at(-1)?.angleTo(goal)).toBeLessThan(1e-6);
    const rates = path.slice(1).map((q, k) => q.angleTo(path[k]) / dt);
    expect(Math.max(...rates)).toBeLessThan(4 + 1e-6);
    expect(Math.max(...rates.slice(1).map((r, k) => Math.abs(r - rates[k]) / dt))).toBeLessThan(20 + 1e-6);

    const spin = new Vector3(0, 1.5, 0.5);
    const at = (k: number) => turn(spin.x, spin.y, spin.z, spin.length() * k * dt).multiply(goal);
    const chase = [new Quaternion(), new Quaternion()];
    for (let k = 1; k < 300; k++) chase.push(followRotation(chase[k - 1], chase[k], at(k), { accel: 20, velocity: spin }, dt));
    expect(chase.at(-1)?.angleTo(at(299))).toBeLessThan(1e-6);
  });
});
