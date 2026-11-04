import { afterAll, beforeAll, expect, it } from 'vitest';
import type { PhysicsWorld } from '@drawcall/physics';
import { buildWorld } from '@drawcall/physics-rapier';
import { Object3D, Scene, Vector3 } from 'three';
import { Navigation } from '../src/nav';
import { GRAVITY, Movement } from '../src/movement';
import { box, ramp, stairs } from './course';

let world: PhysicsWorld, nav: Navigation;
const scene = new Scene();

beforeAll(async () => {
  box(scene, [32, 1, 32], [0, -0.5, 0]);
  box(scene, [2.8, 1.1, 0.8], [0, 0.55, 0], 'static', 'Cover');
  stairs(scene, -8, -5.275);
  ramp(scene, { x: -13, z: -5.3, width: 3, run: 7, rise: 2.4 });
  box(scene, [3, 2.4, 3], [-13, 1.2, 3.2]);
  box(scene, [3, 0.35, 4], [8.5, 1.725, -4]);
  box(scene, [1.35, 0.45, 1.35], [4, 0.225, 6]);
  box(scene, [1.35, 0.75, 1.35], [8, 0.375, 6]);
  box(scene, [3.2, 0.25, 3.2], [12, 2.125, 6], 'kinematic');
  world = await buildWorld({ scene, gravity: [0, GRAVITY, 0], fixedDelta: 1 / 60 });
  nav = new Navigation(world);
}, 20000);

afterAll(() => world.dispose());

it('routes around the real cover footprint with capsule clearance', () => {
  const route = nav.path(new Vector3(0, 0, -4), new Vector3(0, 0, 4));
  expect(route?.complete).toBe(true);
  expect(route?.points.some((point) => Math.abs(point.position.x) >= 1.7 - 1e-6)).toBe(true);
  expect(nav.covers).toHaveLength(1);
  expect(nav.covers[0].min.distanceTo(new Vector3(-1.4, 0, -0.4))).toBeLessThan(1e-6);
});

it.each([
  { name: 'stairs', from: new Vector3(-8, 0, -6), to: new Vector3(-8, 1.76, 1) },
  { name: 'ramp', from: new Vector3(-13, 0, -6), to: new Vector3(-13, 2.4, 3) },
])('connects the actual $name without jumping', ({ from, to }) => {
  const route = nav.path(from, to);
  expect(route?.complete).toBe(true);
  expect(route?.points.some((point) => point.jump)).toBe(false);
  expect(route?.points.at(-1)?.position.distanceTo(to)).toBeLessThan(0.1);
});

it('permits the low tunnel and detects when its capsule must crouch', () => {
  const route = nav.path(new Vector3(8.5, 0, -7), new Vector3(8.5, 0, -1));
  expect(route?.complete).toBe(true);
  expect(nav.requiresCrouch(new Vector3(8.5, 0, -4))).toBe(true);
  expect(nav.requiresCrouch(new Vector3(8.5, 0, -7))).toBe(false);
});

it.each([{ x: 4, height: 0.45 }, { x: 8, height: 0.75 }])('uses an explicit takeoff and landing for a $height m jump block', ({ x, height }) => {
  const route = nav.path(new Vector3(x, 0, 3), new Vector3(x, height, 6));
  expect(route?.complete).toBe(true);
  const start = route?.points.findIndex((point) => point.jump) ?? -1;
  expect(start).toBeGreaterThanOrEqual(0);
  expect(route?.points[start].position.y).toBeLessThan(0.1);
  expect(route?.points[start + 1].position.y).toBeCloseTo(height, 5);
});

it('does not bake a moving lift into the static navigation mesh', () => {
  expect(nav.path(new Vector3(12, 0, 3), new Vector3(12, 2.25, 6))).toBeNull();
});

it('keeps an elevated edge destination on its level when projecting it onto walkable space', () => {
  const route = nav.path(new Vector3(4, 0, 3), new Vector3(4.72, 0.45, 6));
  expect(route?.complete).toBe(true);
  expect(route?.points.at(-1)?.position.y).toBeGreaterThan(0.4);
});

it('does not report a destination complete by projecting it onto the floor below its ledge', () => {
  const route = nav.path(new Vector3(4, 0, 3), new Vector3(4.85, 0.45, 6));
  expect(!route?.complete || (route.points.at(-1)?.position.y ?? 0) > 0.4, JSON.stringify(route)).toBe(true);
});

it.each([
  { name: 'cover', from: new Vector3(0, 0.04, -4), to: new Vector3(0, 0, 4) },
  { name: 'stairs', from: new Vector3(-8, 0.04, -6), to: new Vector3(-8, 1.76, 1) },
  { name: 'ramp', from: new Vector3(-13, 0.04, -6), to: new Vector3(-13, 2.4, 3) },
  { name: 'tunnel', from: new Vector3(8.5, 0.04, -7), to: new Vector3(8.5, 0, -1) },
])('lets the actual capsule follow its $name route', ({ from, to }) => {
  const object = new Object3D(); object.position.copy(from); scene.add(object);
  const movement = new Movement(world, object), route = nav.path(from, to);
  if (!route?.complete) throw new Error('Expected complete route');
  let index = 1;
  try {
    for (let frame = 0; frame < 900 && index < route.points.length; frame++) {
      const delta = route.points[index].position.clone().sub(movement.position).setY(0);
      if (delta.length() < 0.12) { index++; continue; }
      movement.input.move.copy(delta.normalize());
      movement.input.yaw = Math.atan2(delta.x, delta.z);
      movement.input.crouch = nav.requiresCrouch(movement.position.clone().addScaledVector(delta, 0.5));
      world.update(1 / 60);
    }
    expect(movement.position.clone().setY(to.y).distanceTo(to)).toBeLessThan(0.2);
    expect(Math.abs(movement.position.y - to.y)).toBeLessThan(0.08);
  } finally { movement.dispose(); object.removeFromParent(); }
});

it.each([{ x: 4, height: 0.45, sprint: false }, { x: 8, height: 0.75, sprint: true }])(
  'lands a real capsule jump onto the $height m linked block', ({ x, height, sprint }) => {
    const from = new Vector3(x, 0.04, 3), object = new Object3D(); object.position.copy(from); scene.add(object);
    const movement = new Movement(world, object), route = nav.path(from, new Vector3(x, height, 6));
    const start = route?.points.findIndex((point) => point.jump) ?? -1;
    if (!route?.complete || start < 0) throw new Error('Expected a jump route');
    const takeoff = route.points[start].position, landing = route.points[start + 1].position;
    let jumping = false, airborne = false, landed = false;
    try {
      for (let frame = 0; frame < 300 && !landed; frame++) {
        if (!jumping && movement.position.clone().setY(takeoff.y).distanceTo(takeoff) < 0.12) jumping = true;
        const delta = (jumping ? landing : takeoff).clone().sub(movement.position).setY(0).normalize();
        movement.input.move.copy(delta);
        movement.input.yaw = Math.atan2(delta.x, delta.z);
        movement.input.sprint = jumping ? sprint : true;
        movement.input.jump = jumping;
        world.update(1 / 60);
        airborne ||= jumping && !movement.grounded;
        landed = airborne && movement.grounded;
      }
      expect(landed).toBe(true);
      expect(movement.position.y).toBeCloseTo(height, 1);
    } finally { movement.dispose(); object.removeFromParent(); }
  },
);
