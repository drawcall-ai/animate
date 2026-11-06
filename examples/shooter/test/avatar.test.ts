import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { lookDirection } from '../src/angles';
import { Avatar, type AvatarState } from '../src/avatar';
import { TUNNEL_CLEARANCE } from '../src/environment';
import { RigidBody } from '@drawcall/physics';
import { avatarAt, box, DT, node, offGrip, soldierOn } from './course';

const state = (): AvatarState => ({
  position: new Vector3(3, 0, -4), velocity: new Vector3(), yaw: 0, pitch: 0,
  aim: true, sprint: false, crouch: false, support: new Vector3(3, 0, -4), firstPerson: true,
});


function advance(avatar: Avatar, input: AvatarState, frames: number) {
  for (let i = 0; i < frames; i++) avatar.update(1 / 60, input);
}

function sightError(avatar: Avatar) {
  const look = avatar.look();
  const direction = lookDirection(look.yaw, look.pitch);
  const sight = node(avatar.group, 'sight').getWorldPosition(new Vector3()).sub(look.eye);
  return sight.addScaledVector(direction, -sight.dot(direction)).length();
}

describe('avatar', () => {
  it('preserves the sight line when the capsule changes elevation', () => {
    const input = state(), avatar = avatarAt(input);
    advance(avatar, input, 180);
    expect(avatar.acquired).toBe(true);
    expect(sightError(avatar)).toBeLessThan(0.01);
    input.support = null;
    for (let frame = 0; frame < 40; frame++) {
      const time = frame / 60;
      input.position.y = 5 * time - 7 * time * time;
      input.velocity.y = 5 - 14 * time;
      avatar.update(1 / 60, input);
      expect(sightError(avatar)).toBeLessThan(0.01);
      expect(avatar.look().eye.y - input.position.y).toBeGreaterThan(1.3);
      expect(avatar.look().eye.y - input.position.y).toBeLessThan(1.9);
    }
  });

  it('keeps the sights on the eye line and the heading continuous through a complete mouse turn', () => {
    const input = state(), avatar = avatarAt(input);
    advance(avatar, input, 180);
    let previous = avatar.look().yaw;
    for (let frame = 0; frame < 240; frame++) {
      input.yaw += 0.03;
      input.pitch = Math.sin(frame / 30) * 0.25;
      avatar.update(1 / 60, input);
      expect(sightError(avatar)).toBeLessThan(0.001);
      const forward = new Vector3(0, 0, 1).applyQuaternion(node(avatar.group, 'rifle').getWorldQuaternion(new Quaternion()));
      expect(forward.y).toBeCloseTo(Math.sin(avatar.look().pitch), 6);
      expect(Math.abs(avatar.look().pitch - input.pitch)).toBeLessThan(0.04);
      expect(Math.abs(avatar.look().yaw - previous)).toBeLessThan(0.06);
      previous = avatar.look().yaw;
    }
  });

  it('swaps the magazine, both hands back on the rifle, the spent one thrown to rest on the floor away from the soldier', async () => {
    const { world, movement, avatar, acquire, advance: run } = await soldierOn((scene) => box(scene, [60, 1, 60], [0, -0.5, 0]));
    acquire();
    const spent = node(avatar.group, 'magazine 1');
    // (each hand as far off its grip as it held it before)
    const offGrips = () => (['left', 'right'] as const).map((side) => offGrip(avatar.body, side, node(avatar.group, side === 'left' ? 'foregrip' : 'pistol')));
    const before = offGrips();
    movement.input.aim = false;
    avatar.requestReload();
    for (let frame = 0; frame < 600 && avatar.reloading; frame++) world.update(DT);
    expect(avatar.reloading).toBe(false);
    expect(avatar.reloads).toBe(1);
    expect(node(avatar.group, 'magazine 2').parent?.name).toBe('well');
    expect(node(avatar.group, 'magazine 4').parent?.name).toBe('pouch 1');
    run(1);
    offGrips().forEach((off, k) => expect(off).toBeLessThan(before[k] + 0.01));
    const body = spent.parent;
    if (!(body instanceof RigidBody)) throw new Error('The thrown magazine is no rigid body');
    expect(body.getVelocity().linear.length()).toBeLessThan(0.05);
    expect(spent.getWorldPosition(new Vector3()).y).toBeLessThan(0.05);
    expect(spent.getWorldPosition(new Vector3()).distanceTo(movement.position)).toBeGreaterThan(0.3);
  });

  // (the reload in front of the chest whatever the view: looking steeply down from the eye, and up from outside)
  it.each([{ firstPerson: true, pitch: -1.2 }, { firstPerson: false, pitch: 1.2 }])(
    'reloads while looking at pitch $pitch in first-person=$firstPerson', ({ firstPerson, pitch }) => {
      const input = state();
      input.position.set(0, 0, 0);
      input.firstPerson = firstPerson;
      input.pitch = pitch;
      const avatar = avatarAt(input);
      advance(avatar, input, 180);
      if (!firstPerson) {
        const direction = new Vector3(0, Math.sin(pitch), Math.cos(pitch));
        input.aimPoint = new Vector3(0, 1.68, 0).addScaledVector(direction, 120);
      }
      advance(avatar, input, 60);
      input.aim = false;
      avatar.requestReload();
      for (let frame = 0; frame < 600 && avatar.reloading; frame++) avatar.update(1 / 60, input);
      expect(avatar.reloads).toBe(1);
      expect(node(avatar.group, 'magazine 2').parent?.name).toBe('well');
      advance(avatar, input, 120);
      expect(avatar.fire()).toBe(true);
    },
  );

  it.each([4, 7.2])('completes a reload while turning in place at %s rad/s', (rate) => {
    const input = state();
    input.aim = false;
    const avatar = avatarAt(input);
    advance(avatar, input, 180);
    avatar.requestReload();
    for (let frame = 0; frame < 600 && avatar.reloading; frame++) {
      input.yaw += rate / 60;
      avatar.update(1 / 60, input);
    }
    expect(avatar.reloads).toBe(1);
    expect(node(avatar.group, 'magazine 2').parent?.name).toBe('well');
  });

  it('holds fire at a steady 600 rounds a minute on the 60 Hz simulation', () => {
    const input = state(), avatar = avatarAt(input);
    advance(avatar, input, 180);
    const shots: number[] = [];
    for (let frame = 0; frame < 600; frame++) {
      if (avatar.fire()) shots.push(frame);
      avatar.update(1 / 60, input);
    }
    expect(shots).toHaveLength(100);
    expect(new Set(shots.slice(1).map((frame, i) => frame - shots[i]))).toEqual(new Set([6]));
  });

  it('fires from a sprint once the rifle comes up, a short moment after the sprint ends', () => {
    const input = state();
    input.aim = false;
    const avatar = avatarAt(input);
    advance(avatar, input, 180);
    input.sprint = true;
    advance(avatar, input, 60);
    expect(avatar.fire()).toBe(false);
    input.sprint = false;
    let frames = 0;
    while (!avatar.fire() && frames < 60) { avatar.update(1 / 60, input); frames++; }
    expect(frames / 60).toBeGreaterThan(0.08);
    expect(frames / 60).toBeLessThan(0.2);
  });

  it('keeps the crouched eye below the tunnel ceiling', () => {
    const input = state(), avatar = avatarAt(input);
    advance(avatar, input, 180);
    input.crouch = true;
    advance(avatar, input, 180);
    expect(avatar.look().eye.y - input.position.y + 0.12).toBeLessThan(TUNNEL_CLEARANCE);
  });

  it('resets the story on respawn', () => {
    const input = state(), avatar = avatarAt(input);
    advance(avatar, input, 180);
    input.position.set(-3, 0, 5);
    avatar.reset(input.position);
    expect(avatar.acquired).toBe(false);
    advance(avatar, input, 180);
    expect(avatar.acquired).toBe(true);
    expect(avatar.look().eye.distanceTo(input.position)).toBeLessThan(2);
    expect(sightError(avatar)).toBeLessThan(0.01);
  });
});
