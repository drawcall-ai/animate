import { createWorld, type World } from '../../src/humanoid/world';
import { RAISE_LEAD } from '../../src/humanoid/hands/place';
import { standing } from './fixtures';
import { Quaternion, Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import { expect, it } from 'vitest';
import { Body, Carrier, Humanoid, createSkeletonModel, INDEX, Item, place, carryTogether, carried, carry, hold, named, walkTo, onBone, reachFor, release, takeOff, wear, when, withGaze, type Frame } from '../../src';
import { STEP } from '../../src/core/body';
import { leg } from '../core/rigs';

it('keeps an unsupported grip through the next task’s gaze opening, then releases to rest', () => {
  const item = new Item(new Vector3(-0.15, 1.1, 0.35), new Quaternion(), { handle: { position: new Vector3() } });
  let gap = false;
  let samples = 0;
  let off = 0;
  let released = false;
  const h = standing((h) => [function* () {
      yield* reachFor(h, { right: [item, 'handle'] })();
      yield* hold(h, item, { to: carried(h, 'right'), until: timePassed(1, 'seconds') })();
      gap = true;
      yield* withGaze(h, new Vector3(2, 1.5, 0), function* () {
        gap = false;
        yield* release(h, ['right'])();
        released = true;
      }, { first: true })();
    }, action<Frame<World>>({ update: (f) => {
      if (!gap) return;
      samples++;
      off = Math.max(off, f.current.position(INDEX.rightHand).distanceTo(item.current.position));
    } })]);
  for (let i = 0; i < 420; i++) h.update(STEP);
  expect(samples).toBeGreaterThan(5);
  expect(off).toBeLessThan(0.03);
  expect(released).toBe(true);
  expect(h.holding.right).toBeNull();
  expect(h.pose.position(INDEX.rightHand).y).toBeLessThan(h.pose.position(INDEX.hips).y);
});

it.each([1.6, 1.85])('carries world and item distances in metres on a %s m body', (height) => {
  const item = new Item(new Vector3(-0.15, 1.05, 0.3), new Quaternion(), { handle: { position: new Vector3() } });
  const frame = new Carrier(new Vector3(0, 1, 0));
  const goal = new Vector3(-0.15, 1.1, 0.35);
  let world = new Vector3();
  let done = false;
  const h = standing((h) => [function* () {
      yield* reachFor(h, { right: [item, 'handle'] })();
      yield* carry(h, item, [[0.5, { position: goal }]])();
      world = item.current.position.clone();
      yield* carry(h, item, [[0.5, { position: new Vector3(-0.15, 0.15, 0.3) }]], { on: () => frame.current })();
      done = true;
    }], height);
  for (let i = 0; i < 360; i++) h.update(STEP);
  expect(done).toBe(true);
  expect(world.distanceTo(goal)).toBeLessThan(0.011);
  expect(item.current.position.distanceTo(new Vector3(-0.15, 1.15, 0.3))).toBeLessThan(0.011);
});

it('wears on a generic body, follows its bone from another frame, and takes off without another mover', () => {
  const item = new Item(new Vector3(0.2, 1, 0), new Quaternion(), { grip: { position: new Vector3() } });
  const local = { position: new Vector3(0.1, 0.2, 0) };
  const body: Body<World> = new Body(leg(), function* () {
    yield* wear(body, item, 0, { to: local })();
    yield* action<Frame<World>>({ update: (f) => f.current.setRoot(new Vector3(f.time, 1, 0)) });
  }, { scale: 2 });
  const other = new Body(leg(), () => when(() => false));
  const goal = onBone(body, 0, local);
  for (let i = 0; i < 180; i++) body.update(STEP);
  expect(item.current.position.distanceTo(body.pose.position(0).clone().add(new Vector3(0.2, 0.4, 0)))).toBeLessThan(0.001);
  expect(goal(other.frame).position.distanceTo(item.current.position)).toBeLessThan(0.001);
  body.frame.current.setRoot(new Vector3(10, 1, 0));
  expect(goal(other.frame).position.distanceTo(item.current.position)).toBeLessThan(0.001);
  other.update(STEP);
  body.update(STEP);
  expect(goal(other.frame).velocity.x).toBeCloseTo(1);
  const off = new Body(leg(), takeOff(body, item));
  off.update(STEP);
  const at = item.current.position.clone();
  body.update(STEP);
  expect(item.current.position.equals(at)).toBe(true);
  expect(body.worn.size).toBe(0);
});

it('reports time, beat, cause, item, grip and distance with dev off', () => {
  const item = new Item(new Vector3(0, 1, 4), new Quaternion(), { handle: { position: new Vector3() } }, { name: 'saddle' });
  const h = standing((h) => [named('fetch saddle', reachFor(h, { right: [item, 'handle'] }, { limit: 0.1 }))]);
  let caught: unknown;
  try { h.update(1); } catch (cause) { caught = cause; }
  expect(caught).toBeInstanceOf(Error);
  if (!(caught instanceof Error)) throw new Error('expected a contextual reach error');
  expect(caught.message).toMatch(/\d+\.\d+ s, "fetch saddle": "saddle" right grip "handle": [\d.]+ m off/);
  expect(caught.cause).toBeInstanceOf(Error);
  expect(h.log).toEqual([]);
  const cause = new Error('attachment failed');
  const instant = new Body(leg(), named('attach saddle', function* () { throw cause; }));
  expect(() => instant.update(STEP)).toThrow('0.017 s, "attach saddle": attachment failed');
});

it('an unsupported hold travels with the body between carries, and an explicit mover takes it over', () => {
  const item = new Item(new Vector3(-0.15, 1.1, 0.3), new Quaternion(), { grip: { position: new Vector3() } });
  let start = new Vector3();
  let end = new Vector3();
  let done = false;
  let off = 0;
  let travelling = false;
  const goal = new Vector3(-0.2, 1.15, 2.3);
  const h = standing((h) => [function* () {
      yield* reachFor(h, { right: [item, 'grip'] })();
      yield* carry(h, item, [[0.5, carried(h, 'right')]])();
      start = item.current.position.clone();
      travelling = true;
      yield* withGaze(h, new Vector3(1, 1.5, 3), walkTo(h, { to: new Vector3(0, 0, 2) }), { first: true })();
      travelling = false;
      end = item.current.position.clone();
      yield* carry(h, item, [[0.5, { position: goal }]])();
      done = true;
    }]);
  for (let tick = 0; tick < 12 * 60; tick++) {
    h.update(STEP);
    if (travelling) off = Math.max(off, h.pose.position(INDEX.rightHand).distanceTo(item.current.position));
  }
  expect(done).toBe(true);
  expect(end.z - start.z).toBeGreaterThan(1.5);
  expect(off).toBeLessThan(0.03);
  expect(item.current.position.distanceTo(goal)).toBeLessThan(0.03);
});

it('follows a grip worn by another body without asking the humanoid to lower for it', () => {
  const item = new Item(new Vector3(0.15, 0.9, 0.3), new Quaternion(), { grip: { position: new Vector3() } }, { mass: 8 });
  const wearer: Body = new Body(leg(), wearFromStart);
  function* wearFromStart() { yield* wear(wearer, item, 0)(); }
  wearer.update(STEP);
  let done = false;
  let lower = 0;
  const h = standing((h) => [function* () {
      yield* reachFor(h, { left: [item, 'grip'] })();
      done = true;
    }, action<Frame<World>>({ update: () => { lower = Math.max(lower, h.asks.lower); } })]);
  for (let i = 0; i < 180; i++) h.update(STEP);
  expect(done).toBe(true);
  expect(lower).toBe(0);
  expect(item.wornBy).toBe(wearer);
  expect(h.borne.has(item)).toBe(false);
});

it('keeps both carry grips until the slower course ends', () => {
  const a = new Item(new Vector3(0.2, 1.1, 0.3), new Quaternion(), { grip: { position: new Vector3() } });
  const b = new Item(new Vector3(-0.2, 1.1, 0.3), new Quaternion(), { grip: { position: new Vector3() } });
  let done = false;
  let samples = 0;
  let off = 0;
  const h = new Humanoid<World>(createSkeletonModel(), (h) => function* () {
    yield* parallel<Frame<World>>('all', action<Frame<World>>({ update: (f) => {
      const at = f.current.position(INDEX.hips).clone();
      at.x = 0.04 * Math.sin(3 * f.time);
      f.current.setRoot(at);
    } }), function* () {
      yield* reachFor(h, { left: [a, 'grip'], right: [b, 'grip'] })();
      yield* carryTogether(h, [[a, [[0.3, { position: new Vector3(0.2, 1.15, 0.3) }]]], [b, [[1.5, { position: new Vector3(-0.2, 1.15, 0.3) }]]]])();
      done = true;
    }, action<Frame<World>>({ update: (f) => {
      if (done || f.time < 1.5) return;
      samples++;
      off = Math.max(off, f.current.position(INDEX.leftHand).distanceTo(a.current.position));
    } }));
  }, { world: createWorld() });
  for (let i = 0; i < 300; i++) h.update(STEP);
  expect(done).toBe(true);
  expect(samples).toBeGreaterThan(10);
  expect(off).toBeLessThan(0.03);
});


it('takes up a heavy lift slowly, dips at arrival and recovers before finishing', () => {
  const lift = (mass: number) => {
    const item = new Item(new Vector3(-0.15, 1, 0.3), new Quaternion(), { handle: { position: new Vector3() } }, { mass });
    let start = NaN, end = NaN, time = 0;
    const heights: number[] = [];
    const h = standing((h) => [function* () {
      yield* reachFor(h, { right: [item, 'handle'] })();
      start = time;
      yield* carry(h, item, [[0.8, { position: new Vector3(-0.15, 1.25, 0.3) }]])();
      end = time - start;
    }]);
    for (let i = 0; i < 360; i++) {
      time = i * STEP;
      h.update(STEP);
      if (!Number.isNaN(start)) heights.push(item.current.position.y);
    }
    return { heights, end };
  };
  const light = lift(0), heavy = lift(8);
  expect(heavy.heights[24]).toBeLessThan(light.heights[24] - 0.02);
  // The nominal 8 kg path ends near 1.23 s; its arrival dip must be visible afterwards.
  const arrival = heavy.heights.slice(70, 90);
  const settle = heavy.heights.slice(90, 115);
  expect(Math.max(...arrival) - Math.min(...settle)).toBeGreaterThan(0.015);
  expect(heavy.end).toBeGreaterThan(light.end + 0.5);
  expect(Number.isFinite(heavy.end)).toBe(true);
  expect(heavy.heights.at(-1)).toBeCloseTo(1.25, 2);
});

it('follows destination translation and rotation during the lift and approach', () => {
  const item = new Item(new Vector3(0, 1.1, 0.3), new Quaternion(), {
    left: { position: new Vector3(0.18, 0, 0) },
    right: { position: new Vector3(-0.18, 0, 0) },
  });
  let done = false;
  let error = Infinity;
  let walking = 0;
  let advanced = 0;
  let stand: number | null = null;
  const turn = (f: Frame<World>) => 0.2 * Math.min(f.time, 4);
  const destination = (f: Frame<World>) => ({ position: new Vector3(0, 1.2, 2 + 0.35 * Math.min(f.time, 4)),
    quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), turn(f)) });
  const h = standing((h) => [function* () {
    yield* reachFor(h, { left: [item, 'left'], right: [item, 'right'] })();
    yield* place(h, item, destination)();
    done = true;
  }, action<Frame<World>>({ update: (f) => {
    if (h.gait.moving) {
      walking++;
      advanced = Math.max(advanced, destination(f).position.z - 2);
      const go = h.asks.go;
      if (!go) throw new Error('moving without a walk goal');
      const distance = destination(f).position.clone().sub(go.to).setY(0).length();
      stand ??= distance;
      expect(distance).toBeCloseTo(stand, 5);
      expect(h.asks.face?.yaw).toBeCloseTo(turn(f), 5);
      expect(go.to.z).toBeCloseTo(destination(f).position.z - stand * Math.cos(turn(f)), 5);
    }
    if (done) error = item.current.position.distanceTo(destination(f).position);
  } })]);
  for (let i = 0; i < 900 && !done; i++) h.update(STEP);
  expect(done).toBe(true);
  expect(walking).toBeGreaterThan(0);
  expect(advanced).toBeGreaterThan(0.12);
  expect(error).toBeLessThan(0.01);
});

