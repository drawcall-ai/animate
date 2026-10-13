import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { action, parallel } from '@pmndrs/timeline';
import { Humanoid, idle, walkTo, type Frame } from '../../src';
import { createSkeletonModel } from '../../src/humanoid/model';

const dt = 1 / 60;

describe('balance', () => {
  it('stands still where it starts, its feet planted, and reads and clears what it is asked every sub-step', () => {
    const asked: number[] = [];
    const h = new Humanoid(createSkeletonModel(), (h) =>
      function* () {
        yield* parallel<Frame>(
          'all',
          idle(h),
          action<Frame>({ update: () => void (asked.push(h.asks.lower), (h.asks.lower = 0.01)) }),
        );
      },
    );
    const start = h.feet.map((f) => f.position.clone());
    for (let k = 0; k < 120; k++) h.update(dt);
    expect(h.feet.every((f, s) => f.phase === 'planted' && f.position.equals(start[s]))).toBe(true);
    expect(h.gait.settled).toBe(true);
    // (cleared by balance before each sub-step's tasks ask again)
    expect(asked.every((x) => x === 0)).toBe(true);
  });

  it('walks to a point and settles there on squared feet; walkTo ends then', () => {
    const to = new Vector3(0.6, 0, 2);
    let arrived = -1;
    const h = new Humanoid(createSkeletonModel(), (h) =>
      function* () {
        yield* parallel<Frame>('all', idle(h), function* () {
          yield* walkTo(h, { to, face: 0.5 })();
          arrived = h.gait.moving ? -2 : 1;
        });
      },
    );
    for (let k = 0; k < 8 * 60 && arrived < 0; k++) h.update(dt);
    expect(arrived).toBe(1);
    expect(h.pose.com(new Vector3()).setY(0).distanceTo(to)).toBeLessThan(0.15);
    expect(Math.abs(h.gait.facing - 0.5)).toBeLessThan(0.15);
    for (const [s, f] of h.feet.entries()) expect(Math.abs(f.yaw - (0.5 + (s === 0 ? 0.12 : -0.12)))).toBeLessThan(0.1);
  });
});
