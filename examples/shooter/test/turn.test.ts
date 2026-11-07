import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import { wrapAngle } from '../src/angles';
import { Playback } from '../src/playback';
import { box, DT, node, offGrip, soldierOn, soldiers } from './course';

const RATE = 2;

/**
 * Turns the player in place at `RATE` rad/s, rendered at 144 Hz against the 60 Hz simulation in main.ts's order, and returns per
 * rendered frame the camera's yaw and the displayed muzzle's yaw.
 */
async function turnInPlace(aim: boolean) {
  const { world, soldiers: [player] } = await soldiers((scene) => box(scene, [40, 1, 40], [0, -0.5, 0]), ['Player', new Vector3(0, 0.04, 0), true]);
  const { avatar, movement } = player;
  const playback = new Playback([avatar.group], () => avatar.look(), world.fixedDelta);
  world.onAfterStep((dt) => playback.step(() => player.update(dt)));
  for (let frame = 0; frame < 240; frame++) world.update(world.fixedDelta);
  movement.input.aim = aim;
  let yaw = 0;
  const frames: { camera: number; muzzle: number }[] = [];
  for (let frame = 0; frame < 300; frame++) {
    const dt = 1 / 144;
    yaw += RATE * dt;
    movement.input.yaw = yaw;
    const before = world.time;
    world.update(dt);
    playback.advance(dt, world.time - before);
    const look = avatar.face(playback.blend(playback.alpha), yaw, player.view.pitch);
    const muzzle = avatar.muzzle.getWorldDirection(new Vector3());
    playback.restore();
    if (frame > 60) frames.push({ camera: look.yaw, muzzle: Math.atan2(muzzle.x, muzzle.z) });
  }
  return frames;
}

const jump = (values: number[]) => Math.max(...values.slice(1).map((value, i) => Math.abs(wrapAngle(value - values[i]))));

it('keeps the rifle rigid with the camera while turning in place from the hip', async () => {
  const frames = await turnInPlace(false);
  expect(jump(frames.map((frame) => frame.muzzle - frame.camera))).toBeLessThan(0.001);
}, 30000);

it('turns the sights evenly while turning in place aiming down them', async () => {
  const frames = await turnInPlace(true);
  expect(jump(frames.map((frame) => frame.muzzle - frame.camera))).toBeLessThan(1e-5);
  expect(jump(frames.slice(1).map((frame, i) => frame.camera - frames[i].camera))).toBeLessThan(1e-4);
}, 30000);

it.each([6, 10])('keeps both hands on the rifle through a %s rad/s flick the body cannot keep up with', async (rate) => {
  const { world, movement, avatar, acquire } = await soldierOn((scene) => box(scene, [40, 1, 40], [0, -0.5, 0]));
  acquire();
  const pistol = node(avatar.group, 'pistol'), foregrip = node(avatar.group, 'foregrip');
  let off = 0;
  for (let frame = 0; frame < 270; frame++) {
    // Flick half a turn, then hold, three times over.
    if (frame % 90 < Math.ceil(Math.PI / (rate * DT))) movement.input.yaw += rate * DT;
    world.update(DT);
    off = Math.max(off, offGrip(avatar.body, 'right', pistol), offGrip(avatar.body, 'left', foregrip));
  }
  expect(off).toBeLessThan(0.06);
}, 30000);

it('keeps the sights on the mouse through a 6 rad/s flick aiming down them', async () => {
  const { world, movement, avatar, acquire } = await soldierOn((scene) => box(scene, [40, 1, 40], [0, -0.5, 0]));
  movement.input.aim = true;
  acquire();
  let off = 0;
  for (let frame = 0; frame < 120; frame++) {
    if (frame % 60 < 24) movement.input.yaw += 6 * DT;
    world.update(DT);
    off = Math.max(off, Math.abs(wrapAngle(avatar.look().yaw - movement.input.yaw)));
  }
  expect(off).toBeLessThan(0.02);
}, 30000);

it('brings the rifle back to the crosshair without passing it after a flick, at 20 fps', async () => {
  const { world, soldiers: [player] } = await soldiers((scene) => box(scene, [40, 1, 40], [0, -0.5, 0]), ['Player', new Vector3(0, 0.04, 0), true]);
  const { avatar, movement } = player;
  const playback = new Playback([avatar.group], () => avatar.look(), world.fixedDelta);
  world.onAfterStep((dt) => playback.step(() => player.update(dt)));
  for (let frame = 0; frame < 240; frame++) world.update(world.fixedDelta);
  let yaw = 0, past = 0;
  for (let frame = 0; frame < 40; frame++) {
    // A 6 rad/s flick for 0.3 s, then still.
    if (frame < 6) yaw += 6 / 20;
    movement.input.yaw = yaw;
    const before = world.time;
    world.update(1 / 20);
    playback.advance(1 / 20, world.time - before);
    const look = avatar.face(playback.blend(playback.alpha), yaw, player.view.pitch);
    const muzzle = avatar.muzzle.getWorldDirection(new Vector3());
    playback.restore();
    past = Math.max(past, wrapAngle(Math.atan2(muzzle.x, muzzle.z) - look.yaw));
  }
  // (the barrel's zero puts it a few milliradians across the view at rest)
  expect(past).toBeLessThan(0.01);
}, 30000);
