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

  it('bounds pelvis excursion and contact ringing in each steady stride and after stopping', () => {
    const h = new Humanoid(createSkeletonModel(), (h) => function* () {
      yield* parallel<Frame>('all', idle(h), walkTo(h, { to: new Vector3(0, 0, 12) }));
    });
    const samples: { y: number; speed: number }[] = [];
    const contacts: number[] = [];
    let planted = true;
    let settled = Infinity;
    for (let tick = 0; tick < 15 * 60; tick++) {
      h.update(dt);
      samples.push({ y: h.pose.position(0).y, speed: h.gait.velocity.length() });
      const on = h.feet[0].phase === 'planted';
      if (on && !planted) contacts.push(tick);
      planted = on;
      if (tick > 3 * 60 && h.gait.settled) settled = Math.min(settled, tick);
    }
    const range = (ys: number[]) => Math.max(...ys) - Math.min(...ys);
    const reversals = (ys: number[]) => {
      let peak = ys[0], direction = 0, count = 0;
      for (const y of ys.slice(1)) {
        const change = y - peak;
        if (!direction) {
          if (Math.abs(change) > 0.001) { direction = Math.sign(change); peak = y; }
          continue;
        }
        if (direction * change >= 0) { peak = y; continue; }
        if (Math.abs(change) <= 0.001) continue;
        count++;
        direction = Math.sign(change);
        peak = y;
      }
      return count;
    };
    let strides = 0;
    for (let k = 1; k < contacts.length; k++) {
      const from = contacts[k - 1], to = contacts[k];
      const stride = samples.slice(from, to + 1);
      if (from < 3 * 60 || stride.some((sample) => sample.speed < 1.2)) continue;
      const ys = stride.map((sample) => sample.y);
      // HEAD d318ba2: ~4.4 cm; eight reversals above 1 mm already exist.
      expect(range(ys)).toBeLessThanOrEqual(0.045);
      expect(reversals(ys)).toBeLessThanOrEqual(8);
      strides++;
    }
    expect(strides).toBeGreaterThanOrEqual(4);
    expect(Number.isFinite(settled)).toBe(true);
    const rest = samples.slice(settled + 30).map((sample) => sample.y);
    expect(rest.length).toBeGreaterThan(60);
    expect(range(rest)).toBeLessThanOrEqual(0.012);
    expect(reversals(rest)).toBeLessThanOrEqual(1);
  });
});
