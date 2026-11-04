import { expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import type { AvatarState } from '../src/avatar';
import { WeaponMotion } from '../src/weapon/motion';
import { avatarAt, DT, node } from './course';
import { expectSmooth, Motion } from './motion';

function setup() {
  const input: AvatarState = {
    position: new Vector3(), velocity: new Vector3(), yaw: 0, pitch: 0,
    aim: false, sprint: false, crouch: false, support: new Vector3(), firstPerson: true,
  };
  const avatar = avatarAt(input);
  for (let frame = 0; frame < 180; frame++) avatar.update(DT, input);
  const rifle = node(avatar.group, 'rifle');
  const relative = () => rifle.getWorldPosition(new Vector3()).sub(avatar.look().eye);
  return { avatar, input, rifle, relative };
}

it('carries the procedural stride into the held rifle without snapping, with stronger motion when running', () => {
  const ranges = [1.4, 3.5].map((speed) => {
    const { avatar, input, relative } = setup();
    input.sprint = speed > 2;
    input.velocity.z = speed;
    const low = new Vector3(Infinity, Infinity, Infinity), high = low.clone().negate();
    const heights: number[] = [];
    for (let frame = 0; frame < 240; frame++) {
      input.position.addScaledVector(input.velocity, DT);
      input.support?.copy(input.position);
      avatar.update(DT, input);
      if (frame > 60) { const at = relative(); heights.push(at.y); low.min(at); high.max(at); }
    }
    if (!input.sprint) {
      const travel = heights.slice(1).map((height, index) => height - heights[index]);
      const change = travel.slice(1).map((distance, index) => distance - travel[index]);
      expect(Math.max(...travel.map(Math.abs))).toBeLessThan(0.004);
      expect(Math.max(...change.map(Math.abs))).toBeLessThan(0.003);
    }
    input.velocity.set(0, 0, 0);
    for (let frame = 0; frame < 180; frame++) avatar.update(DT, input);
    const stopped = relative();
    let idle = 0;
    for (let frame = 0; frame < 60; frame++) {
      avatar.update(DT, input);
      idle = Math.max(idle, relative().distanceTo(stopped));
    }
    expect(idle).toBeLessThan(0.01);
    return high.sub(low).length();
  });
  expect(ranges[0]).toBeGreaterThan(0.012);
  expect(ranges[1]).toBeGreaterThan(ranges[0] * 1.2);
});

it('kicks the barrel around the shouldered stock immediately after firing, then recovers', () => {
  const { avatar, input, rifle, relative } = setup();
  input.aim = true;
  for (let frame = 0; frame < 60; frame++) avatar.update(DT, input);
  const before = relative();
  expect(avatar.fire()).toBe(true);
  avatar.update(DT, input);
  const forward = new Vector3(0, 0, 1).applyQuaternion(rifle.getWorldQuaternion(new Quaternion()));
  expect(Math.asin(forward.y)).toBeGreaterThan(0.08);
  expect(avatar.look().pitch).toBeGreaterThan(0.015);
  for (let frame = 0; frame < 60; frame++) avatar.update(DT, input);
  expect(relative().distanceTo(before)).toBeLessThan(0.003);
});

it('absorbs a shot through the shoulder and torso while the soles stay planted', () => {
  const { avatar, input } = setup();
  input.aim = true;
  for (let frame = 0; frame < 60; frame++) avatar.update(DT, input);
  const shoulder = node(avatar.group, 'rightUpperArm'), chest = node(avatar.group, 'chest');
  const at = shoulder.getWorldPosition(new Vector3());
  const turn = chest.getWorldQuaternion(new Quaternion());
  const feet = avatar.body.feet.map(foot => foot.position.clone());
  const motion = new Motion(avatar.body);
  avatar.fire();
  let setback = 0, rotation = 0;
  for (let frame = 0; frame < 60; frame++) {
    avatar.update(DT, input);
    motion.sample(frame);
    setback = Math.max(setback, at.z - shoulder.getWorldPosition(new Vector3()).z);
    rotation = Math.max(rotation, turn.angleTo(chest.getWorldQuaternion(new Quaternion())));
    avatar.body.feet.forEach((foot, index) => {
      expect(foot.planted).toBe(true);
      expect(foot.position.distanceTo(feet[index])).toBeLessThan(0.01);
    });
  }
  expect(setback).toBeGreaterThan(0.012);
  expect(rotation).toBeGreaterThan(0.025);
  expect(shoulder.getWorldPosition(new Vector3()).distanceTo(at)).toBeLessThan(0.015);
  expectSmooth(motion);
});

it.each([false, true])('points a soldier seen from outside its barrel at its aim point with aim=%s', aim => {
  const { avatar, input } = setup();
  input.aim = aim;
  input.firstPerson = false;
  input.aimPoint = new Vector3(0.7, 1.5, 8);
  for (let frame = 0; frame < 90; frame++) avatar.update(DT, input);
  const muzzle = avatar.muzzle.getWorldPosition(new Vector3());
  const forward = avatar.muzzle.getWorldDirection(new Vector3());
  expect(forward.angleTo(input.aimPoint.clone().sub(muzzle))).toBeLessThan(0.001);
});

it('keeps the physical stock pad in the shoulder pocket while moving, jumping, and firing', () => {
  const { avatar, input } = setup();
  const stock = node(avatar.group, 'stock'), pocket = node(avatar.group, 'shoulder pocket');
  expect(pocket.parent).toBe(avatar.body.bones.chest);
  for (let frame = 0; frame < 180; frame++) {
    input.velocity.z = 1.4;
    input.position.z += 1.4 * DT;
    const airborne = frame > 60 && frame < 103, time = (frame - 60) * DT;
    input.position.y = airborne ? Math.max(0, 5 * time - 7 * time ** 2) : 0;
    input.velocity.y = airborne ? 5 - 14 * time : 0;
    input.support = airborne ? null : input.position.clone();
    input.yaw = frame * 0.004;
    input.pitch = Math.sin(frame * 0.03) * 0.2;
    if (frame % 20 === 0) avatar.fire();
    avatar.update(DT, input);
    expect(stock.getWorldPosition(new Vector3()).distanceTo(pocket.getWorldPosition(new Vector3()))).toBeLessThan(0.001);
  }
});

it('absorbs a brief torso contact correction without repeating it as a hand impulse', () => {
  const motion = new WeaponMotion();
  const chest = new Vector3(0, 1.2, 0);
  motion.update(DT, chest);
  let previous = 0, travel = 0;
  for (let frame = 0; frame < 120; frame++) {
    chest.y = 1.2 - (frame < 2 ? 0.012 : 0);
    motion.update(DT, chest);
    travel = Math.max(travel, Math.abs(motion.drift.position.y - previous));
    previous = motion.drift.position.y;
  }
  expect(travel).toBeGreaterThan(0.0001);
  expect(travel).toBeLessThan(0.003);
  expect(Math.abs(previous)).toBeLessThan(0.00001);
});
