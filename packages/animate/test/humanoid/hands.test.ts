import { Euler, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import { approach, carry, grab, handTo, hold, idle, INDEX, Item, release, when, type Behaviour, type Frame, type Waypoint } from '../../src';
import { reachFor } from '../../src/humanoid/hands/reach';
import { gazeOff } from '../../src/core/gaze';
import { Humanoid } from '../../src/humanoid/humanoid';
import { createSkeletonModel } from '../../src/humanoid/model';
import type { Side } from '../../src/humanoid/bones';
import { standing } from './fixtures';

const box = (at: Vector3) => new Item(at, new Quaternion(), { left: { position: new Vector3(0.15, 0, 0) }, right: { position: new Vector3(-0.15, 0, 0) } });

/** hand `side` in the hips' frame: where it is moved to, not carried along by the body */
const onHips = (h: Humanoid, side: Side) => h.pose.position(INDEX[`${side}Hand`]).clone().sub(h.pose.position(INDEX.hips)).applyQuaternion(h.pose.rotation(INDEX.hips).clone().invert());

/** each hand's speed (m/s) at each sub-step of `behaviour` (over the base, the body standing), from when `mark` is called in it */
function speeds(behaviour: (h: Humanoid, mark: () => void) => Behaviour, seconds: number): Record<Side, number[]> {
  const v: Record<Side, number[]> = { left: [], right: [] };
  let marked = false;
  const h = new Humanoid(createSkeletonModel(), (h) =>
    function* () {
      yield* when(() => true);
      const was = { left: new Vector3(), right: new Vector3() };
      yield* parallel<Frame>(
        'all',
        idle(h),
        behaviour(h, () => {
          marked = true;
          for (const side of ['left', 'right'] as const) was[side].copy(h.pose.position(INDEX[`${side}Hand`]));
        }),
        action<Frame>({
          update: () => {
            if (!marked) return;
            for (const side of ['left', 'right'] as const) {
              const at = h.pose.position(INDEX[`${side}Hand`]);
              v[side].push(at.distanceTo(was[side]) * 60);
              was[side].copy(at);
            }
          },
        }),
      );
    },
  );
  for (let t = 0; t < seconds; t += 1 / 60) h.update(1 / 60);
  return v;
}

/** when a hand has gone `m` (s) */
const gone = (v: number[], m: number) => {
  let path = 0;
  return v.findIndex((x) => (path += x / 60) > m) / 60;
};
const peak = (v: number[]) => v.indexOf(Math.max(...v)) / 60;

describe('grab', () => {
  it.each([0, 1, 2])('looks at a two-hand pickup at least a second before its last travelling touchdown (variation %i)', (seed) => {
    const load = new Item(new Vector3(1.1, 0.88, 2), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2), {
      left: { position: new Vector3(0.22, 0, 0) }, right: { position: new Vector3(-0.22, 0, 0) },
    }, { mass: 8 });
    const h = new Humanoid(createSkeletonModel(1.75 + seed * 0.02), (h) => function* () {
      yield* parallel<Frame>('all', idle(h), grab(h, { left: [load, 'left'], right: [load, 'right'] }, { face: Math.PI / 2 }));
    }, { dev: true, position: { x: 1.5 + seed * 0.02, z: 0 }, yaw: -0.1 });
    const feet = h.feet.map((foot) => ({ phase: foot.phase, from: foot.position.clone() }));
    let walking = false, stood = NaN, looking = NaN, touchdown = NaN;
    for (let tick = 0; tick < 600 && Number.isNaN(stood); tick++) {
      h.update(1 / 60);
      const time = (tick + 1) / 60;
      walking ||= h.locomotion.velocity.length() > 0.5;
      if (gazeOff(h.gazer, h.pose, load.current.position) >= 0.2) looking = NaN;
      else if (Number.isNaN(looking)) looking = time;
      h.feet.forEach((foot, s) => {
        const was = feet[s];
        const com = h.pose.com(new Vector3());
        if (foot.phase === 'swing' && was.phase !== 'swing') was.from.copy(com);
        if (foot.phase === 'planted' && was.phase === 'swing' && Math.hypot(com.x - was.from.x, com.z - was.from.z) > 0.1) {
          touchdown = time;
        }
        was.phase = foot.phase;
      });
      if (walking && !h.locomotion.moving) stood = time;
    }
    expect(stood).toBeGreaterThan(touchdown);
    // research-contact §3: derived acceptance bounds, not measured human thresholds.
    expect(touchdown - looking).toBeGreaterThanOrEqual(1);
    expect(h.log).toEqual([]);
  });

  it('keeps the free arm swing until the walk ETA reaches one second, even passing reachable grips', () => {
    const make = (take: boolean) => new Humanoid(createSkeletonModel(), (h) => function* () {
      const load = new Item(new Vector3(1.1, 0.88, 2), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2), {
        left: { position: new Vector3(0.22, 0, 0) }, right: { position: new Vector3(-0.22, 0, 0) },
      }, { mass: 8 });
      const holds = { left: [load, 'left'], right: [load, 'right'] } satisfies Parameters<typeof grab>[1];
      yield* parallel<Frame>('all', idle(h), take ? grab(h, holds, { face: Math.PI / 2, look: false }) : approach(h, holds, { face: Math.PI / 2 }));
    }, { position: { x: 1.5, z: 0 }, yaw: -0.1 });
    const taking = make(true), walking = make(false);
    let samples = 0;
    for (let tick = 0; tick < 240; tick++) {
      taking.update(1 / 60);
      walking.update(1 / 60);
      if (taking.locomotion.eta <= 1) break;
      if (!Number.isFinite(taking.locomotion.eta)) continue;
      samples++;
      for (const side of ['left', 'right'] as const) for (const joint of ['UpperArm', 'LowerArm', 'Hand'] as const) {
        const bone = INDEX[`${side}${joint}`];
        expect(taking.pose.local(bone).angleTo(walking.pose.local(bone))).toBeLessThan(1e-6);
      }
    }
    expect(samples).toBeGreaterThan(60);
  });

  it('bows to hip-high grips without a transient squat', () => {
    // Recalled rack geometry and stand (1.05 arm lengths): hip-high grips,
    // just beyond a standing arm's reach.
    const load = box(new Vector3(0, 0.88, 0.61));
    let finished = false;
    const h = standing((h) => [function* () {
      yield* grab(h, { left: [load, 'left'], right: [load, 'right'] }, { face: 0, spot: { ahead: 1.05 * h.proportions.armLength } })();
      finished = true;
    }]);
    let knee = 0, bow = 0;
    for (let tick = 0; tick < 300 && !finished; tick++) {
      h.update(1 / 60);
      bow = Math.max(bow, new Euler().setFromQuaternion(h.pose.rotation(INDEX.chest), 'YXZ').x);
      for (const side of ['left', 'right'] as const) {
        const at = (joint: string) => h.pose.position(h.pose.skeleton.index(`${side}${joint}`)).clone();
        const joint = at('LowerLeg');
        knee = Math.max(knee, Math.PI - at('UpperLeg').sub(joint).angleTo(at('Foot').sub(joint)));
      }
    }
    expect(finished).toBe(true);
    // Tuned regression bounds: relaxed knees below 35°, with at least 30° of bow.
    expect(knee * 180 / Math.PI).toBeLessThan(35);
    expect(bow * 180 / Math.PI).toBeGreaterThan(30);
  });

  it('anticipates: the eyes and then the hands go to what it takes before the body has come up to it', () => {
    const load = box(new Vector3(0.1, 0.9, 2.2));
    const at = { eyes: NaN, hands: NaN, stood: NaN };
    const h = new Humanoid(createSkeletonModel(), (h) =>
      function* () {
        yield* when(() => true);
        const was = new Vector3();
        yield* parallel<Frame>(
          'race',
          idle(h),
          function* () {
            yield* grab(h, { left: [load, 'left'], right: [load, 'right'] }, { first: true })();
          },
          action<Frame>({
            update: (f) => {
              const middle = load.current.position;
              if (Number.isNaN(at.eyes) && gazeOff(h.gazer, f.prev, middle) < 0.2) at.eyes = f.time;
              const hand = onHips(h, 'right');
              if (Number.isNaN(at.hands) && f.time > 0.5 && hand.distanceTo(was) * 60 > 0.15) at.hands = f.time;
              was.copy(hand);
              if (Number.isNaN(at.stood) && f.time > 1 && h.locomotion.velocity.length() < 0.05) at.stood = f.time;
            },
          }),
        );
      },
    );
    for (let t = 0; t < 8; t += 1 / 60) h.update(1 / 60);
    expect(h.holding.right?.item).toBe(load);
    // (the eyes there, then the hands on their way, before the walk has come to a stop)
    expect(at.eyes).toBeLessThan(at.stood);
    expect(at.hands).toBeLessThan(at.stood);
    expect(at.eyes).toBeLessThan(at.hands);
  });
});

