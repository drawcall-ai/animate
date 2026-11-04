import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { SPEED } from '../src/movement';
import { box, DT, soldierOn } from './course';
import { expectSmooth, Motion } from './motion';

describe.each([0.45, 0.75])('a %s m block', (height) => {
  it('stops a sprint at its face, then takes a jump onto it, with every joint continuous', async () => {
    // The course's own block positions.
    const x = -17.7, z = height === 0.45 ? 0.6 : 3.4;
    const { world, movement, avatar, acquire } = await soldierOn((scene) => {
      box(scene, [40, 1, 40], [0, -0.5, 0]);
      box(scene, [1.35, height, 1.35], [x, height / 2, z]);
    }, { spawn: new Vector3(x, 0.02, z - 3) });
    acquire();
    const blocked = new Motion(avatar.body);
    movement.input.move.z = 1;
    movement.input.sprint = true;
    let speed = 0;
    for (let frame = 0; frame < 300; frame++) {
      world.update(DT);
      blocked.sample(frame);
      speed = Math.max(speed, movement.speed);
      if (frame < 150) continue;
      expect(movement.actualVelocity.length()).toBeLessThan(1e-6);
      expect(movement.grounded).toBe(true);
      expect(avatar.body.feet.every((foot) => foot.planted)).toBe(true);
    }
    expect(speed).toBeCloseTo(SPEED.sprint, 5);
    expect(movement.position.z).toBeLessThan(z - 0.95);
    const jumping = new Motion(avatar.body);
    let landed = false;
    for (let frame = 0; frame < 180; frame++) {
      movement.input.jump = frame < 60;
      if (movement.position.z > z - 0.3) movement.input.move.z = 0;
      world.update(DT);
      jumping.sample(frame);
      landed ||= movement.grounded && movement.position.y > height - 0.01;
    }
    expect(landed).toBe(true);
    expect(movement.position.y).toBeCloseTo(height + 0.004, 3);
    expectSmooth(blocked);
    expectSmooth(jumping);
  }, 20000);

  it('keeps the body supported when sprint-jumping onto it and walking off', async () => {
    const { world, movement, avatar, advance } = await soldierOn((scene) => {
      box(scene, [60, 1, 60], [0, -0.5, 0]);
      box(scene, [1.35, height, 1.35], [0, height / 2, 2]);
    });
    const read = (frame: number) => ({
      frame, grounded: movement.grounded, capsule: movement.position.toArray(), velocity: movement.actualVelocity.toArray(),
      hip: avatar.body.bones.hips.getWorldPosition(new Vector3()).y, eye: avatar.look().eye.y,
      feet: avatar.body.feet.map(foot => ({ planted: foot.planted, position: foot.position.toArray() })),
    });
    advance(3);
    const motion = new Motion(avatar.body);
    movement.input.move.z = 1;
    movement.input.sprint = true;
    const records = [read(-1)];
    for (let frame = 0; frame < 300; frame++) {
      if (movement.position.z > 0.2) movement.input.jump = true;
      if (movement.position.z > 2.2) movement.input.move.z = 0;
      world.update(DT);
      motion.sample(frame);
      records.push(read(frame));
    }
    movement.input.jump = movement.input.sprint = false;
    movement.input.move.z = 1;
    for (let frame = 300; frame < 420; frame++) {
      world.update(DT);
      motion.sample(frame);
      records.push(read(frame));
    }
    let hipStep = 0, eyeStep = 0, clearance = Infinity, worstHip = 0, worstEye = 0, lowest = 0;
    let landedOnBlock = false;
    for (let i = 1; i < records.length; i++) {
      const row = records[i], previous = records[i - 1];
      const hipMove = row.hip - previous.hip;
      const bodyMove = Math.abs(row.grounded && previous.grounded
        ? hipMove
        : hipMove - row.capsule[1] + previous.capsule[1]);
      if (bodyMove > hipStep) { hipStep = bodyMove; worstHip = i; }
      // The camera target uses the previous solved pose, so its physics displacement is one frame earlier too.
      const beforeEye = records[i - 2] ?? previous;
      const eyeMove = row.eye - previous.eye;
      const viewMove = Math.abs(previous.grounded && beforeEye.grounded
        ? eyeMove
        : eyeMove - previous.capsule[1] + beforeEye.capsule[1]);
      if (viewMove > eyeStep) { eyeStep = viewMove; worstEye = i; }
      if (row.grounded && row.hip - row.capsule[1] < clearance) {
        clearance = row.hip - row.capsule[1];
        lowest = i;
      }
      if (row.grounded && !previous.grounded && row.capsule[1] > height - 0.05) landedOnBlock = true;
    }
    const detail = JSON.stringify({ height, hip: records.slice(worstHip - 2, worstHip + 3),
      eye: records.slice(worstEye - 3, worstEye + 2), lowest: records[lowest] });
    expect(landedOnBlock).toBe(true);
    expect(hipStep, detail).toBeLessThan(0.06);
    expect(eyeStep, detail).toBeLessThan(0.1);
    // Foot placement must not drag the hips below a deeply bent stance above the physical support.
    expect(clearance, detail).toBeGreaterThan(0.55);
    expect(movement.grounded).toBe(true);
    expect(movement.position.y).toBeLessThan(0.02);
    expectSmooth(motion);
  });
});
