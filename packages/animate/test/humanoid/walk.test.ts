import { Quaternion, Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import { expect, it } from 'vitest';
import { arriving, createSkeletonModel, grab, Humanoid, idle, Item, walkTo, when, type Frame } from '../../src';

it('publishes arrival and starts a waiting grab before the walk ends without replacing its goal', () => {
  const to = new Vector3(0, 0, 2);
  const item = new Item(new Vector3(0, 0.9, 2.35), new Quaternion(), { grip: { position: new Vector3() } });
  const estimates: number[] = [];
  let ended = false;
  let started = false;
  const goals: number[] = [];
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
        goals.push(h.asks.go?.to.distanceTo(to) ?? Infinity);
      } }));
    });
  });
  expect(h.gait.eta).toBe(Infinity);
  for (let t = 0; t < 10; t += 1 / 60) h.update(1 / 60);
  expect(estimates[0]).toBeGreaterThan(1);
  expect(estimates.at(-1)).toBeLessThan(0.1);
  expect(started && ended && finished).toBe(true);
  expect(goals.length).toBeGreaterThan(0);
  expect(Math.max(...goals)).toBeLessThan(1e-6);
  expect(h.gait.eta).toBe(Infinity);
  expect(h.holding.right?.item).toBe(item);
});

it('clears the estimate when a walk is cancelled', () => {
  let cancelled = false;
  const h = new Humanoid(createSkeletonModel(), (h) => function* () {
    yield* parallel<Frame>('all', idle(h), function* () {
      yield* parallel<Frame>('race', walkTo(h, { to: new Vector3(0, 0, 10) }), when(timePassed(0.5, 'seconds')));
      cancelled = true;
    });
  });
  h.update(0.25);
  expect(Number.isFinite(h.gait.eta)).toBe(true);
  h.update(0.5);
  expect(cancelled).toBe(true);
  expect(h.gait.eta).toBe(Infinity);
  expect(arriving(h, 1)()).toBe(false);
});

it('grabs an item in reach without a walk running', () => {
  const item = new Item(new Vector3(-0.15, 0.9, 0.25), new Quaternion(), { grip: { position: new Vector3() } });
  let finished = false;
  const h = new Humanoid(createSkeletonModel(), (h) => function* () {
    yield* parallel<Frame>('all', idle(h), function* () {
      yield* grab(h, { right: [item, 'grip'] }, { face: 0, look: false })();
      finished = true;
    });
  });
  for (let t = 0; t < 3; t += 1 / 60) h.update(1 / 60);
  expect(finished).toBe(true);
  expect(h.holding.right?.item).toBe(item);
  expect(h.gait.eta).toBe(Infinity);
});

it.each([false, true])('waits for the next walk to publish with the waiting branch first: %s', (waitingFirst) => {
  let started = false;
  let estimate = Infinity;
  const h = new Humanoid(createSkeletonModel(), (h) => function* () {
    yield* parallel<Frame>('all', idle(h), function* () {
      yield* walkTo(h, { to: new Vector3() })();
      const wait = function* () {
        yield* when(arriving(h, 1));
        started = true;
        estimate = h.gait.eta;
      };
      const walk = walkTo(h, { to: new Vector3(0, 0, 2) });
      yield* parallel<Frame>('all', ...(waitingFirst ? [wait, walk] : [walk, wait]));
    });
  });
  h.update(0.25);
  expect(started).toBe(false);
  for (let t = 0; t < 5; t += 1 / 60) h.update(1 / 60);
  expect(started).toBe(true);
  expect(estimate).toBeLessThanOrEqual(1);
  expect(h.gait.eta).toBe(Infinity);
});

it('honors facing and standing after joining a walk', () => {
  const item = new Item(new Vector3(0, 0.9, 2.35), new Quaternion(), { grip: { position: new Vector3() } });
  const face = 0.6;
  const stand = { ahead: 0.6, aside: -0.2 };
  let finished = false;
  const h = new Humanoid(createSkeletonModel(), (h) => function* () {
    yield* parallel<Frame>('all', idle(h), walkTo(h, { to: new Vector3(0, 0, 2) }), function* () {
      yield* when(arriving(h, 0.6));
      yield* grab(h, { right: [item, 'grip'] }, { face, stand, look: false })();
      finished = true;
    });
  });
  for (let t = 0; t < 10; t += 1 / 60) h.update(1 / 60);
  const body = h.pose.com(new Vector3());
  const ahead = stand.ahead * h.proportions.armLength;
  expect(finished).toBe(true);
  expect(h.holding.right?.item).toBe(item);
  expect(Math.abs(h.gait.facing - face)).toBeLessThan(0.3);
  expect(Math.hypot(body.x - (-Math.cos(face) * stand.aside - Math.sin(face) * ahead), body.z - (2.35 + Math.sin(face) * stand.aside - Math.cos(face) * ahead))).toBeLessThan(0.12);
});
