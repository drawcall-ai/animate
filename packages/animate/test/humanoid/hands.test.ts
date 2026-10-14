import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import { carry, gazeOff, grab, idle, INDEX, Item, reachFor, type Behaviour, type Frame, type Leg } from '../../src';
import { Humanoid } from '../../src/humanoid/humanoid';
import { createSkeletonModel } from '../../src/humanoid/model';
import type { Side } from '../../src/humanoid/bones';

const WORLD = { position: new Vector3(), quaternion: new Quaternion() };
const box = (at: Vector3) => new Item(at, new Quaternion(), { left: { position: new Vector3(0.15, 0, 0) }, right: { position: new Vector3(-0.15, 0, 0) } });

/** hand `side` in the hips' frame: where it is moved to, not carried along by the body */
const onHips = (h: Humanoid, side: Side) => h.pose.position(INDEX[`${side}Hand`]).clone().sub(h.pose.position(INDEX.hips)).applyQuaternion(h.pose.rotation(INDEX.hips).clone().invert());

/** each hand's speed (m/s) at each sub-step of `behaviour` (over the base), from when `mark` is called in it, in the hips' frame */
function speeds(behaviour: (h: Humanoid, mark: () => void) => Behaviour, seconds: number): Record<Side, number[]> {
  const v: Record<Side, number[]> = { left: [], right: [] };
  let marked = false;
  const h = new Humanoid(createSkeletonModel(), (h) =>
    function* () {
      yield* action({ until: () => true });
      const was = { left: new Vector3(), right: new Vector3() };
      yield* parallel<Frame>(
        'all',
        idle(h),
        behaviour(h, () => {
          marked = true;
          for (const side of ['left', 'right'] as const) was[side].copy(onHips(h, side));
        }),
        action<Frame>({
          update: () => {
            if (!marked) return;
            for (const side of ['left', 'right'] as const) {
              const at = onHips(h, side);
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

const start = (v: number[]) => v.findIndex((x) => x > 0.05) / 60;
const peak = (v: number[]) => v.indexOf(Math.max(...v)) / 60;

describe('grab', () => {
  it('anticipates: the eyes and then the hands go to what it takes before the body has come up to it', () => {
    const load = box(new Vector3(0.1, 0.9, 2.2));
    const at = { eyes: NaN, hands: NaN, stood: NaN };
    const h = new Humanoid(createSkeletonModel(), (h) =>
      function* () {
        yield* action({ until: () => true });
        const was = new Vector3();
        yield* parallel<Frame>(
          'race',
          idle(h),
          function* () {
            yield* grab(h, { left: [load, 'left'], right: [load, 'right'] })();
          },
          action<Frame>({
            update: (f) => {
              const middle = load.current.position;
              if (Number.isNaN(at.eyes) && gazeOff(h.gazer, f.prev, middle) < 0.2) at.eyes = f.time;
              const hand = onHips(h, 'right');
              if (Number.isNaN(at.hands) && f.time > 0.5 && hand.distanceTo(was) * 60 > 0.15) at.hands = f.time;
              was.copy(hand);
              if (Number.isNaN(at.stood) && f.time > 1 && h.gait.velocity.length() < 0.05) at.stood = f.time;
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

describe('two hands', () => {
  it('reaching together are not mirror images: the left sets off a moment after the right, a little slower', () => {
    const load = box(new Vector3(0, 1.0, 0.45));
    const v = speeds(
      (h, mark) =>
        function* () {
          yield* action({ until: timePassed(1, 'seconds') });
          mark();
          yield* reachFor(h, { left: [load, 'left'], right: [load, 'right'] })();
        },
      4,
    );
    expect(start(v.left) - start(v.right)).toBeGreaterThanOrEqual(0.05);
    expect(start(v.left) - start(v.right)).toBeLessThanOrEqual(0.13);
  });

  it('carrying an item each: the left goes a moment after the right', () => {
    const a = box(new Vector3(0.2, 1.0, 0.35));
    const b = box(new Vector3(-0.2, 1.0, 0.35));
    const legs = (x: number): Leg[] => [[0.8, { position: new Vector3(x, 1.25, 0.4) }], [0.8, { position: new Vector3(x, 1.0, 0.3) }]];
    // (the items' speeds: each where its hands carry it)
    const v: Record<Side, number[]> = { left: [], right: [] };
    speeds(
      (h) =>
        function* () {
          yield* reachFor(h, { left: [a, 'right'], right: [b, 'left'] })();
          yield* parallel<Frame>('race', carry(h, WORLD, [[a, { left: 'right' }, legs(0.35)], [b, { right: 'left' }, legs(-0.35)]]), action<Frame>({
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