describe('grab low', () => {
  it('comes down for what lies low as it plants its last step, not after standing still', () => {
    const load = box(new Vector3(0.1, 0.15, 2.2));
    const at = { arrived: NaN, down: NaN };
    let walked = false;
    let standing = NaN;
    const h = new Humanoid(createSkeletonModel(), (h) =>
      function* () {
        yield* parallel<Frame>('race', idle(h), grab(h, { left: [load, 'left'], right: [load, 'right'] }, { first: true }), action<Frame>({
          update: (f) => {
            const hips = f.prev.position(INDEX.hips).y;
            standing = Number.isNaN(standing) ? hips : standing;
            const v = h.locomotion.velocity.length();
            if (v > 0.3) walked = true;
            if (walked && Number.isNaN(at.arrived) && v < 0.05) at.arrived = f.time;
            if (Number.isNaN(at.down) && hips < standing - 0.1) at.down = f.time;
          },
        }));
      },
    );
    for (let t = 0; t < 8; t += 1 / 60) h.update(1 / 60);
    expect(h.holding.right?.item).toBe(load);
    // (the hips 10 cm down within 0.3 s of coming to a stop: 1.6 s after, waiting to stand still)
    expect(at.down - at.arrived).toBeLessThan(0.3);
  });
});

describe('release', () => {
  it('follows through: a hand let go of something moving carries on its way, then off the item', () => {
    const load = box(new Vector3(0, 1.0, 0.4));
    const at = { let: new Vector3(), after: new Vector3() };
    const h = new Humanoid(createSkeletonModel(), (h) =>
      function* () {
        yield* when(() => true);
        yield* parallel<Frame>('race', idle(h), function* () {
          yield* reachFor(h, { right: [load, 'right'] })();
          // (swept to the right, let go of halfway)
          yield* parallel<Frame>('race', carry(h, load, [[0.8, { position: new Vector3(-0.3, 1.0, 0.4) }]]), when(timePassed(0.4, 'seconds')));
          at.let.copy(h.pose.position(INDEX.rightHand));
          yield* parallel<Frame>('race', release(h, ['right']), when(timePassed(0.4, 'seconds')));
          at.after.copy(h.pose.position(INDEX.rightHand));
        });
      },
    );
    for (let t = 0; t < 4; t += 1 / 60) h.update(1 / 60);
    // (0.4 s after letting go, well on to the right, where it was carrying the box: not just coasting to a stop)
    expect(at.let.x - at.after.x).toBeGreaterThan(0.04);
    expect(h.holding.right).toBeNull();
  });
});

