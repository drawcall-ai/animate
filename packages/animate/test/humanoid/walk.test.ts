import { Body } from '../../src/core/body';
import { person } from '../person';
import { idle } from '../../src/humanoid/idle';
import { World } from '../../src/core/world';
import { SEGMENT_RADIUS } from '../../src/humanoid/hands/grab';
import type { Holds } from '../../src/core/hands';
import { leg } from '../core/rigs';
import { Pose } from '../../src/core/pose';
import { route } from '../../src/core/walk';
import { standing } from './fixtures';
import { Quaternion, Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import { expect, it } from 'vitest';
import { arriving, carried, hold, handTo, type Humanoid, createSkeletonModel, INDEX, grab, Item, walkTo, when, type Frame } from '../../src';
import { approach } from '../../src/rig';
import { STEP } from '../../src/core/body';

it('publishes arrival and starts a waiting grab before the walk ends without replacing its goal', () => {
  const to = new Vector3(0, 0, 2);
  const face = 0.6, spot = { ahead: 0.6, aside: -0.2 };
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
        started = !ended && h.locomotion.eta > 0;
        yield* grab(h, { right: [item, 'grip'] }, { face, spot, look: false })();
        finished = true;
      }, action<Frame>({ until: () => ended, update: () => {
        estimates.push(h.locomotion.eta);
        if (!started || ended) return;
        goals.push(h.asks.go?.to.distanceTo(to) ?? Infinity);
      } }));
    }]);
  expect(h.locomotion.eta).toBe(Infinity);
  for (let t = 0; t < 10; t += 1 / 60) h.update(1 / 60);
  expect(estimates[0]).toBeGreaterThan(1);
  expect(estimates.at(-1)).toBeLessThan(0.1);
  expect(started && ended && finished).toBe(true);
  expect(goals.length).toBeGreaterThan(0);
  expect(Math.max(...goals)).toBeLessThan(1e-6);
  expect(h.locomotion.eta).toBe(Infinity);
  expect(h.holding.right?.item).toBe(item);
  expect(Math.abs(h.locomotion.facing - face)).toBeLessThan(0.3);
  const body = h.pose.com(new Vector3());
  const expected = new Vector3(-Math.cos(face) * spot.aside - Math.sin(face) * spot.ahead, 0, 2.35 + Math.sin(face) * spot.aside - Math.cos(face) * spot.ahead);
  expect(Math.hypot(body.x - expected.x, body.z - expected.z)).toBeLessThan(0.12);
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
  expect(Number.isFinite(h.locomotion.eta)).toBe(true);
  h.update(0.5);
  expect(cancelled).toBe(true);
  expect(h.locomotion.eta).toBe(Infinity);
  expect(near).toBe(false);
});

it.each([false, true])('waits for the next walk to publish with the waiting branch first: %s', (waitingFirst) => {
  let started = false;
  let estimate = Infinity;
  const h = standing((h) => [function* () {
      yield* walkTo(h, { to: new Vector3() })();
      const wait = function* () {
        yield* when(arriving(h, 1));
        started = true;
        estimate = h.locomotion.eta;
      };
      const walk = walkTo(h, { to: new Vector3(0, 0, 2) });
      yield* parallel<Frame>('all', ...(waitingFirst ? [wait, walk] : [walk, wait]));
    }]);
  h.update(0.25);
  expect(started).toBe(false);
  for (let t = 0; t < 5; t += 1 / 60) h.update(1 / 60);
  expect(started).toBe(true);
  expect(estimate).toBeLessThanOrEqual(1);
  expect(h.locomotion.eta).toBe(Infinity);
});

it('grabs without a walk, then ends an arrival hold when already in reach', () => {
  const item = new Item(new Vector3(-0.15, 1.1, 0.3), new Quaternion(), { grip: { position: new Vector3() } });
  let finished = false;
  const h = standing((h) => [function* () {
      const middle = h.pose.position(INDEX.leftUpperArm).clone().add(h.pose.position(INDEX.rightUpperArm)).multiplyScalar(0.5);
      yield* approach(h, middle.add(new Vector3(0, 0, 0.25)), { face: 0 })();
      expect(h.asks.go).toBeNull();
      yield* grab(h, { right: [item, 'grip'] }, { face: 0, look: false })();
      expect(h.holding.right?.item).toBe(item);
      expect(h.locomotion.eta).toBe(Infinity);
      yield* parallel<Frame>('all', approach(h, item.current.position, { face: 0 }),
        hold(h, item, { to: carried(h, 'right'), until: arriving(h, 0.3) }));
      finished = true;
    }]);
  for (let tick = 0; tick < 300; tick++) h.update(1 / 60);
  expect(finished).toBe(true);
  expect(h.locomotion.eta).toBe(Infinity);
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
  expect(h.locomotion.moving).toBe(walking);
  if (walking && deficit < 0.06) {
    expect(Math.max(...bow)).toBe(0);
    expect(Math.max(...lower)).toBe(0);
  } else {
    expect(Math.max(...bow)).toBeGreaterThan(0);
    if (deficit > 0.06) expect(Math.max(...lower)).toBeGreaterThan(0);
  }
});

