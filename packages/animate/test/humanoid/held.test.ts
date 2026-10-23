import { clearBody } from '../../src/humanoid/hands/clearance';
import { Humanoid } from '../../src/humanoid/humanoid';
import { idle } from '../../src/humanoid/idle';
import { pointSegmentDistance } from '../../src/core/math';
import { RAISE_LEAD } from '../../src/humanoid/hands/place';
import { standing } from './fixtures';
import { Box3, Quaternion, Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import { expect, it } from 'vitest';
import { Body, createSkeletonModel, grab, INDEX, Item, place, carried, carry, hold, named, walkTo, onBone, release, takeOff, wear, when, withGaze, type Frame } from '../../src';
import { Carrier } from '../../src/core/carrier';
import { closeHand } from '../../src/humanoid/hands/grips';
import { reachFor } from '../../src/humanoid/hands/reach';
import { STEP } from '../../src/core/body';
import { leg } from '../core/rigs';

/** a body within this of where it comes to stand (m) has arrived: the steps after only settle it (tuned) */
const ARRIVED = 0.1;

it('keeps an unsupported grip through the next task’s gaze opening, then releases to rest', () => {
  const item = new Item(new Vector3(-0.15, 1.1, 0.35), new Quaternion(), { handle: { position: new Vector3() } });
  let gap = false;
  let samples = 0;
  let off = 0;
  let released = false;
  const h = standing((h) => [function* () {
      yield* grab(h, { right: [item, 'handle'] }, { walk: false, look: false })();
      yield* hold(h, item, { to: carried(h, 'right'), until: timePassed(1, 'seconds') })();
      gap = true;
      yield* withGaze(h, new Vector3(2, 1.5, 0), function* () {
        gap = false;
        yield* release(h, ['right'])();
        released = true;
      }, { first: true })();
    }, action<Frame>({ update: (f) => {
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
      yield* grab(h, { right: [item, 'handle'] }, { walk: false, look: false })();
      yield* carry(h, item, [[0.5, { position: goal }]])();
      world = item.current.position.clone();
      yield* carry(h, item, [[0.5, { position: new Vector3(-0.15, 0.15, 0.3) }]], { frame: () => frame.current })();
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
  const body: Body = new Body({ skeleton: leg() }, () => (function* () {
    yield* wear(body, item, 0, { to: local })();
    yield* action<Frame>({ update: (f) => f.current.setRoot(new Vector3(f.time, 1, 0)) });
  }), { idle: false, scale: 2 });
  const other = new Body({ skeleton: leg() }, () => (() => when(() => false)), { idle: false });
  const goal = onBone(body, 0, local);
  for (let i = 0; i < 180; i++) body.update(STEP);
  expect(item.current.position.distanceTo(body.pose.position(0).clone().add(new Vector3(0.2, 0.4, 0)))).toBeLessThan(0.001);
  expect(goal(other.frame).position.distanceTo(item.current.position)).toBeLessThan(0.001);
  body.frame.current.setRoot(new Vector3(10, 1, 0));
  expect(goal(other.frame).position.distanceTo(item.current.position)).toBeLessThan(0.001);
  other.update(STEP);
  body.update(STEP);
  expect(goal(other.frame).velocity.x).toBeCloseTo(1);
  const off = new Body({ skeleton: leg() }, () => (takeOff(body, item)), { idle: false });
  off.update(STEP);
  const at = item.current.position.clone();
  body.update(STEP);
  expect(item.current.position.equals(at)).toBe(true);
  expect(body.worn.size).toBe(0);
});

it('never throws on a late reach — its beat, item, grip and distance go to the dev log — while errors carry time and beat', () => {
  const item = new Item(new Vector3(0, 1, 4), new Quaternion(), { handle: { position: new Vector3() } }, { name: 'saddle' });
  const h = new Humanoid(createSkeletonModel(), (h) => function* () {
    yield* parallel<Frame>('all', idle(h), named('fetch saddle', reachFor(h, { right: [item, 'handle'] }, { limit: 0.1 })));
  }, { idle: false, dev: true });
  h.update(1);
  expect(h.log.map(({ check, where, beat }) => ({ check, where, beat }))).toEqual([{ check: 'late reach: grip distance after 0.1 s (m)', where: 'saddle right handle', beat: 'fetch saddle' }]);
  expect(h.log[0].value).toBeGreaterThan(1);
  const cause = new Error('attachment failed');
  const instant = new Body({ skeleton: leg() }, () => (named('attach saddle', function* () { throw cause; })), { idle: false });
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
      yield* grab(h, { right: [item, 'grip'] }, { walk: false, look: false })();
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
  const wearer: Body = new Body({ skeleton: leg() }, () => (wearFromStart), { idle: false });
  function* wearFromStart() { yield* wear(wearer, item, 0)(); }
  wearer.update(STEP);
  let done = false;
  let lower = 0;
  const h = standing((h) => [function* () {
      yield* grab(h, { left: [item, 'grip'] }, { walk: false, look: false })();
      done = true;
    }, action<Frame>({ update: () => { lower = Math.max(lower, h.asks.lower); } })]);
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
  const h = new Humanoid(createSkeletonModel(), (h) => function* () {
    yield* parallel<Frame>('all', action<Frame>({ update: (f) => {
      const at = f.current.position(INDEX.hips).clone();
      at.x = 0.04 * Math.sin(3 * f.time);
      f.current.setRoot(at);
    } }), function* () {
      yield* grab(h, { left: [a, 'grip'], right: [b, 'grip'] }, { walk: false, look: false })();
      yield* carry(h, [[a, [[0.3, { position: new Vector3(0.2, 1.15, 0.3) }]]], [b, [[1.5, { position: new Vector3(-0.2, 1.15, 0.3) }]]]])();
      done = true;
    }, action<Frame>({ update: (f) => {
      if (done || f.time < 1.5) return;
      samples++;
      off = Math.max(off, f.current.position(INDEX.leftHand).distanceTo(a.current.position));
    } }));
  }, { idle: false });
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
      yield* grab(h, { right: [item, 'handle'] }, { walk: false, look: false })();
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
  // Its arrival dip is visible afterwards: found by event — the load first up at its highest, then its lowest after — not by frame
  // windows, which shift with the course's timing.
  const top = Math.max(...heavy.heights), arrived = heavy.heights.findIndex((y) => y >= top - 0.002);
  expect(top - Math.min(...heavy.heights.slice(arrived))).toBeGreaterThan(0.015);
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
  const turn = (f: Frame) => 0.2 * Math.min(f.time, 4);
  const destination = (f: Frame) => ({ position: new Vector3(0, 1.2, 2 + 0.35 * Math.min(f.time, 4)),
    quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), turn(f)) });
  const h = standing((h) => [function* () {
    yield* grab(h, { left: [item, 'left'], right: [item, 'right'] }, { walk: false, look: false })();
    yield* place(h, item, destination)();
    done = true;
  }, action<Frame>({ update: (f) => {
    if (done) error = item.current.position.distanceTo(destination(f).position);
    if (h.locomotion.moving) {
      walking++;
      advanced = Math.max(advanced, destination(f).position.z - 2);
      // (the standoff and facing are judged while a walk goal is asked: a step after arriving — locomotion moves while a foot
      // swings — is no walk without one)
      const go = h.asks.go;
      if (!go) return;
      const distance = destination(f).position.clone().sub(go.to).setY(0).length();
      stand ??= distance;
      expect(distance).toBeCloseTo(stand, 5);
      expect(h.asks.face?.yaw).toBeCloseTo(turn(f), 5);
      expect(go.to.z).toBeCloseTo(destination(f).position.z - stand * Math.cos(turn(f)), 5);
    }
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
  const h = standing((h) => [function* () {
    yield* grab(h, { left: [item, 'left'], right: [item, 'right'] }, { walk: false, look: false })();
    yield* place(h, item, destination)();
    done = true;
  }]);
  // (judged in hindsight against when the travel ended — the body first within `ARRIVED` of where it comes to stand — not the walk's
  // `eta`, which a step after arriving leaves at Infinity: the load stays below the shoulder while walking until the last `RAISE_LEAD`
  // s of the approach, and rises on the way in)
  const frames: { t: number; at: Vector3; speed: number; y: number; carried: number }[] = [];
  for (let i = 0; i < 1200 && !done; i++) {
    h.update(STEP);
    frames.push({ t: i * STEP, at: h.pose.position(0).clone().setY(0), speed: h.locomotion.velocity.length(), y: item.current.position.y, carried: carried(h)(h.frame).position.y });
  }
  const last = frames[frames.length - 1].at;
  let away = -1;
  frames.forEach((f, i) => { if (f.at.distanceTo(last) > ARRIVED) away = i; });
  const end = frames[away + 1].t;
  const walked = frames.filter((f) => f.speed > 0.15 && f.t < end - RAISE_LEAD);
  expect(walked.length).toBeGreaterThan(0);
  for (const f of walked) expect(f.y).toBeLessThan(h.proportions.shoulderHeight);
  expect(frames.filter((f) => f.speed > 0.15 && f.t >= end - RAISE_LEAD && f.t <= end && f.y > f.carried + 0.01).length).toBeGreaterThan(0);
  expect(done).toBe(true);
  expect(item.current.position.distanceTo(destination.position)).toBeLessThan(0.01);
});

it('keeps the head clear while a wide held load rises through a downward gaze', () => {
  const item = new Item(new Vector3(0, 0.88, 0.55), new Quaternion(), {
    left: { position: new Vector3(0.22, 0, 0) }, right: { position: new Vector3(-0.22, 0, 0) },
  }, { mass: 8 });
  let samples = 0;
  const h = standing((h) => [function* () {
    yield* grab(h, { left: [item, 'left'], right: [item, 'right'] })();
    yield* withGaze(h, () => item.current.position, function* () {
      yield* carry(h, item, [[0.8, carried(h)], [1.1, { position: new Vector3(0, 1.3, 0.35) }]])();
      yield* hold(h, item)();
    })();
  }]);
  for (let i = 0; i < 600; i++) {
    h.update(STEP);
    if (item.supported) continue;
    samples++;
    const head = h.pose.point(INDEX.head, h.proportions.headCenter, new Vector3());
    expect(head.distanceTo(item.current.position)).toBeGreaterThan(0.22 + 0.06 * h.proportions.height);
  }
  expect(samples).toBeGreaterThan(60);
});

it.each([0.02, 0.22])('clears a %s m load from the final neck→head segment, including above the trunk', (radius) => {
  const h = standing(() => []);
  for (let i = 0; i < 60; i++) h.update(STEP);
  const item = new Item(new Vector3(), new Quaternion(), {}, {
    bounds: new Box3(new Vector3(-radius, -radius, -radius), new Vector3(radius, radius, radius)),
  });
  const neck = h.pose.position(INDEX.neck);
  const head = h.pose.point(INDEX.head, h.proportions.headCenter, new Vector3());
  const reserve = radius + 0.06 * h.proportions.height;
  for (const part of [0, 0.5, 1]) {
    const at = neck.clone().lerp(head, part);
    clearBody(h, h.frame, item, at, item.current.quaternion);
    expect(head.distanceTo(at)).toBeGreaterThan(reserve);
    expect(pointSegmentDistance(at, neck, head)).toBeGreaterThan(reserve);
  }
});

it.each([false, true])('checks grip activation against the final wrist before fitting (late contact %s)', (contact) => {
  const h = new Humanoid(createSkeletonModel(), (h) => function* () {
    const item = new Item(h.pose.position(INDEX.leftHand).clone().add(new Vector3(contact ? 0.1 : 0, 0, 0)), new Quaternion(), {
      end: { position: new Vector3() },
    }, { name: 'loose rope' });
    yield* closeHand(h, 'left', item, 'end')();
    yield* parallel<Frame>('all',
      hold(h, item, { to: () => ({ position: h.pose.position(INDEX.leftHand).clone() }) }),
      action<Frame>({ update: (f) => {
        f.current.setRoot(f.prev.position(0).clone().add(new Vector3(0.1, 0, 0)));
        f.current.setLocal(INDEX.leftHand, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.01));
      } }),
    );
  }, { idle: false, dev: true });
  h.update(STEP);
  const problems = h.log.filter((entry) => entry.check === 'grip activation distance (m)');
  if (contact) expect(problems).toEqual([]);
  else expect(problems).toEqual([expect.objectContaining({ value: expect.closeTo(0.1), limit: 0.03, where: 'loose rope left end' })]);
});