describe('reachFor', () => {
  it('takes as long as a reach that far takes (Fitts): longer for a farther grip', () => {
    const reach = (at: Vector3) => {
      const load = box(at);
      const v = speeds(
        (h, mark) =>
          function* () {
            yield* when(timePassed(1, 'seconds'));
            mark();
            yield* reachFor(h, { right: [load, 'right'] })();
            yield* hold(h, load)();
          },
        3.5,
      );
      const moving = v.right.filter((x) => x > 0.05);
      return { took: moving.length / 60 };
    };
    const near = reach(new Vector3(-0.05, 1.0, 0.3));
    const far = reach(new Vector3(-0.1, 1.05, 0.5));
    expect(far.took).toBeGreaterThan(near.took);
  });
});

describe('reach onset', () => {
  it('sets off toward the grip at once: the hand never first draws back from it', () => {
    for (const at of [new Vector3(-0.1, 1.0, 0.45), new Vector3(-0.15, 0.3, 0.5), new Vector3(-0.3, 1.4, 0.3)]) {
      const load = box(at);
      const off: number[] = [];
      speeds(
        (h, mark) =>
          function* () {
            yield* when(timePassed(1, 'seconds'));
            mark();
            yield* parallel<Frame>('race', reachFor(h, { right: [load, 'right'] }), action<Frame>({ update: () => void off.push(h.pose.position(INDEX.rightHand).distanceTo(load.toWorld(load.grips.right, { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() }).position)) }));
          },
        2.5,
      );
      // (the first 0.3 s: never further off than it set off from)
      const growth = Math.max(...off.slice(0, 18)) - off[0];
      expect(growth).toBeLessThan(0.001);
    }
  });
});

