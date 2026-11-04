import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import { box, DT, node, palm, soldierOn } from './course';

it.each(['standing', 'walking', 'sprinting', 'aiming'] as const)('keeps the body and held rifle continuous when landing %s', async (mode) => {
  const { world, movement, avatar, advance } = await soldierOn((scene) => box(scene, [60, 1, 60], [0, -0.5, 0]));
  const aiming = mode === 'aiming';
  movement.input.aim = aiming;
  const gaps = () => (['left', 'right'] as const).map((side) => {
    return palm(avatar.body, side).distanceTo(node(avatar.group, side === 'left' ? 'foregrip' : 'pistol').getWorldPosition(new Vector3()));
  });
  const eyeFrame = node(avatar.group, aiming ? 'sight' : 'right eye'), eyeOffset = new Vector3();
  const read = (frame: number) => ({
    frame, grounded: movement.grounded, capsule: movement.position.y, vy: movement.actualVelocity.y,
    hip: avatar.body.bones.hips.getWorldPosition(new Vector3()).y,
    eye: eyeFrame.localToWorld(eyeOffset.clone()), look: avatar.look().eye,
    grip: node(avatar.group, 'pistol').getWorldPosition(new Vector3()).y, gaps: gaps(),
  });
  advance(3);
  expect(avatar.acquired).toBe(true);
  movement.input.move.z = mode === 'standing' ? 0 : 1;
  movement.input.sprint = mode === 'sprinting';
  advance(1);
  // Keep eye relief fixed while its actual head/sight frame follows the newly solved pose.
  eyeFrame.worldToLocal(eyeOffset.copy(avatar.look().eye));
  if (aiming) {
    expect(Math.hypot(eyeOffset.x, eyeOffset.y)).toBeLessThan(1e-6);
    expect(eyeOffset.z).toBeGreaterThan(-0.2);
    expect(eyeOffset.z).toBeLessThan(-0.12);
  } else expect(eyeOffset.length()).toBeLessThan(1e-6);
  const records = [read(-1)];
  movement.input.jump = true;
  for (let frame = 0; frame < 100; frame++) {
    world.update(DT);
    records.push(read(frame));
  }
  let hipStep = 0, eyeStep = 0, eyePhase = 0, gripGap = 0, worstHip = 0, worstGrip = 0, landing = 0;
  for (let i = 1; i < records.length; i++) {
    const row = records[i], previous = records[i - 1];
    const bodyMove = Math.abs(row.hip - row.capsule - previous.hip + previous.capsule);
    if (bodyMove > hipStep) { hipStep = bodyMove; worstHip = i; }
    eyeStep = Math.max(eyeStep, Math.abs(row.look.y - previous.look.y));
    eyePhase = Math.max(eyePhase, row.look.distanceTo(row.eye));
    if (Math.max(...row.gaps) > gripGap) { gripGap = Math.max(...row.gaps); worstGrip = i; }
    if (row.grounded && !previous.grounded) landing = i;
  }
  const detail = JSON.stringify({ mode, touchdown: records.slice(landing - 1, landing + 2),
    worstHip: records[worstHip], worstGrip: records[worstGrip] });
  expect(landing).toBeGreaterThan(0);
  expect(hipStep, detail).toBeLessThan(0.06);
  expect(eyeStep, detail).toBeLessThan(0.1);
  expect(eyePhase, detail).toBeLessThan(1e-6);
  expect(gripGap, detail).toBeLessThan(0.05);
});
