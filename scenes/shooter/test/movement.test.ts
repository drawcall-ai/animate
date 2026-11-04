import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3, type Scene } from 'three';
import { SPEED } from '../src/movement';
import { box, course } from './course';

const DT = 1 / 120;

async function setup(build?: (scene: Scene) => void, spawn = new Vector3(0, 0.02, 0)) {
  const run = await course((scene) => {
    box(scene, [40, 1, 40], [0, -0.5, 0]);
    build?.(scene);
  }, { spawn, dt: DT });
  run.advance(0.2);
  return run;
}

describe('capsule character movement', () => {
  it('stops at walls and slides along them without penetrating', async () => {
    const { movement, advance } = await setup((scene) => box(scene, [1, 4, 10], [2, 2, 0]));
    movement.input.move.set(1, 0, 0);
    advance(2);
    expect(movement.position.x).toBeGreaterThan(1.1);
    expect(movement.position.x).toBeLessThan(1.23);
    movement.input.move.set(1, 0, 1);
    advance(3);
    expect(movement.position.x).toBeLessThan(1.23);
    expect(movement.position.z).toBeGreaterThan(2);
  });

  it('climbs low steps and stays grounded on the landing', async () => {
    const { movement, advance } = await setup((scene) => box(scene, [4, 0.25, 4], [0, 0.125, 3]));
    movement.input.move.z = 1;
    advance(2);
    movement.input.move.set(0, 0, 0);
    advance(0.3);
    expect(movement.position.z).toBeGreaterThan(2);
    expect(movement.position.y).toBeCloseTo(0.25, 1);
    expect(movement.grounded).toBe(true);
  });

  it('holds crouch below a ceiling until standing clearance is available', async () => {
    const { movement, advance } = await setup((scene) => box(scene, [3, 0.4, 3], [0, 1.75, 3]));
    movement.input.crouch = true;
    movement.input.move.z = 1;
    advance(3.2);
    movement.input.move.z = 0;
    movement.input.crouch = false;
    advance(0.3);
    expect(movement.position.z).toBeGreaterThan(2);
    expect(movement.crouched).toBe(true);
    movement.input.move.z = -1;
    advance(3);
    expect(movement.crouched).toBe(false);
    expect(movement.height).toBe(1.8);
  });

  it('jumps once per press, collides with ceilings, and lands on the floor', async () => {
    const { world, movement, advance } = await setup((scene) => box(scene, [4, 0.3, 4], [0, 2.35, 0]));
    movement.input.jump = true;
    let highest = 0;
    for (let i = 0; i < 240; i++) {
      world.update(DT);
      highest = Math.max(highest, movement.position.y);
    }
    expect(highest).toBeGreaterThan(0.2);
    expect(highest).toBeLessThan(0.43);
    expect(movement.position.y).toBeCloseTo(0, 1);
    expect(movement.grounded).toBe(true);
    movement.input.jump = false;
    world.update(DT);
    movement.input.jump = true;
    advance(0.15);
    expect(movement.velocity.y).toBeGreaterThan(0);
  });

  it('keeps support through a short push-off before a grounded jump', async () => {
    const { movement, advance } = await setup();
    movement.input.jump = true;
    advance(0.04);
    expect(movement.grounded).toBe(true);
    expect(movement.position.y).toBeLessThan(0.02);
    expect(movement.takeoff).toBeGreaterThan(0);
    advance(0.16);
    expect(movement.grounded).toBe(false);
    expect(movement.position.y).toBeGreaterThan(0.2);
    expect(movement.takeoff).toBe(0);
  });

  it('normalizes diagonal input and gives aiming priority over sprint', async () => {
    const { movement, advance } = await setup();
    movement.input.move.set(0, 0, 1);
    advance(0.8);
    const forward = movement.speed;
    movement.input.move.set(1, 0, 1);
    advance(0.8);
    const diagonal = movement.speed;
    expect(diagonal).toBeLessThan(forward);
    movement.input.move.set(10, 0, 10);
    advance(0.3);
    expect(movement.speed).toBeCloseTo(diagonal, 5);
    movement.input.sprint = true;
    advance(0.8);
    expect(movement.sprinting).toBe(true);
    movement.input.aim = true;
    advance(0.8);
    expect(movement.speed).toBeLessThan(diagonal);
    expect(movement.sprinting).toBe(false);
  });

  it.each([-1, 1])('sprints at full speed diagonally forward, side %s', async (side) => {
    const { movement, advance } = await setup();
    movement.input.move.set(side, 0, 1).normalize();
    movement.input.sprint = true;
    advance(1.5);
    expect(movement.sprinting).toBe(true);
    expect(movement.speed).toBeCloseTo(SPEED.sprint, 2);
  });

  it('sprints only forward relative to the camera heading', async () => {
    const { movement, advance } = await setup();
    movement.input.yaw = Math.PI / 2;
    movement.input.move.set(1, 0, 0);
    movement.input.sprint = true;
    advance(0.8);
    const forward = movement.speed;
    expect(movement.sprinting).toBe(true);
    movement.input.move.set(-1, 0, 0);
    advance(0.8);
    expect(movement.sprinting).toBe(false);
    expect(movement.speed).toBeLessThan(forward / 2);
    movement.input.move.set(0, 0, 1);
    advance(0.5);
    expect(movement.sprinting).toBe(false);
    movement.input.move.set(-1, 0, 0);
    movement.input.yaw = -Math.PI / 2;
    advance(0.8);
    expect(movement.sprinting).toBe(true);
    expect(movement.speed).toBeCloseTo(forward, 5);
  });

  it('follows a moving support and reset clears motion and input', async () => {
    const { world, movement, advance, built: platform } = await course(
      (scene) => box(scene, [6, 0.4, 6], [0, 0, 0], 'kinematic'), { spawn: new Vector3(0, 0.22, 0), dt: DT },
    );
    advance(0.2);
    world.onBeforeStep(() => platform.setKinematicTarget(new Matrix4().makeTranslation(world.time, 0, 0)));
    advance(1);
    expect(movement.position.x).toBeCloseTo(1.19, 1);
    expect(movement.grounded).toBe(true);
    movement.input.sprint = movement.input.jump = true;
    movement.input.move.x = 1;
    movement.reset(new Vector3(0, 2, 0));
    expect(movement.object.position.toArray()).toEqual([0, 2, 0]);
    expect(movement.velocity.length()).toBe(0);
    expect(movement.input.move.length()).toBe(0);
    expect(movement.input.jump).toBe(false);
    expect(movement.grounded).toBe(false);
  });

  it('buffers a jump pressed just before landing', async () => {
    const { world, movement, advance } = await setup(undefined, new Vector3(0, 0.65, 0));
    expect(movement.grounded).toBe(false);
    expect(movement.velocity.y).toBeLessThan(0);
    for (let i = 0; i < 60 && movement.position.y > 0.12; i++) world.update(DT);
    expect(movement.grounded).toBe(false);
    movement.input.jump = true;
    advance(0.18);
    expect(movement.velocity.y).toBeGreaterThan(0);
    expect(movement.grounded).toBe(false);
  });

  it('allows a coyote jump just after leaving a ledge', async () => {
    const { world, movement, advance } = await setup(
      (scene) => box(scene, [4, 1, 4], [0, 0.5, 0]), new Vector3(0, 1.02, 0),
    );
    movement.input.move.z = 1;
    for (let step = 0; step < 360 && movement.grounded; step++) world.update(DT);
    expect(movement.grounded).toBe(false);
    expect(movement.position.y).toBeGreaterThan(0.7);
    advance(0.04);
    movement.input.jump = true;
    world.update(DT);
    expect(movement.velocity.y).toBeGreaterThan(4);
  });
});
