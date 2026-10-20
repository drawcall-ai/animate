import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import { Body, follow, followRotation, Pose, type Frame } from '../../src';
import { rng } from '../humanoid/fixtures';
import { leg, turn } from './rigs';

/** a behaviour writing `write` every sub-step, forever (or for `seconds`) */
const every = (write: (f: Frame) => void, seconds?: number) =>
  function* () {
    yield* action<Frame>({ update: (f) => void write(f), until: seconds === undefined ? undefined : timePassed(seconds, 'seconds') });
  };

describe('Body', () => {
  it('layers its behaviours: the later writer wins on the bones it writes, a weighted one blends over', () => {
    const body = new Body(leg(), function* () {
      yield* parallel<Frame>(
        'all',
        every((f) => {
          f.current.setLocal(1, turn(1, 0, 0, 0.4));
          f.current.setLocal(2, turn(1, 0, 0, 0.4));
        }),
        every((f) => f.current.setLocal(2, turn(1, 0, 0, 1))),
        every((f) => f.current.setLocal(1, turn(1, 0, 0, 0.8), 0.5)),
      );
    });
    body.update(1 / 60);
    expect(body.pose.local(2).angleTo(turn(1, 0, 0, 1))).toBeLessThan(1e-7);
    expect(body.pose.local(1).angleTo(turn(1, 0, 0, 0.6))).toBeLessThan(1e-7);
  });

  it('sets its behaviour out on the first update: the behaviour may read the body it moves as it sets out', () => {
    let read = NaN;
    const body: Body = new Body(leg(), function* () {
      read = body.pose.local(1).w;
      yield* every(() => {})();
    });
    body.update(1 / 60);
    expect(read).toBe(1);
  });

  it('hands over continuously when a layer ends: the one below follows its pose from the motion there is', () => {
    const accel = 40;
    const rest = new Quaternion();
    const body = new Body(leg(), function* () {
      yield* parallel<Frame>(
        'all',
        every((f) => f.current.setLocal(2, followRotation(f.prev2.local(2), f.prev.local(2), rest, { accel }, f.dt, new Quaternion()))),
        every((f) => f.current.setLocal(2, turn(1, 0, 0, 1.2 * Math.sin(4 * f.time))), 0.5),
      );
    });
    const angles: number[] = [];
    for (let k = 0; k < 120; k++) {
      body.update(1 / 60);
      const q = body.pose.local(2);
      angles.push(2 * Math.atan2(q.x, q.w));
    }
    const dt = 1 / 60;
    // after the upper layer (until 0.5 s), at most `accel`, and back at rest
    const after = angles.slice(28);
    const accelerations = after.slice(2).map((a, k) => Math.abs(a - 2 * after[k + 1] + after[k]) / dt ** 2);
    expect(Math.max(...accelerations)).toBeLessThan(accel + 1e-6);
    expect(Math.abs(angles.at(-1) ?? NaN)).toBeLessThan(1e-9);
  });

  it('keeps the final poses as history: current becomes prev, prev becomes prev2', () => {
    const seen: [number, number, number][] = [];
    const angle = (q: Quaternion) => 2 * Math.acos(Math.min(1, Math.abs(q.w)));
    const body = new Body(
      leg(),
      every((f) => {
        seen.push([angle(f.prev2.local(2)), angle(f.prev.local(2)), angle(f.current.local(2))]);
        f.current.setLocal(2, turn(1, 0, 0, 0.1 * Math.round(f.time * 60)));
      }),
    );
    body.update(3 / 60);
    // (`current` starts as `prev`)
    const expected = [
      [0, 0, 0],
      [0, 0.1, 0.1],
      [0.1, 0.2, 0.2],
    ];
    seen.forEach((s, i) => s.forEach((v, k) => expect(v).toBeCloseTo(expected[i][k], 9)));
    expect(angle(body.pose.local(2))).toBeCloseTo(0.3, 9);
    expect(body.frame.prev2.position(3).distanceTo(body.pose.position(3))).toBeGreaterThan(0.01);
  });

  it('steps in fixed sub-steps whatever the updates: jittered frames give what fixed ones do, still braked in time', () => {
    const goal = new Vector3(1, 0, 0);
    const run = (updates: number[]) => {
      const roots: Vector3[] = [];
      const body = new Body(
        leg(),
        every((f) => {
          f.current.setRoot(follow(f.prev2.position(0), f.prev.position(0), goal, { accel: 10 }, f.dt, new Vector3()));
          roots.push(f.current.position(0).clone());
        }),
      );
      for (const dt of updates) body.update(dt);
      return { roots, time: body.frame.time };
    };
    const fixed = run(Array(120).fill(1 / 60));
    const rand = rng(5);
    const jittered: number[] = [];
    for (let left = 2; left > 1e-12; ) {
      const dt = Math.min(left, [1 / 144, 1 / 240, 1 / 30, 1e-6][Math.floor(rand() * 4)] * (0.8 + 0.4 * rand()));
      jittered.push(dt);
      left -= dt;
    }
    const varied = run(jittered);
    expect(varied.roots.length).toBe(fixed.roots.length);
    varied.roots.forEach((r, k) => expect(r.equals(fixed.roots[k])).toBe(true));
    const x = varied.roots.map((r) => r.x - 1);
    expect(Math.max(...x)).toBeLessThan(1e-12);
    const dt = 1 / 60;
    expect(Math.max(...x.slice(2).map((v, k) => Math.abs(v - 2 * x[k + 1] + x[k]) / dt ** 2))).toBeLessThan(10 + 1e-6);
    expect(run([1 / 30]).roots.length).toBe(2);
    expect(() => run([NaN])).toThrow(/cannot update/);
  });

  it('starts still at the pose it is given, alone in a world of none', () => {
    const skeleton = leg();
    const start = new Pose(skeleton);
    start.setLocal(2, turn(1, 0, 0, 0.5));
    let read = false;
    const body = new Body(
      skeleton,
      every((f) => {
        expect(f.prev2.local(2).equals(f.prev.local(2))).toBe(true);
        expect(f.world.bodies).toEqual([]);
        read = true;
      }),
      { pose: start },
    );
    body.update(1 / 60);
    expect(read).toBe(true);
    expect(body.pose.local(2).equals(start.local(2))).toBe(true);
  });
});
