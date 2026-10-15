import { Quaternion, Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import { expect, it } from 'vitest';
import {
  Body, Carrier, Humanoid, INDEX, Item, STEP, carried, carry, createSkeletonModel,
  hold, idle, named, onBone, reachFor, release, takeOff, wear, when, withGaze,
  type Frame,
} from '../../src';
import { leg } from '../core/rigs';

it('keeps an unsupported grip through the next task’s gaze opening, then releases to rest', () => {
  const item = new Item(new Vector3(-0.15, 1.1, 0.35), new Quaternion(), { handle: { position: new Vector3() } });
  let gap = false;
  let samples = 0;
  let off = 0;
  let released = false;
  const h = new Humanoid(createSkeletonModel(), (h) => function* () {
    yield* parallel<Frame>('all', idle(h), function* () {
      yield* reachFor(h, { right: [item, 'handle'] })();
      yield* hold(h, item, { to: carried(h, 'right'), until: timePassed(1, 'seconds') })();
      gap = true;
      yield* withGaze(h, new Vector3(2, 1.5, 0), function* () {
        gap = false;
        yield* release(h, ['right'])();
        released = true;
      })();
    }, action<Frame>({ update: (f) => {
      if (!gap) return;
      samples++;
      off = Math.max(off, f.current.position(INDEX.rightHand).distanceTo(item.current.position));
    } }));
  });
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
  const h = new Humanoid(createSkeletonModel(height), (h) => function* () {
    yield* parallel<Frame>('all', idle(h), function* () {
      yield* reachFor(h, { right: [item, 'handle'] })();
      yield* carry(h, item, [[0.5, { position: goal }]])();
      world = item.current.position.clone();
      yield* carry(h, item, [[0.5, { position: new Vector3(-0.15, 0.15, 0.3) }]], { on: frame })();
      done = true;
    });
  });
  for (let i = 0; i < 360; i++) h.update(STEP);
  expect(done).toBe(true);
  expect(world.distanceTo(goal)).toBeLessThan(0.011);
  expect(item.current.position.distanceTo(new Vector3(-0.15, 1.15, 0.3))).toBeLessThan(0.011);
});

it('wears on a generic body, follows its bone from another frame, and takes off without another mover', () => {
  const item = new Item(new Vector3(0.2, 1, 0), new Quaternion(), { grip: { position: new Vector3() } });
  const local = { position: new Vector3(0.1, 0.2, 0) };
  const body: Body = new Body(leg(), function* () {
    yield* wear(body, item, 0, { to: local })();
    yield* action<Frame>({ update: (f) => f.current.setRoot(new Vector3(f.time, 1, 0)) });
  }, { scale: 2 });
  const other = new Body(leg(), () => when(() => false));
  const goal = onBone(body, 0, local);
  for (let i = 0; i < 180; i++) body.update(STEP);
  expect(item.current.position.distanceTo(body.pose.position(0).clone().add(new Vector3(0.2, 0.4, 0)))).toBeLessThan(0.001);
  expect(goal(other.frame).position.distanceTo(item.current.position)).toBeLessThan(0.001);
  const off = new Body(leg(), takeOff(body, item));
  off.update(STEP);
  const at = item.current.position.clone();
  body.update(STEP);
  expect(item.current.position.equals(at)).toBe(true);
  expect(body.worn.size).toBe(0);
});

it('reports time, beat, cause, item, grip and distance with dev off', () => {
  const item = new Item(new Vector3(0, 1, 4), new Quaternion(), { handle: { position: new Vector3() } }, { name: 'saddle' });
  const h = new Humanoid(createSkeletonModel(), (h) => function* () {
    yield* parallel<Frame>('all', idle(h), named('fetch saddle', reachFor(h, { right: [item, 'handle'] }, { limit: 0.1 })));
  });
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
