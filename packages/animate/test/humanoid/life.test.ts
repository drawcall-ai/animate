import { Euler, Quaternion, Vector3 } from 'three';
import { person } from '../person';
import { idle } from '../../src/humanoid/idle';
import { expect, it } from 'vitest';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import { type Humanoid, createSkeletonModel, INDEX, handTo, lookAt, grab, carry, hold, withGaze, when, walkTo, Item, facingAt, type Behaviour, type Frame, type Side } from '../../src';
import { Life } from '../../src/humanoid/balance/life';

function body(task: (h: Humanoid) => Behaviour, height = 1.75) {
  return person(createSkeletonModel(height), (h) => function* () { yield* parallel<Frame>('all', idle(h), task(h)); }, { idle: false, dev: true });
}
const step = (h: Humanoid, seconds: number) => { for (let i = 0; i < seconds * 60; i++) h.update(1 / 60); };

it('stands alive, deterministically: breathing, millimetre sway and a weight shift within 25 s', () => {
  const sample = () => {
    const h = body(() => function* () {});
    const x: number[] = [], pitch: number[] = [];
    for (let i = 0; i < 1500; i++) {
      h.update(1 / 60);
      x.push(h.pose.com(new Vector3()).x);
      pitch.push(new Euler().setFromQuaternion(h.pose.rotation(INDEX.chest), 'YXZ').x);
    }
    const sign = Math.sign(h.locomotion.quiet.x);
    expect(Math.abs(h.locomotion.quiet.x)).toBeGreaterThan(0.04);
    const loaded = sign > 0 ? 'left' : 'right';
    const unloaded = sign > 0 ? 'right' : 'left';
    const hip = (side: 'left' | 'right') => h.pose.position(INDEX[`${side}UpperLeg`]).y;
    const knee = (side: 'left' | 'right') => h.pose.local(INDEX[`${side}LowerLeg`]).angleTo(new Quaternion());
    expect(hip(unloaded)).toBeLessThan(hip(loaded) - 0.005);
    expect(knee(unloaded)).toBeGreaterThan(0.2);
    expect(knee(unloaded)).toBeGreaterThan(knee(loaded));
    step(h, 3);
    expect(h.locomotion.quiet.x * sign).toBeGreaterThan(0.04);
    expect(h.log).toEqual([]);
    return { x, pitch };
  };
  const a = sample(), b = sample();
  expect(a).toEqual(b);
  expect(Math.max(...a.x.slice(0, 600)) - Math.min(...a.x.slice(0, 600))).toBeGreaterThan(0.003);
  expect(Math.max(...a.x) - Math.min(...a.x)).toBeGreaterThan(0.04);
  expect(Math.max(...a.pitch.slice(120, 600)) - Math.min(...a.pitch.slice(120, 600))).toBeGreaterThan(0.02);
});

it('turns the trunk for an across-body reach and for an over-shoulder look within ROM', () => {
  for (const look of [false, true]) {
    const h = body((h) => function* () {
      yield* parallel<Frame>('race', look ? lookAt(h, new Vector3(-2, 1.4, -1)) : handTo(h, 'right', { position: new Vector3(0.45, 1.2, 0.25) }), when(timePassed(3, 'seconds')));
    });
    step(h, 3);
    const turn = new Euler().setFromQuaternion(h.pose.rotation(INDEX.chest), 'YXZ').y;
    expect(Math.abs(turn)).toBeGreaterThan(0.12);
    step(h, 3);
    expect(Math.abs(new Euler().setFromQuaternion(h.pose.rotation(INDEX.chest), 'YXZ').y)).toBeLessThan(0.05);
    expect(h.log).toEqual([]);
  }
});

