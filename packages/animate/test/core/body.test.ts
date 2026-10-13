import { action, parallel, timePassed } from '@pmndrs/timeline';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Body, type Ctx } from '../../src';
import { drive, run } from './drive';
import { arm, tip } from './rigs';

const reach = (value: Vector3) => (ctx: Ctx) => void ctx.propose.target({ kind: 'position', point: tip(), value, weight: 1 });

describe('Body', () => {
  it('runs a behaviour timeline end to end, cancelling a raced reach', () => {
    const log: string[] = [];
    const up = new Vector3(0.5, 1.4, 0);
    const down = new Vector3(0.5, 0.6, 0);
    const body = new Body(arm(), function* () {
      yield* parallel(
        'race',
        action({ until: timePassed(1, 'seconds') }),
        function* () {
          try {
            yield* action({ update: reach(up) });
          } finally {
            log.push(`reach cancelled at frame ${frames}`);
          }
        },
      );
      log.push('down');
      yield* action({ update: reach(down) });
    });
    let frames = 0;
    run(body, 1, () => frames++);
    expect(body.state.point(tip(), new Vector3()).distanceTo(up)).toBeLessThan(0.01);
    expect(log).toEqual([]);
    run(body, 2, () => frames++);
    expect(log).toEqual(['reach cancelled at frame 60', 'down']);
    expect(body.state.point(tip(), new Vector3()).distanceTo(down)).toBeLessThan(0.01);
  });

  it('gives the same state for one 1/30 s update as for two 1/60 s ones', () => {
    const behaviour = (ctx: Ctx) => {
      ctx.propose.target({ kind: 'position', point: tip(), value: new Vector3(0.4, 1.3 + 0.2 * Math.sin(3 * ctx.time), 0.1), weight: 1 });
      ctx.propose.cap({ bone: 2, acceleration: 40 });
    };
    const a = drive(arm(), behaviour);
    const b = drive(arm(), behaviour);
    for (let i = 0; i < 60; i++) {
      a.update(1 / 30);
      b.update(1 / 60);
      b.update(1 / 60);
    }
    expect(a.time).toBe(b.time);
    expect(a.state.position.toArray()).toEqual(b.state.position.toArray());
    a.state.local.forEach((q, i) => expect(q.toArray()).toEqual(b.state.local[i].toArray()));
    a.state.rates.forEach((r, i) => expect(r.toArray()).toEqual(b.state.rates[i].toArray()));
  });

  it('splits a long update into even sub-steps and steps the clock once each', () => {
    const seen: { dt: number; frame: number; delta: number }[] = [];
    const body = new Body(arm(), function* () {
      yield* action<Ctx>({ update: (ctx, clock) => void seen.push({ dt: ctx.dt, frame: clock.frame, delta: clock.delta }) });
    });
    body.update(0.05);
    body.update(0);
    expect(seen.map((s) => s.frame)).toEqual([0, 1, 2]);
    seen.forEach((s) => expect(s.dt).toBeCloseTo(0.05 / 3, 15));
    expect(seen[0].delta).toBe(seen[0].dt);
    expect(() => body.update(-1)).toThrow();
    expect(() => body.update(NaN)).toThrow();
  });

  it('propagates errors out of update', () => {
    const body = new Body(arm(), function* () {
      yield* action({ until: timePassed(0.1, 'seconds') });
      throw new Error('broken behaviour');
    });
    expect(() => run(body, 0.2)).toThrow('broken behaviour');
    const bad = drive(arm(), (ctx) => ctx.propose.target({ kind: 'position', point: { bone: 7, at: new Vector3() }, value: new Vector3(), weight: 1 }));
    expect(() => bad.update(1 / 60)).toThrow(/bone 7/);
  });

  it('tells each owner which contacts it was granted, next sub-step', () => {
    const granted: string[] = [];
    const body = drive(arm(), (ctx) => {
      const g = ctx.granted('weak');
      granted.push(`${g.won.length}/${g.lost.length}`);
      ctx.propose.contact({ point: tip(), position: new Vector3(0.85, 1, 0), priority: 2, owner: 'strong' });
      ctx.propose.contact({ point: tip(), position: new Vector3(0.8, 1.1, 0), priority: 1, owner: 'weak' });
      ctx.propose.contact({ point: { bone: 0, at: new Vector3() }, position: new Vector3(0, 1, 0), priority: 1, owner: 'weak', support: 1 });
    });
    run(body, 2 / 60);
    expect(granted).toEqual(['0/0', '1/1']);
  });

  it('lists the weight-bearing contacts with where their points are', () => {
    let supports: ReturnType<Ctx['supports']> = [];
    const body = drive(arm(), (ctx) => {
      supports = ctx.supports();
      ctx.propose.contact({ point: { bone: 0, at: new Vector3(0, -0.1, 0) }, position: new Vector3(0, 0.9, 0), priority: 1, support: 1 });
      ctx.propose.contact({ point: tip(), position: new Vector3(0.85, 1, 0), priority: 1 });
    });
    run(body, 2 / 60);
    expect(supports.length).toBe(1);
    expect(supports[0].contact.support).toBe(1);
    expect(supports[0].position.distanceTo(new Vector3(0, 0.9, 0))).toBeLessThan(1e-9);
  });

  it('hands behaviours the world, and fails visibly without one', () => {
    const world = { floor: 0 };
    let floor = NaN;
    const body = new Body(arm(), function* () {
      yield* action<Ctx<typeof world>>({ update: (ctx) => void (floor = ctx.world.floor) });
    }, { world, position: new Vector3(1, 2, 3) });
    body.update(1 / 60);
    expect(floor).toBe(0);
    expect(body.state.position.toArray()).toEqual([1, 2, 3]);
    const lost = drive(arm(), (ctx) => void ctx.world);
    expect(() => lost.update(1 / 60)).toThrow(/without a world/);
  });
});
