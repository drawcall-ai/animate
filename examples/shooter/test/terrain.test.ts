import { expect, it } from 'vitest';
import { Body, humanoid } from '@drawcall/animate';
import { RigidBody, SphereCollider } from '@drawcall/physics';
import { buildWorld } from '@drawcall/physics-rapier';
import { Matrix4, Scene, Vector3 } from 'three';
import { SOLDIER } from '../src/skeleton';
import { Terrain } from '../src/terrain';
import { box, cleanup, ramp, soles, stairs } from './course';

/** The path's stairs, tunnel ceiling, walkway, ramp and lift, plus one tilted block, as bare colliders. */
async function yard() {
  const scene = new Scene();
  box(scene, [44, 1, 44], [0, -0.5, 2]);
  stairs(scene, -8, -5.275);
  box(scene, [3.35, 0.35, 4], [8.5, 1.725, -4]);
  box(scene, [6, 0.28, 1.8], [-10, 2.26, 5.6]);
  ramp(scene, { x: -13, z: -5.3, width: 3, run: 7, rise: 2.4 });
  const tilted = box(scene, [1.5, 0.5, 1.5], [4, 0.6, 3]);
  tilted.rotation.set(0.2, 0.7, 0.25);
  const lift = box(scene, [3.2, 0.25, 3.2], [13.5, 0.125, 6], 'kinematic');
  const world = await buildWorld({ scene });
  cleanup(() => world.dispose());
  return { scene, world, lift, terrain: new Terrain(world) };
}

it('samples each physical tread without smoothing its riser', async () => {
  const { terrain, world } = await yard();
  for (let i = 0; i < 8; i++) {
    const feet = new Vector3(-8, i * 0.22, -5 + i * 0.55);
    terrain.update(feet);
    const front = -5.275 + i * 0.55;
    expect(terrain.floor(-8, front - 0.001)).toBeCloseTo(i * 0.22, 5);
    expect(terrain.floor(-8, front + 0.001)).toBeCloseTo((i + 1) * 0.22, 5);
    for (const z of [front - 0.001, front + 0.001, front + 0.3]) {
      const hit = world.raycast(new Vector3(-8, feet.y + 1.8, z), new Vector3(0, -1, 0), 20);
      expect(hit).not.toBeNull();
      expect(terrain.floor(-8, z)).toBeCloseTo(hit?.point.y ?? NaN, 5);
    }
  }
});

it('samples ramps and tilted boxes at their actual collider surfaces', async () => {
  const { terrain, world } = await yard();
  for (const [x, y, z] of [[-13, 0.8, -4], [-13, 1.5, -2], [-13, 2.4, 0], [4, 1, 3], [4.2, 1, 3.1]]) {
    terrain.update(new Vector3(x, y, z));
    const hit = world.raycast(new Vector3(x, y + 1.8, z), new Vector3(0, -1, 0), 20);
    expect(hit).not.toBeNull();
    expect(terrain.floor(x, z)).toBeCloseTo(hit?.point.y ?? NaN, 5);
  }
});

it('exposes higher future treads to the sprint preview while still at the stair base', async () => {
  const { terrain } = await yard();
  terrain.update(new Vector3(-8, 0.02, -5.5));
  // A sprint previews the fourth and fifth treads, less than 3 m ahead, before the capsule rises.
  for (let i = 3; i < 8; i++)
    expect(terrain.floor(-8, -5 + i * 0.55)).toBeCloseTo((i + 1) * 0.22, 6);
});

it('keeps shared tread edges supported despite floating-point seams', async () => {
  const { terrain } = await yard();
  for (let i = 1; i < 8; i++) {
    terrain.update(new Vector3(-8, i * 0.22, -5 + i * 0.55));
    const back = -5 + (i - 1) * 0.55 + 0.275;
    const front = -5 + i * 0.55 - 0.275;
    for (const z of [back, front, (front + back) / 2, -5.275 + i * 0.55])
      expect(terrain.floor(-8, z), `Shared tread edge ${i} at ${z}`).toBeGreaterThanOrEqual(i * 0.22 - 1e-8);
  }
});

