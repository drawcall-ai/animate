import { describe, expect, it } from 'vitest';
import { BoxCollider, RigidBody } from '@drawcall/physics';
import { Bone, Group, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { Playback } from '../src/playback';
import { box, course } from './course';

function setup() {
  const group = new Group();
  const bone = new Bone();
  const mount = new Object3D();
  mount.position.y = 1.4;
  const muzzle = new Object3D();
  muzzle.position.z = 0.6;
  group.add(bone);
  bone.add(mount);
  mount.add(muzzle);
  const look = { eye: new Vector3(0, 1.6, 0), yaw: 0, pitch: 0, intent: { yaw: 0, pitch: 0 } };
  const playback = new Playback([group], () => look, 1 / 60);
  return { group, bone, mount, muzzle, look, playback };
}

function expectVector(actual: Vector3, expected: Vector3) {
  expect(actual.distanceTo(expected)).toBeLessThan(1e-10);
}

describe('playback', () => {
  it('keeps rider and lift at the same render time across consecutive physics steps and restores bodies before queries', async () => {
    const { world, movement, built: { lift, crate, rider } } = await course((scene) => {
      const lift = box(scene, [6, 0.25, 6], [0, 0.125, 0], 'kinematic');
      const crate = new RigidBody({ bodyType: 'dynamic' });
      crate.position.set(4, 8, 0);
      crate.add(new BoxCollider({ size: [0.5, 0.5, 0.5] }));
      const rider = new Object3D();
      scene.add(crate, rider);
      return { lift, crate, rider };
    }, { spawn: new Vector3(0, 0.27, 0) });
    for (let step = 0; step < 10; step++) world.update(world.fixedDelta);
    rider.position.copy(movement.position);
    const look = { eye: rider.position.clone().add(new Vector3(0, 1.6, 0)), yaw: 0, pitch: 0, intent: { yaw: 0, pitch: 0 } };
    const gap = rider.position.y - lift.position.y;
    const playback = new Playback([rider, lift, crate], () => look, world.fixedDelta);
    const began = world.time;
    let previousCrate = crate.position.y, currentCrate = crate.position.y;
    world.onBeforeStep((dt) => lift.setKinematicTarget(new Matrix4().makeTranslation(0, 0.125 + world.time + dt - began, 0)));
    world.onAfterStep(() => {
      previousCrate = currentCrate;
      currentCrate = crate.position.y;
      playback.step(() => {
        rider.position.copy(movement.position);
        look.eye.copy(rider.position).y += 1.6;
      });
    });
    for (const steps of [1, 3, 2]) {
      world.update(world.fixedDelta * steps);
      expect(movement.grounded).toBe(true);
      const completed = lift.matrixWorld.clone();
      const prop = crate.matrixWorld.clone();
      const time = world.time;
      expect(lift.position.y).toBeCloseTo(0.125 + world.time - began, 6);
      for (const alpha of [0, 0.2, 0.5, 0.9, 1]) {
        const shown = playback.blend(alpha);
        expect(rider.position.y - lift.position.y).toBeCloseTo(gap, 5);
        expect(shown.eye.y - lift.position.y).toBeCloseTo(gap + 1.6, 5);
        expect(crate.position.y).toBeCloseTo(previousCrate + (currentCrate - previousCrate) * alpha, 10);
        playback.restore();
        expect(lift.matrixWorld.elements).toEqual(completed.elements);
        expect(crate.matrixWorld.elements).toEqual(prop.elements);
        expect(world.time).toBe(time);
        const hit = world.raycast(new Vector3(0, 5, 0), new Vector3(0, -1, 0), 10);
        expect(hit?.point.y).toBeCloseTo(lift.position.y + 0.125, 6);
        expect(lift.matrixWorld.elements).toEqual(completed.elements);
        expect(crate.matrixWorld.elements).toEqual(prop.elements);
        expect(world.time).toBe(time);
      }
    }
  });

  it('interpolates capsule transport, bones, a mounted rifle and the camera eye at one instant', () => {
    const { group, bone, muzzle, look, playback } = setup();
    playback.step(() => {
      group.position.y = 2;
      bone.position.x = 4;
      bone.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
      look.eye.set(4, 3.6, 0);
      look.yaw = Math.PI / 2;
      look.pitch = 0.4;
    });
    const shown = playback.blend(0.5);
    expectVector(group.position, new Vector3(0, 1, 0));
    expectVector(bone.getWorldPosition(new Vector3()), new Vector3(2, 1, 0));
    expect(bone.quaternion.angleTo(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4))).toBeLessThan(1e-7);
    expectVector(muzzle.getWorldPosition(new Vector3()), new Vector3(2 + 0.6 * Math.SQRT1_2, 2.4, 0.6 * Math.SQRT1_2));
    expectVector(shown.eye, new Vector3(2, 2.6, 0));
    expect(shown.yaw).toBeCloseTo(Math.PI / 4);
    expect(shown.pitch).toBeCloseTo(0.2);
  });

  it('restores exact simulation transforms without accumulating display drift', () => {
    const { group, bone, mount, look, playback } = setup();
    const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.73);
    playback.step(() => {
      group.position.set(1, 2, 3);
      bone.position.set(0.2, 0.3, 0.4);
      bone.quaternion.copy(turn);
      mount.position.set(0.1, 0.2, 0.3);
      look.eye.set(2, 3, 4);
    });
    for (let frame = 0; frame < 100; frame++) {
      playback.blend((frame % 17) / 17);
      playback.restore();
      expect(group.position.toArray()).toEqual([1, 2, 3]);
      expect(bone.position.toArray()).toEqual([0.2, 0.3, 0.4]);
      expect(bone.quaternion.toArray()).toEqual(turn.toArray());
      expect(mount.position.toArray()).toEqual([0.1, 0.2, 0.3]);
    }
    playback.blend(0.1);
    playback.restore();
    playback.step(() => {
      expect(group.position.toArray()).toEqual([1, 2, 3]);
      group.position.y += 1;
      look.eye.y += 1;
    });
    playback.blend(0.5);
    expect(group.position.y).toBe(2.5);
  });

  it('snaps a transferred magazine to its new parent frame instead of interpolating unrelated coordinates', () => {
    const { group, playback } = setup();
    const hand = new Object3D(), pouch = new Object3D(), magazine = new Object3D();
    hand.position.x = 10;
    pouch.position.x = -10;
    hand.add(magazine);
    group.add(hand, pouch);
    magazine.position.x = 0.2;
    playback.reset();
    playback.step(() => {
      pouch.add(magazine);
      magazine.position.x = 0.4;
    });
    playback.blend(0);
    expect(magazine.parent).toBe(pouch);
    expect(magazine.position.x).toBe(0.4);
    expectVector(magazine.getWorldPosition(new Vector3()), new Vector3(-9.6, 0, 0));
    playback.restore();
    expect(magazine.parent).toBe(pouch);
    expect(magazine.position.x).toBe(0.4);
  });

  it('leaves a node moved to another parent between steps, such as a dropped rifle, where its new parent holds it', () => {
    const { group, playback } = setup();
    const hand = new Object3D(), rifle = new Object3D(), body = new Object3D();
    hand.position.x = 10;
    rifle.position.x = 0.2;
    hand.add(rifle);
    group.add(hand);
    playback.reset();
    playback.step(() => { rifle.position.x = 0.3; });
    body.position.x = -5;
    group.updateMatrixWorld(true);
    body.updateMatrixWorld(true);
    body.attach(rifle);
    playback.blend(0.5);
    expect(rifle.parent).toBe(body);
    expect(rifle.position.x).toBeCloseTo(15.3, 10);
    playback.restore();
    expect(rifle.position.x).toBeCloseTo(15.3, 10);
  });

  it('reset discards the old body and look after a respawn, without interpolating scale', () => {
    const { group, look, playback } = setup();
    playback.step(() => { group.position.y = 5; look.eye.y = 6.6; });
    playback.restore();
    group.clear();
    const replacement = new Bone();
    replacement.position.x = 7;
    replacement.scale.setScalar(2);
    group.add(replacement);
    group.position.y = 0;
    look.eye.set(7, 1.6, 0);
    playback.reset();
    const shown = playback.blend(0.25);
    expect(group.position.y).toBe(0);
    expect(replacement.position.x).toBe(7);
    expect(replacement.scale.toArray()).toEqual([2, 2, 2]);
    expectVector(shown.eye, look.eye);
    shown.eye.set(100, 100, 100);
    expectVector(playback.blend(0.5).eye, look.eye);
  });
});