it('logs an unreachable stand once and stands instead of asking for a walk', () => {
  for (const [point, ahead] of [[new Vector3(0, 1.4, 2), 2], [new Vector3(0, 10, 2), 0]] as const) {
    const far = person(createSkeletonModel(), (h) => approach(h, point, { spot: { ahead } }), { idle: false, dev: true });
    for (let tick = 0; tick < 30; tick++) far.update(STEP);
    expect(far.log.map((entry) => entry.check)).toEqual(["approach: placing point from the shoulders' middle, lowered and bowed (m)"]);
    expect(far.asks.go).toBeNull();
  }
});

it('logs a vertically unreachable placing point with the default stand once and stands', () => {
  const h = person(createSkeletonModel(), (h) => approach(h, new Vector3(0, 10, 2)), { idle: false, dev: true });
  for (let tick = 0; tick < 30; tick++) h.update(STEP);
  expect(h.log.map((entry) => entry.check)).toEqual(["approach: placing point from the shoulders' middle, lowered and bowed (m)"]);
  expect(h.asks.go).toBeNull();
});

it.each([new Vector3(1, 1.25, 2), new Vector3(-1, 1.4, 2)])('approaches a placing point squarely by default: %s', (point) => {
  let done = false;
  const h = standing((h) => [function* () {
      yield* approach(h, point)();
      done = true;
    }]);
  for (let tick = 0; tick < 12 * 60; tick++) h.update(STEP);
  const middle = h.pose.position(INDEX.leftUpperArm).clone().add(h.pose.position(INDEX.rightUpperArm)).multiplyScalar(0.5);
  const delta = point.clone().sub(middle);
  expect(done).toBe(true);
  expect(delta.length()).toBeLessThan(0.95 * h.proportions.armLength);
  expect(Math.abs(Math.atan2(delta.x, delta.z) - h.locomotion.facing)).toBeLessThan(0.3);
});

it('includes intermediate legs in arrival anticipation', () => {
  let near = NaN;
  let done = false;
  const h = standing((h) => [function* () {
    yield* parallel<Frame>('all', route(h, { to: new Vector3(0, 0, 3) }, [new Vector3(0, 0, 1)]), function* () {
      yield* when(arriving(h, 0.6));
      near = h.pose.position(0).z;
    });
    done = true;
  }]);
  for (let i = 0; i < 600; i++) h.update(STEP);
  expect(done).toBe(true);
  expect(near).toBeGreaterThan(2.5);
});

it('returns to its starting point after an internal route without a final target', () => {
  let done = false;
  const h = standing((h) => [function* () {
    yield* route(h, {}, [new Vector3(0, 0, 1)])();
    done = true;
  }]);
  for (let i = 0; i < 900 && !done; i++) h.update(STEP);
  expect(done).toBe(true);
  expect(Math.abs(h.pose.position(0).z)).toBeLessThan(0.15);
});

it.each(['one grip', 'two grips', 'placement'])('chooses a clear stand including aside and rejects a blocked explicit face: %s', (kind) => {
  const other = new Pose(leg());
  other.setRoot(new Vector3(-0.35, 1, 1.6));
  const world = new World().add(new Body({ skeleton: other.skeleton }, () => (function* () {}), { idle: false, pose: other }));
  const item = new Item(new Vector3(0, 1.2, 2), new Quaternion(), {
    left: { position: new Vector3(0.15, 0, 0) },
    right: { position: new Vector3(-0.15, 0, 0) },
    middle: { position: new Vector3() },
  });
  let done = false;
  const h = person(createSkeletonModel(), (h) => function* () {
    yield* parallel<Frame>('all', idle(h), function* () {
      const grips: Vector3 | Holds = kind === 'placement' ? item.current.position : kind === 'one grip'
        ? { right: [item, 'middle'] as const }
        : { left: [item, 'left'] as const, right: [item, 'right'] as const };
      yield* approach(h, grips, { spot: { ahead: 0.4, aside: 0.25 } })();
      done = true;
    });
  }, { idle: false });
  world.add(h);
  for (let t = 0; t < 8; t += STEP) h.update(STEP);
  expect(done).toBe(true);
  expect(Math.abs(h.locomotion.facing)).toBeGreaterThan(0.3);
  for (const foot of h.feet) expect(Math.hypot(foot.position.x + 0.25, foot.position.z - 1.6)).toBeGreaterThan(h.proportions.toeFront + SEGMENT_RADIUS);
  // (asked to face the blocked way, it logs that, once, and stands)
  const facing = person(createSkeletonModel(), (h) => function* () {
    const grips: Vector3 | Holds = kind === 'placement' ? item.current.position : kind === 'one grip'
      ? { right: [item, 'middle'] as const }
      : { left: [item, 'left'] as const, right: [item, 'right'] as const };
    yield* approach(h, grips, { face: 0, spot: { ahead: 0.4, aside: 0.25 } })();
  }, { idle: false, dev: true });
  world.add(facing);
  for (let tick = 0; tick < 30; tick++) facing.update(STEP);
  expect(facing.log.map((entry) => entry.check)).toEqual(['approach: explicit face has a blocked stand']);
  expect(facing.asks.go).toBeNull();
});
