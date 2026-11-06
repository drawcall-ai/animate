import { describe, expect, it } from 'vitest';
import type { RigidBody } from '@drawcall/physics';
import { Matrix4, Scene, Vector3 } from 'three';
import { Handling } from '../src/rover/handling';
import { createRover } from '../src/rover/model';
import { box, cleanup, DT, jerkless, mountable } from './course';

/** A rover facing +Z on open ground at height `floor`, and a soldier a step off its doorway who can drive it. */
async function yard(build: (scene: Scene) => void = () => {}, floor = 0) {
  const scene = new Scene();
  box(scene, [60, 1, 60], [0, floor - 0.5, 0], 'static', 'Ground');
  const rover = createRover();
  rover.body.position.y = floor;
  scene.add(rover.body);
  build(scene);
  const door = rover.marks.door.getWorldPosition(new Vector3());
  const yard = await mountable(scene, door.setX(door.x - 0.8).setY(floor + 0.02), (world) => {
    const handling = new Handling(world, rover);
    cleanup(() => handling.dispose());
    return { vehicle: { rover, handling } };
  });
  const driver = yard.soldier.driver;
  if (!driver) throw new Error('The soldier has no driver seat');
  return { ...yard, rover, handling: yard.vehicle.handling, driver };
}

describe('Driver', () => {
  it('gets in, drives with its hands on the turning wheel, stops, gets out and takes its rifle back', async () => {
    const { world, rover, handling, soldier, driver, until, heard } = await yard();
    expect(driver.near).toBe(true);
    // The rifle goes from the hands into the rack, and on the way out back up onto the shoulder, without a jump: its motion changes
    // smoothly frame to frame.
    const smooth = jerkless(soldier.avatar.rifle);
    driver.mount();
    // (straight on from the walk up, without waiting at the doorway, and in at once: each move heard as it ends)
    expect(until(() => smooth() && driver.state === 'mounting', 2)).toBeLessThan(1.4);
    heard.length = 0;
    expect(until(() => smooth() && driver.state === 'on', 3)).toBeLessThan(2.1);
    expect(heard).toEqual(['clank', 'cloth', 'boot', 'thud', 'boot']);
    expect(smooth.jerk).toBeLessThan(0.02);
    expect(soldier.avatar.rifle.parent).toBe(rover.marks.rack);
    expect(handling.engine.state).not.toBe('off');

    handling.drive(1, 1, false);
    until(() => handling.speed > 3, 6);
    // The hands hold the turning wheel however far round the driver looks (the view is kept to what it can turn to).
    for (const yaw of [-2, 0, 2]) {
      driver.aim(handling.yaw + yaw, 0);
      world.update(DT);
      for (const side of ['left', 'right'] as const) {
        const grip = rover.marks.grips[side].getWorldPosition(new Vector3());
        expect(soldier.avatar.body.bones[`${side}Hand`].getWorldPosition(new Vector3()).distanceTo(grip)).toBeLessThan(0.09);
      }
    }

    // (held back while still rolling forward, the pedal brakes)
    until(() => { handling.drive(-1, 0, false); return driver.canExit; }, 6);
    handling.park();
    driver.exit();
    expect(handling.engine.state).toBe('off');
    // (getting out readies a fresh body with its own rifle off screen, a few frames)
    const posed = soldier.avatar.rifle;
    heard.length = 0;
    expect(until(() => soldier.avatar.rifle !== posed, 0.5)).toBeLessThan(0.15);
    const rifle = soldier.avatar.rifle, hand = soldier.avatar.body.bones.rightHand;
    const out = jerkless(rifle);
    let taken = false;
    expect(until(() => {
      taken ||= rifle.parent === hand;
      return out() && driver.state === 'off';
    }, 3)).toBeLessThan(2.1);
    expect(heard).toEqual(['cloth', 'step-b', 'clank', 'step-a']);
    expect(taken).toBe(true);
    expect(out.jerk).toBeLessThan(0.02);
    expect(soldier.avatar.acquired).toBe(true);
  });

  it('gets out onto raised ground standing on it', async () => {
    const { soldier, driver, until } = await yard(undefined, 1.5);
    driver.mount();
    until(() => driver.state === 'on', 12);
    until(() => driver.canExit, 3);
    driver.exit();
    until(() => driver.state === 'off', 4);
    expect(soldier.movement.grounded).toBe(true);
    expect(soldier.movement.position.y).toBeCloseTo(1.5, 1);
  });

  it('stays in while something stands in the doorway', async () => {
    let crate: RigidBody | undefined;
    const { world, rover, driver, until } = await yard((scene) => { crate = box(scene, [0.6, 2, 0.6], [10, 1, 10], 'kinematic', 'Crate'); });
    if (!crate) throw new Error('No crate');
    driver.mount();
    until(() => driver.state === 'on', 12);
    expect(driver.canExit).toBe(true);
    world.teleport(crate, new Matrix4().makeTranslation(rover.marks.door.getWorldPosition(new Vector3()).setY(1)));
    expect(driver.canExit).toBe(false);
    driver.exit();
    expect(driver.state).toBe('on');
  });

  it('gives up walking to a doorway it cannot reach', async () => {
    const { driver, until } = await yard((scene) => box(scene, [0.4, 2, 3], [-1.45, 1, 0.42], 'static', 'Wall'));
    driver.mount();
    expect(driver.state).toBe('approaching');
    until(() => driver.state === 'off', 6);
  });

  it('falls out as a ragdoll when killed at the wheel, and stands afresh when reset', async () => {
    const { world, soldier, driver, handling, until } = await yard();
    driver.mount();
    until(() => driver.state === 'on', 12);
    soldier.hurt(100, soldier.avatar.body.bones.chest.getWorldPosition(new Vector3()), new Vector3(1, 0, 0));
    expect(driver.state).toBe('off');
    expect(handling.engine.state).toBe('off');
    for (let frame = 0; frame < 120; frame++) world.update(DT);
    expect(soldier.look().eye.y).toBeGreaterThan(-0.5);
    soldier.reset();
    expect(driver.state).toBe('off');
    until(() => soldier.avatar.acquired, 10);
  });
});
