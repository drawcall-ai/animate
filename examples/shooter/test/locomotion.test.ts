import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import { box, DT, node, ramp, soldierOn, soles } from './course';
import { selfOf } from '../../../packages/animate/src/body/body';
import type { Body } from '@drawcall/animate';

const airborne = (body: Body) => selfOf(body).stepper?.airborne ?? false;

async function setup(surface: 'flat' | 'ramp' = 'flat', spawn = new Vector3(0, 0.02, -1), yaw = 0) {
  const run = await soldierOn((scene) => {
    box(scene, [40, 1, 40], [0, -0.5, 0]);
    if (surface === 'ramp') ramp(scene, { width: 6, run: 12, rise: 4.8 });
  }, { spawn, yaw, firstPerson: false });
  run.advance(3);
  return run;
}

it('folds the legs during the capsule flight and absorbs its landing', async () => {
  const { world, movement, avatar } = await setup();
  const hip = () => node(avatar.group, 'hips').getWorldPosition(new Vector3()).y - movement.position.y;
  const foot = () => Math.min(...soles(avatar.body, 'left').map((point) => point.y), ...soles(avatar.body, 'right').map((point) => point.y)) - movement.position.y;
  const standing = hip(), groundedFoot = foot();
  movement.input.jump = true;
  let preparation = 0;
  for (let i = 0; i < 15 && movement.grounded; i++) {
    world.update(DT);
    if (!movement.grounded) break;
    preparation = Math.max(preparation, standing - hip());
    expect(foot()).toBeGreaterThan(-0.01);
    expect(foot()).toBeLessThan(0.025);
  }
  expect(preparation).toBeGreaterThan(0.03);
  expect(movement.grounded).toBe(false);
  let apex = 0, tuck = 0, frames = 0;
  do {
    world.update(DT);
    apex = Math.max(apex, movement.position.y);
    if (movement.position.y > 0.3) tuck = Math.max(tuck, foot() - groundedFoot);
    frames++;
  } while (!movement.grounded && frames < 180);
  let compressed = 0;
  for (let i = 0; i < 24; i++) {
    world.update(DT);
    compressed = Math.max(compressed, standing - hip());
  }
  expect(frames).toBeLessThan(180);
  expect(apex).toBeGreaterThan(0.8);
  expect(apex).toBeLessThan(1);
  expect(tuck).toBeGreaterThan(0.05);
  expect(compressed).toBeGreaterThan(0.025);
});

it('does not plant walking steps while the capsule is airborne', async () => {
  const { world, movement, avatar, advance } = await setup();
  movement.input.move.z = 1;
  advance(0.8);
  movement.input.jump = true;
  for (let i = 0; i < 15 && movement.grounded; i++) world.update(DT);
  expect(movement.grounded).toBe(false);
  let airFrames = 0;
  while (!movement.grounded && airFrames < 180) {
    expect(airborne(avatar.body)).toBe(true);
    expect(avatar.body.feet.every((foot) => !foot.planted)).toBe(true);
    world.update(DT);
    airFrames++;
  }
  expect(airFrames).toBeGreaterThan(10);
  expect(airFrames).toBeLessThan(180);
  let planted = false;
  for (let frame = 0; frame < 60; frame++) {
    expect(airborne(avatar.body)).toBe(false);
    const standing = avatar.body.feet.some((foot) => foot.planted);
    if (planted || frame >= 6) expect(standing, `Landing recovery frame ${frame}`).toBe(true);
    planted ||= standing;
    world.update(DT);
  }
});

// (up and down the ramp, walking and sprinting; on the flat, either heading is the same walk)
const surfaces = [false, true].flatMap((sprint) => [
  { surface: 'flat' as const, direction: 1, sprint }, { surface: 'ramp' as const, direction: 1, sprint }, { surface: 'ramp' as const, direction: -1, sprint },
]);

it.each(surfaces)(
  'moves continuously on $surface in direction $direction with sprint=$sprint', async ({ surface, direction, sprint }) => {
    const z = direction > 0 ? 2 : 10;
    const { world, movement, avatar } = await setup(surface, new Vector3(0, surface === 'ramp' ? z * 0.4 + 0.04 : 0.02, z), direction > 0 ? 0 : Math.PI);
    const heights = () => [node(avatar.group, 'hips').getWorldPosition(new Vector3()).y, avatar.look().eye.y];
    let previous = heights(), velocities = [0, 0];
    const steps = [0, 0], accelerations = [0, 0];
    let lastCapsule = movement.position.toArray(), lastGrounded = movement.grounded;
    let worst: object = {};
    movement.input.move.z = direction;
    movement.input.sprint = sprint;
    for (let frame = 0; frame < 120; frame++) {
      world.update(DT);
      const now = heights(), nextVelocity = now.map((value, index) => (value - previous[index]) / DT);
      now.forEach((value, index) => {
        if (index === 0 && Math.abs(value - previous[index]) > steps[index]) {
          worst = { frame, from: previous[0], to: value, lastCapsule, capsule: movement.position.toArray(), lastGrounded, grounded: movement.grounded, velocity: movement.actualVelocity.toArray(), feet: avatar.body.feet };
        }
        steps[index] = Math.max(steps[index], Math.abs(value - previous[index]));
        accelerations[index] = Math.max(accelerations[index], Math.abs(nextVelocity[index] - velocities[index]) / DT);
      });
      previous = now;
      velocities = nextVelocity;
      lastCapsule = movement.position.toArray();
      lastGrounded = movement.grounded;
    }
    expect(steps[0], JSON.stringify(worst)).toBeLessThan(surface === 'flat' ? 0.025 : 0.05);
    expect(steps[1]).toBeLessThan(surface === 'flat' ? 0.04 : 0.065);
    expect(accelerations[0]).toBeLessThan(60);
    expect(accelerations[1]).toBeLessThan(60);
});


it('finishes a reload begun before a sprint, the magazine seated while it runs', async () => {
  const { world, movement, avatar, acquire } = await soldierOn((scene) => box(scene, [200, 1, 200], [0, -0.5, 0]));
  acquire();
  avatar.requestReload();
  movement.input.move.z = 1;
  movement.input.sprint = true;
  for (let frame = 0; frame < 300 && avatar.reloading; frame++) world.update(DT);
  expect(movement.sprinting).toBe(true);
  expect(avatar.reloads).toBe(1);
  expect(node(avatar.group, 'magazine 2').parent?.name).toBe('well');
});
