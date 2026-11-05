import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { lookDirection } from '../src/angles';
import { Avatar, type AvatarState } from '../src/avatar';
import { TUNNEL_CLEARANCE } from '../src/environment';
import { RigidBody } from '@drawcall/physics';
import { avatarAt, box, DT, node, soldierOn } from './course';

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

  it('throws the spent magazine away and seats the full one before reporting a completed reload, a fresh spare in the pouch', async () => {
    const { world, movement, avatar, acquire, advance: run } = await soldierOn((scene) => box(scene, [60, 1, 60], [0, -0.5, 0]));
    acquire();
    const magazine = node(avatar.group, 'magazine 1'), full = node(avatar.group, 'magazine 2'), hand = avatar.body.bones.leftHand;
    expect(magazine.parent?.name).toBe('well');
    movement.input.aim = false;
    avatar.requestReload();
    expect(avatar.reloading).toBe(true);
    // (each magazine held as taken, the spent one out of the well until it is thrown, the full one from its pouch up part way into the
    // well: regripped, they slid through a still hand; then let go there and driven home as the palm comes under its floor plate)
    const held: number[] = [], thrown: number[] = [], places: string[] = [];
    let frames = 0;
    for (; frames < 600 && avatar.reloading; frames++) {
      world.update(DT);
      const place = full.parent?.name ?? '';
      if (places[places.length - 1] !== place) places.push(place);
      if (full.parent === hand && !places.includes('part way in')) held.push(full.getWorldPosition(new Vector3()).distanceTo(hand.getWorldPosition(new Vector3())));
      if (magazine.parent === hand) thrown.push(magazine.getWorldPosition(new Vector3()).distanceTo(hand.getWorldPosition(new Vector3())));
    }
    expect(frames / 60).toBeLessThan(4.2);
    expect(places).toEqual(['pouch 1', hand.name, 'part way in', 'well']);
    for (const distances of [held, thrown]) expect(Math.max(...distances) - Math.min(...distances)).toBeLessThan(0.01);
    expect(avatar.reloads).toBe(1);
    expect(node(avatar.group, 'magazine 2').parent?.name).toBe('well');
    expect(node(avatar.group, 'magazine 4').parent?.name).toBe('pouch 1');
    // (off the body, a body of its own come to rest on the floor, lying down)
    run(2);
    expect(avatar.group.getObjectByName('magazine 1')).toBeUndefined();
    const body = magazine.parent;
    if (!(body instanceof RigidBody)) throw new Error('The thrown magazine is no rigid body');
    expect(body.getVelocity().linear.length()).toBeLessThan(0.01);
    expect(magazine.getWorldPosition(new Vector3()).y).toBeLessThan(0.05);
    expect(Math.abs(new Vector3(0, 1, 0).applyQuaternion(magazine.getWorldQuaternion(new Quaternion())).y)).toBeLessThan(0.3);
    expect(magazine.getWorldPosition(new Vector3()).distanceTo(movement.position)).toBeGreaterThan(0.3);
  });

  it.each([true, false].flatMap((firstPerson) => [-1.2, -0.6, 0.6, 1.2].map((pitch) => ({ firstPerson, pitch }))))(
    'reloads while looking at pitch $pitch in first-person=$firstPerson', ({ firstPerson, pitch }) => {
      const input = state();
      input.position.set(0, 0, 0);
      input.firstPerson = firstPerson;
      input.pitch = pitch;
      const avatar = avatarAt(input);
      advance(avatar, input, 180);
      if (!firstPerson) {
        const direction = new Vector3(0, Math.sin(pitch), Math.cos(pitch));
        input.aimPoint = new Vector3(0, 1.68, 0).addScaledVector(direction, pitch < 0 ? 1.68 / -direction.y : 120);
      }
      advance(avatar, input, 60);
      input.aim = false;
      avatar.requestReload();
      for (let frame = 0; frame < 300 && avatar.reloading; frame++) avatar.update(1 / 60, input);
      expect(avatar.reloading).toBe(false);
      expect(avatar.reloads).toBe(1);
      expect(node(avatar.group, 'magazine 2').parent?.name).toBe('well');
      // The return to the handguard must also succeed after the new magazine seats.
      advance(avatar, input, 300);
      expect(avatar.fire()).toBe(true);
    },
  );

  it.each([3, 3.5, 4, 4.4, 4.8, 6, 7.2])('completes a reload while turning in place at %s rad/s', (rate) => {
    const input = state();
    input.aim = false;
    const avatar = avatarAt(input);
    advance(avatar, input, 180);
    avatar.requestReload();
    for (let frame = 0; frame < 480 && avatar.reloading; frame++) {
      input.yaw += rate / 60;
      avatar.update(1 / 60, input);
    }
    expect(avatar.reloading).toBe(false);
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
