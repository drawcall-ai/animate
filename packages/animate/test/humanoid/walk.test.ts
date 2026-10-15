import { standing } from './fixtures';
import { Quaternion, Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import { expect, it } from 'vitest';
import { approach, arriving, carried, hold, handTo, INDEX, reachFor, grab, Item, walkTo, when, type Frame } from '../../src';

it('publishes arrival and starts a waiting grab before the walk ends without replacing its goal', () => {
  const to = new Vector3(0, 0, 2);
  const item = new Item(new Vector3(0, 0.9, 2.35), new Quaternion(), { grip: { position: new Vector3() } });
  const estimates: number[] = [];
  let ended = false;
  let started = false;
  const goals: number[] = [];
  let finished = false;
  const h = standing((h) => [function* () {
      yield* parallel<Frame>('all', function* () {
        yield* walkTo(h, { to })();
        ended = true;
      }, function* () {
        yield* when(arriving(h, 0.6));
        started = !ended && h.gait.eta > 0;
        yield* grab(h, { right: [item, 'grip'] }, { look: false})();
        finished = true;
      }, action<Frame>({ until: () => ended, update: () => {
        estimates.push(h.gait.eta);
        if (!started) return;
        goals.push(h.asks.go?.to.distanceTo(to) ?? Infinity);
      } }));
    }]);
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
  let near = true;
  const h = standing((h) => [function* () {
      yield* parallel<Frame>('race', walkTo(h, { to: new Vector3(0, 0, 10) }), when(timePassed(0.5, 'seconds')));
      cancelled = true;
      const arrival = arriving(h, 1);
      yield* action<Frame>({ update: (f) => { near = arrival(f); } });
    }]);
  h.update(0.25);
  expect(Number.isFinite(h.gait.eta)).toBe(true);
  h.update(0.5);
  expect(cancelled).toBe(true);
  expect(h.gait.eta).toBe(Infinity);
  expect(near).toBe(false);
});

it('grabs an item in reach without a walk running', () => {
  const item = new Item(new Vector3(-0.15, 0.9, 0.25), new Quaternion(), { grip: { position: new Vector3() } });
  let finished = false;
  const h = standing((h) => [function* () {
      yield* grab(h, { right: [item, 'grip'] }, { face: 0, look: false})();
      finished = true;
    }]);
  for (let t = 0; t < 3; t += 1 / 60) h.update(1 / 60);
  expect(finished).toBe(true);
  expect(h.holding.right?.item).toBe(item);
  expect(h.gait.eta).toBe(Infinity);
});

it.each([false, true])('waits for the next walk to publish with the waiting branch first: %s', (waitingFirst) => {
  let started = false;
  let estimate = Infinity;
  const h = standing((h) => [function* () {
      yield* walkTo(h, { to: new Vector3() })();
      const wait = function* () {
        yield* when(arriving(h, 1));
        started = true;
        estimate = h.gait.eta;
      };
      const walk = walkTo(h, { to: new Vector3(0, 0, 2) });
      yield* parallel<Frame>('all', ...(waitingFirst ? [wait, walk] : [walk, wait]));
    }]);
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
  const h = standing((h) => [walkTo(h, { to: new Vector3(0, 0, 2) }), function* () {
      yield* when(arriving(h, 0.6));
      yield* grab(h, { right: [item, 'grip'] }, { face, stand, look: false})();
      finished = true;
    }]);
  for (let t = 0; t < 10; t += 1 / 60) h.update(1 / 60);
  const body = h.pose.com(new Vector3());
  const ahead = stand.ahead;
  expect(finished).toBe(true);
  expect(h.holding.right?.item).toBe(item);
  expect(Math.abs(h.gait.facing - face)).toBeLessThan(0.3);
  const expected = new Vector3(-Math.cos(face) * stand.aside - Math.sin(face) * ahead, 0, 2.35 + Math.sin(face) * stand.aside - Math.cos(face) * ahead);
  expect(Math.hypot(body.x - expected.x, body.z - expected.z)).toBeLessThan(0.12);
});

it('ends an arrival hold when approach finds the body already in reach', () => {
  const item = new Item(new Vector3(-0.15, 1.1, 0.3), new Quaternion(), { grip: { position: new Vector3() } });
  let finished = false;
  const h = standing((h) => [function* () {
      yield* reachFor(h, { right: [item, 'grip'] })();
      yield* parallel<Frame>('all', approach(h, item.current.position, { face: 0 }),
        hold(h, item, { to: carried(h, 'right'), until: arriving(h, 0.3) }));
      finished = true;
    }]);
  for (let tick = 0; tick < 300; tick++) h.update(1 / 60);
  expect(finished).toBe(true);
  expect(h.gait.eta).toBe(Infinity);
});


it.each([
  { height: 1.4, walking: true, deficit: 0.02 },
  { height: 1.8, walking: true, deficit: 0.02 },
  { height: 2.1, walking: true, deficit: 0.02 },
  { height: 1.8, walking: false, deficit: 0.02 },
  { height: 1.8, walking: true, deficit: 0.18 },
])('brings the body only beyond walking allowance ($height m, walking $walking, deficit $deficit m)', ({ height, walking, deficit }) => {
  const bow: number[] = [], lower: number[] = [];
  const h = standing((h) => [walkTo(h, { to: new Vector3(0, 0, walking ? 10 : 0), speed: 0.95 }), handTo(h, 'right', (f) => {
        const p = h.proportions;
        const shoulder = f.current.position(INDEX.rightUpperArm);
        return { position: new Vector3(shoulder.x, p.hipHeight + p.offsets.spine.y + p.offsets.chest.y + p.offsets.rightShoulder.y + p.offsets.rightUpperArm.y - p.armLength - deficit * h.scale, shoulder.z) };
      })], height);
  for (let tick = 0; tick < 240; tick++) {
    h.update(1 / 60);
    if (tick < 120) continue;
    bow.push(h.asks.bow);
    lower.push(h.asks.lower);
  }
  expect(h.gait.moving).toBe(walking);
  expect(bow).toHaveLength(120);
  if (walking && deficit < 0.06) {
    expect(Math.max(...bow)).toBe(0);
    expect(Math.max(...lower)).toBe(0);
  } else {
    expect(Math.max(...bow)).toBeGreaterThan(0);
    if (deficit > 0.06) expect(Math.max(...lower)).toBeGreaterThan(0);
  }
});
