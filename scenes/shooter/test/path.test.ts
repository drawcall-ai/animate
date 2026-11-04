import { Vector3 } from 'three';
import { expect, it } from 'vitest';
import { Path } from '../src/enemy/path';
import { Navigation } from '../src/nav';
import { box, cleanup, DT, soldiers } from './course';

it.each([
  { height: 0.45, back: false }, { height: 0.75, back: false },
  { height: 0.45, back: true }, { height: 0.75, back: true },
])('follows a NavCat jump on the $height m block (reverse=$back) through the shared soldier controller', async ({ height, back }) => {
  const from = back ? new Vector3(0, height + 0.04, 4) : new Vector3(0, 0.04, 1);
  const goal = back ? new Vector3(0, 0, 1) : new Vector3(0, height, 4);
  const { world, soldiers: [soldier] } = await soldiers((scene) => {
    box(scene, [10, 1, 12], [0, -0.5, 3]);
    box(scene, [1.35, height, 1.35], [0, height / 2, 4]);
  }, ['Test', from, false]);
  cleanup(world.onAfterStep((dt) => soldier.update(dt)));
  const path = new Path(new Navigation(world), soldier);
  for (let frame = 0; frame < 120; frame++) world.update(DT);
  expect(path.go(goal)).toBe(true);
  let status = path.update(DT, true), jumped = false;
  for (let frame = 0; frame < 600 && status === 'moving'; frame++) {
    world.update(DT);
    jumped ||= !soldier.movement.grounded;
    status = path.update(DT, true);
  }
  expect(jumped).toBe(true);
  expect(status, JSON.stringify(soldier.position.toArray())).toBe('arrived');
  expect(soldier.position.y).toBeCloseTo(goal.y, 1);
  expect(Math.abs(soldier.position.z - goal.z)).toBeLessThan(0.25);
  for (let frame = 0; frame < 30; frame++) world.update(DT);
  expect(soldier.movement.grounded).toBe(true);
  expect(soldier.position.y).toBeCloseTo(goal.y, 1);
}, 15000);

it('brakes a relocation sprint at the requested position', async () => {
  const { world, soldiers: [soldier] } = await soldiers((scene) => box(scene, [12, 1, 12], [0, -0.5, 0]), ['Test', new Vector3(0, 0.04, -3), false]);
  cleanup(world.onAfterStep((dt) => soldier.update(dt)));
  const path = new Path(new Navigation(world), soldier);
  const goal = new Vector3(0, 0, 3);
  for (let frame = 0; frame < 120; frame++) world.update(DT);
  expect(path.go(goal)).toBe(true);
  let status = path.update(DT, true);
  for (let frame = 0; frame < 600 && status === 'moving'; frame++) {
    world.update(DT);
    status = path.update(DT, true);
  }
  expect(status).toBe('arrived');
  for (let frame = 0; frame < 60; frame++) world.update(DT);
  expect(soldier.position.distanceTo(goal)).toBeLessThan(0.25);
}, 15000);