describe('two hands', () => {
  it('reaching together are not mirror images: the left sets off a moment after the right, a little slower', () => {
    const load = box(new Vector3(0, 1.0, 0.45));
    const v = speeds(
      (h, mark) =>
        function* () {
          yield* when(timePassed(1, 'seconds'));
          mark();
          yield* reachFor(h, { left: [load, 'left'], right: [load, 'right'] })();
        },
      4,
    );
    // (10 cm on its way 60–120 ms after the right, give or take a sub-step or two)
    const lag = gone(v.left, 0.1) - gone(v.right, 0.1);
    expect(lag).toBeGreaterThanOrEqual(0.04);
    expect(lag).toBeLessThanOrEqual(0.15);
  });

  it('the following hand waits where it is: held out, it does not drop toward its hang before it sets off', () => {
    const load = box(new Vector3(0, 0.95, 0.5));
    const out = (side: Side) => ({ position: new Vector3(side === 'left' ? 0.2 : -0.2, 1.05, 0.3) });
    const v = speeds(
      (h, mark) =>
        function* () {
          // (both hands held out before them, then gone for the box from there)
          yield* parallel<Frame>('race', handTo(h, 'left', out('left'), { lead: false }), handTo(h, 'right', out('right'), { lead: false }), when(timePassed(1.5, 'seconds')));
          mark();
          yield* reachFor(h, { left: [load, 'left'], right: [load, 'right'] })();
        },
      4,
    );
    // (until the right hand is well under way, the left keeps still)
    const under = v.right.findIndex((x) => x > 0.3);
    expect(Math.max(...v.left.slice(0, under))).toBeLessThan(0.1);
  });

  it('carrying an item each: the left goes a moment after the right', () => {
    const a = box(new Vector3(0.2, 1.0, 0.35));
    const b = box(new Vector3(-0.2, 1.0, 0.35));
    const legs = (x: number): Waypoint[] => [[0.8, { position: new Vector3(x, 1.25, 0.4) }], [0.8, { position: new Vector3(x, 1.0, 0.3) }]];
    // (the items' speeds: each where its hands carry it)
    const v: Record<Side, number[]> = { left: [], right: [] };
    speeds(
      (h) =>
        function* () {
          yield* reachFor(h, { left: [a, 'right'], right: [b, 'left'] })();
          yield* parallel<Frame>('race', parallel('all', carry(h, a, legs(0.35)), carry(h, b, legs(-0.35))), action<Frame>({
            update: () => {
              v.left.push(a.current.position.distanceTo(a.prev.position) * 60);
              v.right.push(b.current.position.distanceTo(b.prev.position) * 60);
            },
          }));
        },
      8,
    );
    expect(peak(v.left) - peak(v.right)).toBeGreaterThan(0.05);
    expect(peak(v.left) - peak(v.right)).toBeLessThan(0.3);
  });
});