it('grabs a floor grip while the gaze stays in range in a deep squat', () => {
  const item = new Item(new Vector3(-0.1, 0.03, 0.45), new Quaternion(), { grip: { position: new Vector3() } });
  const h = body((h) => function* () {
    yield* grab(h, { right: [item, 'grip'] }, { first: true })();
    yield* withGaze(h, item.current.position, hold(h, item))();
  });
  for (let i = 0; i < 360; i++) {
    h.update(1 / 60);
    expect(new Vector3(0, 1, 0).applyQuaternion(h.pose.rotation(INDEX.head)).y).toBeGreaterThan(0);
  }
  expect(h.holding.right?.item).toBe(item);
  expect(h.pose.position(INDEX.rightHand).distanceTo(item.current.position)).toBeLessThan(0.02);
  const eyes = h.gazer.eyes(h.pose, new Vector3());
  const local = item.current.position.clone().sub(eyes).applyQuaternion(h.pose.rotation(INDEX.head).clone().invert());
  expect(Math.atan2(-local.y, Math.hypot(local.x, local.z))).toBeLessThan(h.gazer.range.down + 0.02);
  expect(h.log).toEqual([]);
});

it('prepares a heavy lift before support leaves, and carries it slower than a light item', () => {
  const run = (mass: number) => {
    const item = new Item(new Vector3(-0.15, 1, 0.4), new Quaternion(), { grip: { position: new Vector3() } }, { mass });
    let start = 0, off = 0, down = 0, preparation = 0, end = 0;
    const h = body((h) => function* () {
      yield* grab(h, { right: [item, 'grip'] }, { first: true })();
      const hips = h.pose.position(0).y;
      yield* parallel<Frame>('all', function* () {
        yield* action<Frame>({ update: (f) => { start = f.time; }, until: timePassed(1 / 60, 'seconds') });
        yield* carry(h, item, [[1, { position: new Vector3(-0.15, 1.2, 0.4) }]])();
        yield* action<Frame>({ update: (f) => { end = f.time; }, until: timePassed(1 / 60, 'seconds') });
      }, action<Frame>({ update: (f) => {
        if (item.supported) {
          down = Math.max(down, hips - f.current.position(0).y);
          preparation = Math.max(preparation, h.asks.lower);
        }
        if (!item.supported && !off) off = f.time;
      }, until: () => end !== 0 }));
      yield* hold(h, item)();
    });
    step(h, 5);
    expect(h.log).toEqual([]);
    return { delay: off - start, down, preparation, duration: end - off, pitch: new Euler().setFromQuaternion(h.pose.rotation(INDEX.chest), 'YXZ').x };
  };
  const light = run(0), heavy = run(5);
  // The requested APA contract replaces the former 200 ms / 25 mm staging.
  expect(heavy.delay - light.delay).toBeGreaterThanOrEqual(0.05);
  expect(heavy.delay - light.delay).toBeLessThanOrEqual(0.15);
  expect(heavy.preparation).toBeGreaterThanOrEqual(0.005);
  expect(heavy.down).toBeLessThan(0.01);
  expect(heavy.duration).toBeGreaterThan(light.duration + 0.2);
  expect(heavy.pitch).toBeLessThan(light.pitch - 0.01);
});

it('slows the default walk under load, counting a bimanual item once', () => {
  const pace = (mass: number, both: boolean) => {
    const item = new Item(new Vector3(0, 1, 0.4), new Quaternion(), {
      left: { position: new Vector3(0.15, 0, 0) }, right: { position: new Vector3(-0.15, 0, 0) },
    }, { mass, supported: false });
    let speed = 0;
    const h = body((h) => function* () {
      yield* grab(h, both ? { left: [item, 'left'], right: [item, 'right'] } : { right: [item, 'right'] }, { walk: false, look: false })();
      yield* parallel<Frame>('race', hold(h, item), walkTo(h, { to: new Vector3(0, 0, 3) }), action<Frame>({
        update: () => { if (h.asks.go) speed = h.asks.go.speed; }, until: timePassed(0.2, 'seconds'),
      }));
      yield* hold(h, item)();
    });
    step(h, 4);
    expect(h.log).toEqual([]);
    return speed;
  };
  const light = pace(0, false), heavy = pace(5, false);
  expect(heavy).toBeGreaterThan(0);
  expect(heavy).toBeLessThan(light);
  expect(pace(5, true)).toBeCloseTo(heavy, 8);
});