it('keeps overhead roofs and bridges out of the floor while underneath them', async () => {
  const { terrain } = await yard();
  terrain.update(new Vector3(8.5, 0.02, -4));
  expect(terrain.floor(8.5, -4)).toBe(0);
  terrain.update(new Vector3(-10, 0.02, 5.6));
  expect(terrain.floor(-10, 5.6)).toBe(0);
  terrain.update(new Vector3(-10, 2.4, 5.6));
  expect(terrain.floor(-10, 5.6)).toBeCloseTo(2.4, 6);
  expect(terrain.floor(24, 0)).toBeLessThan(-12);
});

it('is no floor where a ball lies, such as a dropped grenade', async () => {
  const { scene, world, terrain } = await yard();
  const ball = new RigidBody({ mass: 0.4 });
  ball.position.set(1, 0.04, 1);
  ball.add(new SphereCollider({ radius: 0.04 }));
  scene.add(ball);
  world.update(1 / 60);
  terrain.update(new Vector3(1, 0, 1));
  expect(terrain.floor(1, 1)).toBeCloseTo(0, 5);
});

it('refreshes moving support surfaces only from their completed poses', async () => {
  const { world, terrain, lift } = await yard();
  terrain.update(new Vector3(13.5, 0.25, 6));
  expect(terrain.floor(13.5, 6)).toBeCloseTo(0.25, 6);
  expect(terrain.floor.platform?.(13.5, 6)).toBe(lift);
  lift.setKinematicTarget(new Matrix4().makeTranslation(13.5, 1.125, 6));
  world.update(1 / 60);
  expect(terrain.floor(13.5, 6)).toBeCloseTo(0.25, 6);
  terrain.update(new Vector3(13.5, 1.25, 6));
  expect(terrain.floor(13.5, 6)).toBeCloseTo(1.25, 6);
  expect(terrain.floor.platform?.(13.5, 6)).toBe(lift);
});

it.each([{ speed: 1, direction: 1 }, { speed: 1, direction: -1 }, { speed: 1.4, direction: 1 }])(
  'plants a driven soldier on each physical tread at $speed m/s, direction $direction', async ({ speed, direction }) => {
  const { scene, terrain } = await yard();
  const root = {
    position: new Vector3(-8, direction > 0 ? 0 : 1.76, direction > 0 ? -6 : 0.2),
    velocity: new Vector3(0, 0, speed * direction), yaw: direction > 0 ? 0 : Math.PI,
  };
  terrain.update(root.position);
  const body = new Body(humanoid(SOLDIER), { at: root.position.clone(), face: root.yaw, drive: () => root, floor: terrain.floor });
  scene.add(body.object);
  const levels = new Set([direction > 0 ? 0 : 8]), planted = [true, true];
  let sunk = 0, raised = 0, straddled = 0, touchdowns = 0;
  for (let i = 0; i < Math.round(6.2 / speed * 60); i++) {
    root.position.z += root.velocity.z / 60;
    terrain.update(root.position);
    root.position.y = terrain.floor(root.position.x, root.position.z);
    body.update(1 / 60);
    body.object.updateMatrixWorld(true);
    body.feet.forEach((foot, index) => {
      const sole = soles(body, index === 0 ? 'left' : 'right');
      const floor = sole.map((point) => terrain.floor(point.x, point.z));
      if (foot.planted) {
        const gap = sole.map((point, corner) => point.y - floor[corner]);
        sunk = Math.max(sunk, -Math.min(...gap));
        raised = Math.max(raised, Math.min(...gap));
        if (!planted[index]) {
          touchdowns++;
          if (Math.max(...floor) - Math.min(...floor) > 0.002) straddled++;
          levels.add(Math.round(floor[0] / 0.22));
        }
      }
      planted[index] = foot.planted;
    });
  }
  expect(Math.abs(body.position.z - (direction > 0 ? 0.2 : -6))).toBeLessThan(0.02);
  expect(sunk).toBeLessThan(0.01);
  expect(raised).toBeLessThan(0.02);
  expect(straddled).toBe(0);
  expect(touchdowns).toBeGreaterThan(8);
  expect([...levels].filter((level) => level > 0).sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
});
