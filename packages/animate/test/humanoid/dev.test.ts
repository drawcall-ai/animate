import { Quaternion, Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import { expect, it, vi } from 'vitest';
import { Body, Humanoid, Item, eyesOnBefore, INDEX, STEP, createSkeletonModel, idle, named, watch, type Frame } from '../../src';
import * as limits from '../../src/core/limits';
import * as rotation from '../../src/core/rotation';
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
    { time: expect.closeTo(STEP, 10), check: 'scene: too far', value: 2, limit: 1, where: 'root', beat: 'first', severity: 'error' },
    { time: expect.closeTo(2 * STEP, 10), check: 'scene: too far', value: 3, limit: 1, where: 'root', beat: 'second', severity: 'error' },
  ]);
});

it('does no checking or watcher reads with dev off', () => {
  const read = vi.fn(() => ({ check: 'bad', value: 1, limit: 0, where: 'root' }));
  const body = new Body(leg(), watch('scene', read));
  const range = vi.spyOn(limits, 'checkLimits');
  const snaps = vi.spyOn(rotation, 'checkSnaps');
  body.update(3 * STEP);
  expect(body.frame.dev).toBeUndefined();
  expect(body.log).toEqual([]);
  expect(read).not.toHaveBeenCalled();
  expect(range).not.toHaveBeenCalled();
  expect(snaps).not.toHaveBeenCalled();
  vi.restoreAllMocks();
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
