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
});

it('turns the sights evenly while turning in place aiming down them', async () => {
  const frames = await turnInPlace(true);
  expect(jump(frames.map((frame) => frame.muzzle - frame.camera))).toBeLessThan(1e-5);
  expect(jump(frames.slice(1).map((frame, i) => frame.camera - frames[i].camera))).toBeLessThan(1e-4);
});

it('keeps both hands on the rifle through a 10 rad/s flick the body cannot keep up with', async () => {
  const rate = 10;
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
});

it('keeps the rifle on the camera and both hands on it through two 8 rad/s turns, the body pivoting round after them', async () => {
  const { world, movement, avatar, acquire } = await soldierOn((scene) => box(scene, [40, 1, 40], [0, -0.5, 0]));
  acquire();
  const pistol = node(avatar.group, 'pistol'), foregrip = node(avatar.group, 'foregrip');
  const muzzle = () => { const at = avatar.muzzle.getWorldDirection(new Vector3()); return Math.atan2(at.x, at.z); };
  const zero = wrapAngle(muzzle() - movement.input.yaw);
  let lag = 0, jump = 0, off = 0, last = 0;
  for (let frame = 0; frame < 120; frame++) {
    // Half a second's turn, 20 ticks still, then 0.3 s more.
    if (frame < 30 || (frame >= 50 && frame < 68)) movement.input.yaw += 8 * DT;
    world.update(DT);
    const behind = wrapAngle(muzzle() - movement.input.yaw - zero);
    [lag, jump, last] = [Math.max(lag, Math.abs(behind)), Math.max(jump, Math.abs(behind - last)), behind];
    off = Math.max(off, offGrip(avatar.body, 'right', pistol), offGrip(avatar.body, 'left', foregrip));
  }
  expect(lag).toBeLessThan(0.05);
  expect(jump).toBeLessThan(0.02);
  expect(off).toBeLessThan(0.01);
});

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
});

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
});