it('keeps sway and breathing after a loaded walk, without spontaneous weight shifts', () => {
  const item = new Item(new Vector3(-0.15, 1.05, 0.35), new Quaternion(), { grip: { position: new Vector3() } }, { mass: 5, supported: false });
  const h = body((h) => function* () {
    yield* grab(h, { right: [item, 'grip'] }, { walk: false, look: false })();
    const carrying = hold(h, item, { to: facingAt(h, INDEX.hips, { position: new Vector3(-0.15, 0.12, 0.35) }) });
    yield* parallel<Frame>('race', carrying, walkTo(h, { to: new Vector3(0, 0, 2) }));
    yield* carrying();
  });
  step(h, 8);
  const sway: number[] = [], breath: number[] = [];
  for (let i = 0; i < 900; i++) {
    h.update(1 / 60);
    sway.push(h.pose.com(new Vector3()).x);
    breath.push(new Euler().setFromQuaternion(h.pose.rotation(INDEX.chest), 'YXZ').x);
    expect(h.locomotion.quiet.length()).toBeLessThan(0.02);
  }
  expect(Math.max(...sway) - Math.min(...sway)).toBeGreaterThan(0.004);
  expect(Math.max(...breath) - Math.min(...breath)).toBeGreaterThan(0.02);
  expect(h.log).toEqual([]);
});

it('seeds the first weight-shift side and alternates later shifts, including after activity', () => {
  for (const seed of [0, 1, 42]) {
    const life = new Life(seed);
    const shifts: Side[] = [];
    let previous: Side | null = null;
    for (let step = 0; step < 6000; step++) {
      life.update(0.1, step < 2000 || step >= 2100, 0);
      if (life.onto && life.onto !== previous) shifts.push(life.onto);
      previous = life.onto;
    }
    expect(shifts.length).toBeGreaterThan(8);
    expect(shifts.every((side, i) => i === 0 || side !== shifts[i - 1])).toBe(true);
  }
});

it.each([1.6, 1.75, 1.85])('prepares an 8 kg low grip with the knees before lifting on a %s m body', (height) => {
  const scale = height / 1.75;
  const item = new Item(new Vector3(0, 0.88 * scale, 0.45 * scale), new Quaternion(), {
    left: { position: new Vector3(0.18 * scale, 0, 0) }, right: { position: new Vector3(-0.18 * scale, 0, 0) },
  }, { mass: 8 });
  let knee = NaN, pitch = NaN, drop = NaN;
  const h = body((h) => function* () {
    yield* grab(h, { left: [item, 'left'], right: [item, 'right'] }, { first: true })();
    knee = (h.pose.local(INDEX.leftLowerLeg).angleTo(new Quaternion()) + h.pose.local(INDEX.rightLowerLeg).angleTo(new Quaternion())) * 90 / Math.PI;
    pitch = new Euler().setFromQuaternion(h.pose.rotation(INDEX.chest), 'YXZ').x * 180 / Math.PI;
    drop = h.proportions.hipHeight - h.pose.position(0).y;
    yield* hold(h, item)();
  }, height);
  step(h, 6);
  expect(h.holding.left?.item).toBe(item);
  expect(h.holding.right?.item).toBe(item);
  // research-contact.md §4 rule 3 [C]: ≥10–15° knee flexion under load; geometry [D]:
  // ~15–25° trunk flexion at a typical waist-height target, not a measured universal limit.
  // The stronger 20–30° knee bounds, 35° pitch ceiling and 1.5 cm drop below are tuned.
  expect(knee).toBeGreaterThanOrEqual(20);
  expect(knee).toBeLessThanOrEqual(30);
  // (with a bow too: the chest pitched forward more than 0.2 rad, as the old grip's asked bow was)
  expect(pitch).toBeGreaterThan(0.2 * 180 / Math.PI);
  expect(pitch).toBeLessThanOrEqual(35);
  expect(drop).toBeGreaterThan(0.015 * scale);
  expect(h.log).toEqual([]);
});
