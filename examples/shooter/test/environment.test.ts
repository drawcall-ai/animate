import { expect, it } from 'vitest';
import { Vector3, type Scene } from 'three';
import { box, course, ramp } from './course';

async function yard(build: (scene: Scene) => void) {
  const run = await course((scene) => {
    box(scene, [30, 1, 30], [0, -0.5, 0]);
    build(scene);
  }, { spawn: new Vector3(0, 0.04, -1), dt: 1 / 120 });
  run.advance(0.2);
  return run;
}

it('climbs the course ramp and descends it without losing support', async () => {
  const { movement, advance } = await yard((scene) => ramp(scene, { width: 4, run: 7, rise: 2.4 }));
  movement.input.move.z = 1;
  advance(4.4);
  expect(movement.position.z).toBeGreaterThan(4);
  expect(movement.position.y).toBeGreaterThan(1.3);
  expect(movement.grounded).toBe(true);
  movement.input.move.z = -1;
  advance(4.5);
  expect(movement.position.y).toBeLessThan(0.3);
  expect(movement.grounded).toBe(true);
});

it('does not turn a steep slope into a walkable ramp', async () => {
  const { movement, advance } = await yard((scene) => ramp(scene, { width: 4, run: 2, rise: 4 }));
  movement.input.move.z = 1;
  advance(2);
  expect(movement.position.z).toBeLessThan(0.3);
  expect(movement.position.y).toBeLessThan(0.2);
});
