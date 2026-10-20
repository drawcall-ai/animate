import { Vector3 } from 'three';
import { expect, it } from 'vitest';
import { Rope } from '../../src/core/rope';

const dt = 1 / 60;
const lengthOf = (rope: Rope) => rope.points.slice(1).reduce((sum, p, k) => sum + p.distanceTo(rope.points[k]), 0);

it('hangs under gravity from its pins at its own length, and lies on the ground', () => {
  const rope = new Rope(new Vector3(0, 1.5, 0), new Vector3(2, 1.5, 0), 2);
  for (let k = 0; k < 120; k++) rope.step(dt, [[0, new Vector3(0, 1.5, 0)], [0.5, new Vector3(0.6, 0.8, 0)]]);
  expect(Math.abs(lengthOf(rope) - 2) / 2).toBeLessThan(0.01);
  // the held part sags below its pins; the free tail hangs straight down to the ground and lies there
  expect(rope.at(0.25).y).toBeLessThan(1.15); // below the chord between its pins
  expect(rope.at(1).y).toBeLessThan(0.05);
  expect(Math.min(...rope.points.map((p) => p.y))).toBeGreaterThan(0);
});

it('keeps its length while one end is carried at a walk, and is deterministic', () => {
  const run = () => {
    const rope = new Rope(new Vector3(0, 1.2, 0), new Vector3(1, 1.2, 0), 1.2);
    for (let k = 0; k < 240; k++) rope.step(dt, [[0, new Vector3(0, 1.2, 1.3 * k * dt)], [0.6, new Vector3(0.4, 0.9, 1.3 * k * dt - 0.2)]]);
    return rope;
  };
  const rope = run();
  expect(Math.abs(lengthOf(rope) - 1.2) / 1.2).toBeLessThan(0.01);
  expect(rope.points.map((p) => p.toArray())).toEqual(run().points.map((p) => p.toArray()));
});

it('finds the point along it nearest a position', () => {
  const rope = new Rope(new Vector3(0, 0.5, 0), new Vector3(2, 0.5, 0), 2, 20);
  expect(rope.nearest(new Vector3(1.5, 0.6, 0))).toBeCloseTo(0.75);
  expect(rope.nearest(new Vector3(1.5, 0.6, 0), 0, 0.5)).toBeCloseTo(0.5);
});
