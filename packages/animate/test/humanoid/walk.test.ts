import { Quaternion, Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import { expect, it } from 'vitest';
import { arriving, createSkeletonModel, grab, Humanoid, idle, Item, walkTo, when, type Frame } from '../../src';

it('publishes arrival and starts a waiting grab before the walk ends without replacing its goal', () => {
  const to = new Vector3(0, 0, 2);
  const item = new Item(new Vector3(0, 0.9, 2.35), new Quaternion(), { grip: { position: new Vector3() } });
  const estimates: number[] = [];
  let ended = false;
  let started = false;
  let joined = false;
  let finished = false;
  const h = new Humanoid(createSkeletonModel(), (h) => function* () {
    yield* parallel<Frame>('all', idle(h), function* () {
      yield* parallel<Frame>('all', function* () {
        yield* walkTo(h, { to })();
        ended = true;
      }, function* () {
        yield* when(arriving(h, 0.6));
        started = !ended && h.gait.eta > 0;
        yield* grab(h, { right: [item, 'grip'] }, { look: false })();
        finished = true;
      }, action<Frame>({ until: () => ended, update: () => {
        estimates.push(h.gait.eta);
        if (!started) return;
        joined = true;
        expect(h.asks.go?.to.distanceTo(to)).toBeLessThan(1e-6);
      } }));
    });
  });
  expect(h.gait.eta).toBe(Infinity);
  for (let t = 0; t < 10; t += 1 / 60) h.update(1 / 60);
  expect(estimates[0]).toBeGreaterThan(1);
  expect(estimates.at(-1)).toBeLessThan(0.1);
  expect(started && joined && ended && finished).toBe(true);
  expect(h.gait.eta).toBe(0);
  expect(h.holding.right?.item).toBe(item);
});
