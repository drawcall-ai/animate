import { Euler, Quaternion, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import { Humanoid, createSkeletonModel, idle, INDEX, handTo, lookAt, grab, carry, hold, withGaze, when, walkTo, reachFor, Item, type Behaviour, type Frame } from '../../src';

function body(task: (h: Humanoid) => Behaviour, life = true) {
  return new Humanoid(createSkeletonModel(), (h) => function* () { yield* parallel<Frame>('all', idle(h, { life }), task(h)); }, { dev: true });
}
const step = (h: Humanoid, seconds: number) => { for (let i = 0; i < seconds * 60; i++) h.update(1 / 60); };

it('stands alive, deterministically: breathing, millimetre sway and a weight shift within 25 s; can opt out', () => {
  const sample = (life: boolean) => {
    const h = body(() => function* () {}, life);
    const x: number[] = [], pitch: number[] = [];
    for (let i = 0; i < 1500; i++) {
      h.update(1 / 60);
      x.push(h.pose.com(new Vector3()).x);
      pitch.push(new Euler().setFromQuaternion(h.pose.rotation(INDEX.chest), 'YXZ').x);
    }
    expect(h.log).toEqual([]);
    return { x, pitch };
  };
  const a = sample(true), b = sample(true), still = sample(false);
  expect(a).toEqual(b);
  expect(Math.max(...a.x.slice(0, 600)) - Math.min(...a.x.slice(0, 600))).toBeGreaterThan(0.003);
  expect(Math.max(...a.x) - Math.min(...a.x)).toBeGreaterThan(0.04);
  expect(Math.max(...a.pitch.slice(120, 600)) - Math.min(...a.pitch.slice(120, 600))).toBeGreaterThan(0.02);
  expect(Math.max(...still.x) - Math.min(...still.x)).toBeLessThan(0.001);
});

it('turns the trunk for an across-body reach and for an over-shoulder look within ROM', () => {
  for (const look of [false, true]) {
    const h = body((h) => function* () {
      yield* parallel<Frame>('race', look ? lookAt(h.gazer, new Vector3(-2, 1.4, -1)) : handTo(h, 'right', { position: new Vector3(0.45, 1.2, 0.25) }), when(timePassed(3, 'seconds')));
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
    yield* grab(h, { right: [item, 'grip'] })();
    yield* withGaze(h, item.current.position, hold(h, item, { right: 'grip' }), { first: false })();
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
    let start = 0, off = 0, down = 0, end = 0;
    const h = body((h) => function* () {
      yield* grab(h, { right: [item, 'grip'] })();
      const hips = h.pose.position(0).y;
      yield* parallel<Frame>('all', function* () {
        yield* action<Frame>({ update: (f) => { start = f.time; }, until: timePassed(1 / 60, 'seconds') });
        yield* carry(h, { position: new Vector3(), quaternion: new Quaternion() }, [[item, { right: 'grip' }, [[1, { position: new Vector3(-0.15, 1.2, 0.4) }]]]])();
        yield* action<Frame>({ update: (f) => { end = f.time; }, until: timePassed(1 / 60, 'seconds') });
      }, action<Frame>({ update: (f) => {
        down = Math.max(down, hips - f.current.position(0).y);
        if (!item.supported && !off) off = f.time;
      }, until: () => end !== 0 }));
      yield* hold(h, item, { right: 'grip' })();
    });
    step(h, 5);
    expect(h.log).toEqual([]);
    return { delay: off - start, down, duration: end - off, pitch: new Euler().setFromQuaternion(h.pose.rotation(INDEX.chest), 'YXZ').x };
  };
  const light = run(0), heavy = run(5);
  expect(heavy.delay - light.delay).toBeGreaterThanOrEqual(0.18);
  expect(heavy.down).toBeGreaterThan(0.015);
  expect(heavy.duration).toBeGreaterThan(light.duration + 0.2);
  expect(heavy.pitch).toBeLessThan(light.pitch - 0.01);
});

it('slows the default walk under load, counting a bimanual item once', () => {
  const pace = (mass: number, both: boolean) => {
    const item = new Item(new Vector3(0, 1, 0.4), new Quaternion(), {
      left: { position: new Vector3(0.15, 0, 0) }, right: { position: new Vector3(-0.15, 0, 0) },
    }, { mass, supported: false });
    const grips = both ? { left: 'left', right: 'right' } : { right: 'right' };
    let speed = 0;
    const h = body((h) => function* () {
      yield* reachFor(h, both ? { left: [item, 'left'], right: [item, 'right'] } : { right: [item, 'right'] })();
      yield* parallel<Frame>('race', hold(h, item, grips), walkTo(h, { to: new Vector3(0, 0, 3) }), action<Frame>({
        update: () => { if (h.asks.go) speed = h.asks.go.speed; }, until: timePassed(0.2, 'seconds'),
      }));
      yield* hold(h, item, grips)();
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