it('lifts a heavy item before raising toward an out-of-reach placement', () => {
  const item = new Item(new Vector3(0, 0.8, 0.35), new Quaternion(), {
    left: { position: new Vector3(0.18, 0, 0) }, right: { position: new Vector3(-0.18, 0, 0) },
  }, { mass: 8 });
  const destination = { position: new Vector3(0, 1.5, 3) };
  let done = false;
  let walking = 0;
  let raisingOnStep = 0;
  const h = standing((h) => [function* () {
    yield* reachFor(h, { left: [item, 'left'], right: [item, 'right'] })();
    yield* place(h, item, destination)();
    done = true;
  }]);
  for (let i = 0; i < 1200 && !done; i++) {
    h.update(STEP);
    if (h.gait.velocity.length() > 0.15 && h.gait.eta <= RAISE_LEAD && item.current.position.y > carried(h)(h.frame).position.y + 0.01) raisingOnStep++;
    if (h.gait.moving && h.gait.eta > RAISE_LEAD) {
      walking++;
      expect(item.current.position.y).toBeLessThan(h.proportions.shoulderHeight);
    }
  }
  expect(walking).toBeGreaterThan(0);
  expect(raisingOnStep).toBeGreaterThan(0);
  expect(done).toBe(true);
  expect(item.current.position.distanceTo(destination.position)).toBeLessThan(0.01);
});
