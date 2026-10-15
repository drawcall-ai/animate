import { Quaternion, Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import { expect, it, vi } from 'vitest';
import { Body, Humanoid, Item, eyesOnBefore, INDEX, STEP, Pose, createSkeletonModel, idle, named, watch, type Frame } from '../../src';
import { checkFeet } from '../../src/humanoid/balance/legs';
import { ballOf, footRotation, heelOf } from '../../src/humanoid/balance/foot';
import { Dev } from '../../src/core/dev';
import { leg } from '../core/rigs';

it('checks a planted foot in the final pose after a later writer moved it', () => {
  const h = new Humanoid(createSkeletonModel(), (h) => function* () {
    yield* parallel<Frame>('all', idle(h), named('bad layer', function* () {
      yield* action<Frame>({ update: (f) => f.current.setRoot(f.current.position(0).clone().add(new Vector3(0.04, 0, 0))) });
    }));
  }, { dev: true });
  h.update(STEP);
  expect(h.log).toEqual([]);
  h.update(STEP);
  expect(h.log).toContainEqual(expect.objectContaining({ check: 'planted foot slide (m)', where: 'leftFoot', time: STEP, beat: 'bad layer', limit: 0.01 }));
});

it('attributes a watcher to the beat that made the previous final pose, even on handover', () => {
  const body = new Body(leg(), function* () {
    yield* parallel<Frame>('all', watch('scene', (f) => ({ check: 'too far', value: f.prev.position(0).x, limit: 1, where: 'root' })), function* () {
      yield* named('first', function* () {
        yield* action<Frame>({ update: (f) => f.current.setRoot(new Vector3(2, 0, 0)), until: timePassed(STEP, 'seconds') });
      })();
      yield* named('second', function* () {
        yield* action<Frame>({ update: (f) => f.current.setRoot(new Vector3(3, 0, 0)) });
      })();
    });
  }, { dev: true });
  body.update(3 * STEP);
  expect(body.log.filter((e) => e.check === 'scene: too far')).toEqual([
    { time: expect.closeTo(STEP, 10), check: 'scene: too far', value: 2, limit: 1, where: 'root', beat: 'first' },
    { time: expect.closeTo(2 * STEP, 10), check: 'scene: too far', value: 3, limit: 1, where: 'root', beat: 'second' },
  ]);
});

it.each([false, true])('checks and reads watchers only with dev on (%s)', (dev) => {
  const read = vi.fn(() => ({ check: 'bad', value: 1, limit: 0, where: 'root' }));
  const h = new Humanoid(createSkeletonModel(), () => function* () {
    yield* parallel<Frame>('all', watch('scene', read), function* () {
      yield* action<Frame>({ update: (f) => f.current.setLocal(INDEX.head, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), f.time > STEP ? 2 : 0)) });
    });
  }, { dev });
  h.update(3 * STEP);
  if (dev) {
    expect(read).toHaveBeenCalled();
    for (const check of ['joint range (°)', 'joint speed (°/s)', 'joint acceleration (°/s²)', 'scene: bad']) {
      expect(h.log).toContainEqual(expect.objectContaining({ check }));
    }
  } else {
    expect(h.log).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  }
});

it('catches a later joint writer and a snap from final rotations', () => {
  const h = new Humanoid(createSkeletonModel(), () => function* () {
    yield* named('snap', function* () {
      yield* action<Frame>({ update: (f) => f.current.setLocal(INDEX.head, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), f.time > STEP ? 2 : 0)) });
    })();
  }, { dev: true });
  h.update(3 * STEP);
  expect(h.log).toContainEqual(expect.objectContaining({ check: 'joint range (°)', where: 'head', beat: 'snap' }));
  expect(h.log).toContainEqual(expect.objectContaining({ check: 'joint acceleration (°/s²)', where: 'head', beat: 'snap' }));
});

it('a gaze watcher distinguishes a look that leads a grip from one that arrives with it', () => {
  const run = (wait: number) => {
    const item = new Item(new Vector3(0, 1.6, 1), new Quaternion(), { grip: { position: new Vector3() } });
    const h = new Humanoid(createSkeletonModel(), (h) => function* () {
      yield* parallel<Frame>('all', eyesOnBefore(h, item, 0.4), named('take', function* () {
        yield* action<Frame>({ update: (f) => { if (f.time >= wait) h.holding.right = { item, grip: 'grip' }; } });
      }));
    }, { dev: true });
    h.update(0.6);
    return h.log.filter((e) => e.check.startsWith('eyesOnBefore'));
  };
  expect(run(0.5)).toEqual([]);
  expect(run(STEP)).toContainEqual(expect.objectContaining({ check: 'eyesOnBefore: gaze lead shortfall (s)', value: 0.4, beat: 'take' }));
});

it('checks sustained joint speed even when acceleration is below its ceiling', () => {
  const h = new Humanoid(createSkeletonModel(), () => function* () {
    yield* action<Frame>({ update: (f) => f.current.setLocal(INDEX.head, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 15 * f.time)) });
  }, { dev: true });
  h.update(4 * STEP);
  const log = h.log.filter((entry) => entry.time > STEP);
  expect(log).toContainEqual(expect.objectContaining({ check: 'joint speed (°/s)', limit: 700 }));
  expect(log.some((entry) => entry.check === 'joint acceleration (°/s²)')).toBe(false);
});

it('checks standing CoM against the soles once the final pose is still', () => {
  const h = new Humanoid(createSkeletonModel(), (h) => function* () {
    const pose = new Pose(h.rig.skeleton).copy(h.pose);
    // Shift the segment's mass without moving the standing pose or its soles.
    h.rig.skeleton.bones[INDEX.hips].com.x = 3;
    yield* parallel<Frame>('all', idle(h), function* () {
      yield* action<Frame>({ update: (f) => {
        f.current.copy(pose);
        h.gait.settled = true;
        for (const foot of h.feet) foot.phase = 'planted';
      } });
    });
  }, { dev: true });
  h.update(3 * STEP);
  expect(h.log).toContainEqual(expect.objectContaining({ check: 'standing CoM outside the feet (m)', limit: 0.001 }));
});

it.each([['heel', -1e-9], ['ball', -1e-9], ['heel', 1e-9], ['ball', 1e-9]] as const)('rejects a flat foot swivelling about its %s (pitch %s)', (pivot, pitch) => {
  const h = new Humanoid(createSkeletonModel(), () => function* () {});
  const pose = new Pose(h.rig.skeleton).copy(h.pose);
  const contact = pivot === 'heel' ? heelOf(h.proportions) : ballOf(h.proportions, 'left');
  const anchor = pose.point(INDEX.leftFoot, contact, new Vector3());
  pose.setRotation(INDEX.leftFoot, footRotation(h.feet[0].yaw + 0.5, pitch));
  const delta = anchor.sub(pose.point(INDEX.leftFoot, contact, new Vector3()));
  pose.setRoot(pose.position(0).clone().add(delta));
  // The other foot is outside this pivot check.
  h.feet[1].phase = 'swing';
  const dev = new Dev();
  checkFeet(h, { dt: STEP, time: 2 * STEP, prev: pose, prev2: h.pose, current: pose, beats: new Set(), world: undefined }, dev);
  expect(dev.log).toContainEqual(expect.objectContaining({ check: 'planted foot slide (m)', where: 'leftFoot', limit: 0.01 }));
});
