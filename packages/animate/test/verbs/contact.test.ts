import { CylinderGeometry, Mesh, Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { runTimeline } from '@pmndrs/timeline';
import { Body, carry, grab, humanoid, POINT, wait } from '../../src/index';
import { play } from '../bodies';
import { FINGERED } from '../skeletons/fingered';
import { empty, roomOf } from '../things';

/** a body with fingers and a rod of `radius` before its left hip, grip `point` on the rod's side `up` above its middle, and how far that point of the left hand lies off it */
function rodBefore(point: 'thumb' | 'palm', radius: number, { scale = 1, up = 0, owned = false } = {}) {
  const body = new Body(humanoid(FINGERED), { dev: true, life: { seed: 3, steady: 1 } }), room = roomOf(body);
  const rod = new Mesh(new CylinderGeometry(radius, radius, 0.1, 16));
  rod.userData.mass = 0.02;
  rod.position.set(0.28, 1.02, 0.3);
  rod.scale.setScalar(scale);
  if (owned) {
    rod.updateMatrix();
    rod.matrixAutoUpdate = false;
    rod.scale.setScalar(1);
  }
  room.add(rod);
  const grip = empty(rod, 'grip', new Vector3(-radius, up, 0));
  if (point !== 'palm') grip.userData.point = point;
  const { wrist, rotation } = body.gripOn('left', { on: new Object3D(), point, position: new Vector3(), quaternion: new Quaternion(), fingers: POINT });
  const onHand = wrist.negate().applyQuaternion(rotation.invert());
  const gap = () => body.bones.leftHand.localToWorld(onHand.clone()).distanceTo(grip.getWorldPosition(new Vector3()));
  return { body, room, rod, grip, gap };
}

const above = () => {
  const target = new Object3D();
  target.position.set(0.3, 1.45, 0.25);
  return target;
};

describe('a hand on what a grip declares', () => {
  it.each([[60, 1, false], [12, 1, false], [60, 1.3, false], [60, 2, true]])('ends a grab with its pad on the grip and keeps it there (%i Hz, the thing scaled %f, by a matrix of the app\'s: %s)', (hz, scale, owned) => {
    const { body, rod, gap } = rodBefore('thumb', 0.004, { scale, up: 0.04, owned });
    let took = false, first = Infinity;
    const step = runTimeline(function* () {
      yield* wait(0.5);
      took = yield* grab(body, rod, { left: 'grip' }, { step: false });
      first = gap();
      yield* wait(1);
    });
    for (let k = 0; k < 8 * hz; k++) {
      step(undefined, 1 / hz);
      body.update(1 / hz);
    }
    expect(took).toBe(true);
    expect(first).toBeLessThan(0.001);
    expect(gap()).toBeLessThan(0.001);
    expect(body.log).toEqual([]);
  });

  it.each([
    ['a pad on its empty', 'thumb', false],
    ['a palm with a digit laid on an empty as it takes hold', 'palm', false],
    ['a palm with a digit laid on an empty once it holds', 'palm', true],
  ] as const)('keeps %s through a carry that would have the hand regrip', (name, point, later) => {
    const { body, room, rod, grip, gap } = rodBefore(point, 0.013);
    empty(rod, 'index', new Vector3(0.013, 0, 0)).userData.facing = [-1, 0, 0];
    const digit = () => { if (name !== 'a pad on its empty') grip.userData.digits = { index: 'index' }; };
    if (!later) digit();
    room.updateMatrixWorld(true);
    const hand = body.bones.leftHand, turnIn = () => hand.getWorldQuaternion(new Quaternion()).invert().multiply(rod.getWorldQuaternion(new Quaternion()));
    const from = new Quaternion();
    let carrying = false, most = 0, turned = 0;
    play(function* () {
      yield* grab(body, rod, { left: 'grip' }, { step: false, speed: Infinity });
      yield* wait(1);
      if (later) digit();
      from.copy(turnIn());
      carrying = true;
      yield* carry(body, rod, above(), { step: false });
      yield* wait(1);
    }, [body], 7, () => {
      if (!carrying) return;
      most = Math.max(most, gap());
      turned = Math.max(turned, from.angleTo(turnIn()));
    });
    expect(carrying).toBe(true);
    expect(most).toBeLessThan(0.001);
    expect(turned).toBeLessThan(0.01);
  });

  it.each([
    ['ends, not hanging, on a button with a facing its wrist will not fully turn to', 60, 0, [0, 0, 1]],
    ['presses a button that moves', 60, 0.15, undefined],
    ['presses a button that moves, at a low rate', 12, 0.15, undefined],
  ] as const)('%s', (_name, hz, speed, facing) => {
    const body = new Body(humanoid(FINGERED), { dev: true, life: { seed: 3, steady: 1 } }), room = roomOf(body);
    const button = new Object3D();
    button.position.set(0.28, 1.02, 0.3);
    room.add(button);
    Object.assign(empty(button, 'cap', new Vector3()).userData, { point: 'index', ...(facing && { facing }) });
    room.updateMatrixWorld(true);
    let took: boolean | null = null;
    const step = runTimeline(function* () { took = yield* grab(body, button, { left: 'cap' }, { step: false }); });
    for (let k = 0; k < 8 * hz && took === null; k++) {
      step(undefined, 1 / hz);
      button.position.x -= speed / hz;
      room.updateMatrixWorld(true);
      body.update(1 / hz);
    }
    expect(took).toBe(true);
  });

  it('fails, saying so, a pad its wrist stays near but cannot bring on', () => {
    const { body, room, rod, grip } = rodBefore('thumb', 0.01);
    delete rod.userData.mass;
    rod.position.set(-0.25, 0.6, 0.1);
    grip.position.set(0, 0, 0);
    room.updateMatrixWorld(true);
    let took: boolean | null = null;
    play(function* () { took = yield* grab(body, rod, { left: 'grip' }, { step: false }); }, [body], 14, () => took !== null);
    expect(took).toBe(false);
    expect(body.log).toEqual(expect.arrayContaining([expect.objectContaining({ check: expect.stringContaining('a fingertip still off its grip') })]));
  });

  it.each([
    ['says so when its facing leaves it off', [0.28, 1.02, 0.3], [0, 0, -1], true],
    ['says nothing when its turn brings it on', [0.2, 1.1, 0.35], [0, -1, 0], false],
  ] as const)('a pad a facing fixes %s', (_, at, facing, off) => {
    const { body, room, rod, grip, gap } = rodBefore('thumb', 0.01);
    delete rod.userData.mass;
    rod.position.set(at[0], at[1], at[2]);
    grip.position.set(-0.01, 0, 0);
    grip.userData.facing = [...facing];
    room.updateMatrixWorld(true);
    let took = false;
    play(function* () { took = yield* grab(body, rod, { left: 'grip' }, { step: false }); yield* wait(1); }, [body], 14);
    expect(took).toBe(true);
    expect(gap() > 0.01).toBe(off);
    expect(body.log.some(({ check }) => check === 'a fingertip closed off its grip (m)')).toBe(off);
  });

  it('regrips a plain grip about the point it took, turning the thing with that point still on its grip until it is seated', () => {
    const { body, rod, gap } = rodBefore('palm', 0.013), target = above();
    const from = new Quaternion();
    let carrying = false, carried = false, most = 0, turned = 0, off = Infinity;
    play(function* () {
      yield* grab(body, rod, { left: 'grip' }, { step: false, speed: Infinity });
      yield* wait(1);
      from.copy(rod.quaternion);
      carrying = true;
      carried = yield* carry(body, rod, target, { step: false });
      off = rod.getWorldPosition(new Vector3()).distanceTo(target.position);
      carrying = false;
    }, [body], 8, () => {
      if (!carrying) return;
      turned = Math.max(turned, from.angleTo(rod.quaternion));
      // (within 3 cm the fingers may seat it, off the point on purpose)
      if (rod.getWorldPosition(new Vector3()).distanceTo(target.position) > 0.03) most = Math.max(most, gap());
    });
    expect(carried).toBe(true);
    expect(turned).toBeGreaterThan(0.1);
    expect(most).toBeLessThan(1e-5);
    expect(off).toBeLessThan(0.005);
    expect(body.log).toEqual([]);
  });
});
