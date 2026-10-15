import { Quaternion, Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import { expect, it } from 'vitest';
import {
  Body, Humanoid, INDEX, Item, STEP, approach, carryTogether, createSkeletonModel,
  idle, named, onBone, reachFor, wear, when, type Frame,
} from '../../src';
import { leg } from '../core/rigs';

it('reads one final-pose path on any body, with velocity, and rejects facing without a gait', () => {
  const body = new Body(leg(), () => action<Frame>({ update: (f) => f.current.setRoot(new Vector3(f.time, 1, 0)) }));
  expect(() => onBone(body, 0, { position: new Vector3() }, { facing: true })).toThrow('facing requires a body with a gait');
  const goal = onBone(body, 0, { position: new Vector3() });
  body.update(STEP);
  body.frame.current.setRoot(new Vector3(10, 1, 0));
  expect(goal(body.frame).position.equals(body.pose.position(0))).toBe(true);
  body.update(STEP);
  expect(goal(body.frame).velocity.x).toBeCloseTo(1);
  expect(goal(body.frame).velocity.x).toBeCloseTo(1);
});

it('approaches a point from the shoulder middle and rejects unreachable stands before asking for a walk', () => {
  let done = false;
  const h = new Humanoid(createSkeletonModel(), (h) => function* () {
    const middle = h.pose.position(INDEX.leftUpperArm).clone().add(h.pose.position(INDEX.rightUpperArm)).multiplyScalar(0.5);
    yield* approach(h, middle.add(new Vector3(0, 0, 0.25)), { face: 0 })();
    done = true;
  });
  h.update(STEP);
  expect(done).toBe(true);
  expect(h.asks.go).toBeNull();
  for (const [point, ahead] of [[new Vector3(0, 1.4, 2), 2], [new Vector3(0, 10, 2), 0]] as const) {
    const far = new Humanoid(createSkeletonModel(), (h) => approach(h, point, { stand: { ahead } }));
    expect(() => far.update(STEP)).toThrow(/point .* from shoulder middle .* exceeds arm reach/);
    expect(far.asks.go).toBeNull();
  }
});

it('follows a grip worn by another body without asking the humanoid to lower for it', () => {
  const item = new Item(new Vector3(0.15, 0.9, 0.3), new Quaternion(), { grip: { position: new Vector3() } }, { mass: 8 });
  const wearer: Body = new Body(leg(), wearFromStart);
  function* wearFromStart() { yield* wear(wearer, item, 0)(); }
  wearer.update(STEP);
  let done = false;
  let lower = 0;
  const h = new Humanoid(createSkeletonModel(), (h) => function* () {
    yield* parallel<Frame>('all', idle(h), function* () {
      yield* reachFor(h, { left: [item, 'grip'] })();
      done = true;
    }, action<Frame>({ update: () => { lower = Math.max(lower, h.asks.lower); } }));
  });
  for (let i = 0; i < 180; i++) h.update(STEP);
  expect(done).toBe(true);
  expect(lower).toBe(0);
  expect(item.wornBy).toBe(wearer);
  expect(h.borne.has(item)).toBe(false);
});

it('moves initial worn items once and loads their moved centres on the same step', () => {
  const item = new Item(new Vector3(), new Quaternion(), {}, { mass: 8 });
  const h = new Humanoid(createSkeletonModel(), () => function* () { yield* when(() => false); }, {
    wearing: () => [{ item, on: INDEX.chest, at: { position: new Vector3(0.2, 0, 0) } }],
  });
  const initial = h.pose.com(new Vector3());
  h.update(STEP);
  expect(h.worn.size).toBe(1);
  expect(h.borne.get(item)?.kg).toBe(8);
  expect(item.current.position.distanceTo(h.pose.position(INDEX.chest).clone().add(new Vector3(0.2, 0, 0)))).toBeLessThan(1e-9);
  expect(h.pose.com(new Vector3()).distanceTo(initial)).toBeLessThan(1e-9);
});

it('keeps both carry grips until the slower course ends', () => {
  const a = new Item(new Vector3(0.2, 1.1, 0.3), new Quaternion(), { grip: { position: new Vector3() } });
  const b = new Item(new Vector3(-0.2, 1.1, 0.3), new Quaternion(), { grip: { position: new Vector3() } });
  let done = false;
  let samples = 0;
  let off = 0;
  const h = new Humanoid(createSkeletonModel(), (h) => function* () {
    yield* parallel<Frame>('all', action<Frame>({ update: (f) => {
      const at = f.current.position(INDEX.hips).clone();
      at.x = 0.04 * Math.sin(3 * f.time);
      f.current.setRoot(at);
    } }), function* () {
      yield* reachFor(h, { left: [a, 'grip'], right: [b, 'grip'] })();
      yield* carryTogether(h, [[a, [[0.3, { position: new Vector3(0.2, 1.15, 0.3) }]]], [b, [[1.5, { position: new Vector3(-0.2, 1.15, 0.3) }]]]])();
      done = true;
    }, action<Frame>({ update: (f) => {
      if (done || f.time < 1.5) return;
      samples++;
      off = Math.max(off, f.current.position(INDEX.leftHand).distanceTo(a.current.position));
    } }));
  });
  for (let i = 0; i < 300; i++) h.update(STEP);
  expect(done).toBe(true);
  expect(samples).toBeGreaterThan(10);
  expect(off).toBeLessThan(0.03);
});

it('clears the development beat when nothing is running', () => {
  const body = new Body(leg(), named('one step', function* () {
    yield () => 'finished';
  }), { dev: true });
  body.update(STEP);
  expect(body.frame.dev?.beat).toBe('one step');
  body.update(STEP);
  expect(body.frame.dev?.beat).toBeUndefined();
});
