import { Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { describe, expect, it } from 'vitest';
import { attempt, Body, dog, grab, lookAt, Missed, reach, wait, walkTo } from '../../src/index';
import { DOG } from '../../skills/animate/references/dog';
import { person, play } from '../kit/bodies';
import { box, roomOf } from '../kit/things';

describe('requests', () => {
  it('an asked request beats a borrower, and the borrower takes the part back when it ends', () => {
    const body = person(), room = roomOf(body);
    const load = box(room, new Vector3(0.1, 0.9, 2.2));
    const looks: string[] = [];
    let held = false;
    play(function* () {
      yield* parallel('all', function* () {
        held = yield* grab(body, load, { left: 'left', right: 'right' });
      }, function* () {
        yield* wait(0.5);
        yield* lookAt(body, new Vector3(-2, 1.6, 1), { until: 1 });
      });
    }, [body], 10, () => {
      const look = body.owners.look;
      const now = look ? `${look.verb} ${look.tier}` : 'idle';
      if (looks[looks.length - 1] !== now) looks.push(now);
      return held;
    });
    expect(held).toBe(true);
    // (the grab's eyes borrowed, the look asked over them for its second, then the grab's again; at contact they leave)
    expect(looks.slice(0, 4)).toEqual(['grab borrowed', 'lookAt asked', 'grab borrowed', 'idle']);
  });

  it('the newest asked request takes a part, and the one it overrode takes it back when it ends', () => {
    // (development on: each request labelled by where its story asked for it)
    const body = person({ dev: true });
    const looks: string[] = [];
    let done = false;
    play(function* () {
      yield* parallel('all', lookAt(body, new Vector3(2, 1.6, 2), { until: 2 }), function* () {
        yield* wait(0.5);
        yield* lookAt(body, new Vector3(-2, 1.6, 2), { until: 0.5 });
      });
      done = true;
    }, [body], 4, () => {
      const site = body.owners.look?.site ?? 'idle';
      if (looks[looks.length - 1] !== site) looks.push(site);
      return done;
    });
    expect(looks).toHaveLength(4);
    expect(looks[0]).toBe(looks[2]);
    expect(looks[1]).not.toBe(looks[0]);
    expect(looks[3]).toBe('idle');
  });


  it('among borrowers, the first keeps the legs', () => {
    const body = person(), room = roomOf(body);
    const load = box(room, new Vector3(1.5, 0.9, 3));
    const legs = new Set<string>();
    play(function* () {
      yield* parallel('race', grab(body, load, { right: 'right' }), function* () {
        yield* wait(0.2);
        yield* reach(body, { left: new Vector3(-1.5, 1.2, -3) });
      });
    }, [body], 3, () => {
      const go = body.owners.legs;
      if (go) legs.add(`${go.verb} ${go.tier}`);
    });
    expect([...legs]).toEqual(['grab borrowed']);
  });

  it('nothing borrows the legs of a body its app drives', () => {
    const root = { position: new Vector3(), velocity: new Vector3(), yaw: 0 };
    const body = person({ drive: () => root }), room = roomOf(body);
    const load = box(room, new Vector3(0.6, 0.9, 1.2));
    let legs = false;
    play(function* () {
      yield* grab(body, load, { right: 'right' }, { until: 2 });
    }, [body], 2, () => void (legs ||= body.owners.legs !== undefined));
    expect(legs).toBe(false);
  });

  it('a verb ends true once met, misses once it cannot be; until cut short ends it false', () => {
    const body = person(), room = roomOf(body);
    const high = box(room, new Vector3(0, 4, 0.5));
    const outcomes: (boolean | Missed | null)[] = [];
    play(function* () {
      outcomes.push(yield* walkTo(body, new Vector3(0, 0, 1)));
      outcomes.push(yield* attempt(grab(body, high, { right: 'right' })));
      outcomes.push(yield* walkTo(body, new Vector3(0, 0, 9), { until: 0.5 }));
    }, [body], 10, () => outcomes.length === 3);
    expect(outcomes).toEqual([true, expect.any(Missed), false]);
  });

  it('a walk given until misses once it stalls short of a goal standing still', () => {
    // (a dog before a wall 1.5 m high: it can get no nearer the point beyond)
    const body = new Body(dog(DOG), { dev: true, floor: (_x, z) => (z > 1 ? 1.5 : 0) });
    let miss: Missed | null | undefined;
    const ended = play(function* () { miss = yield* attempt(walkTo(body, new Vector3(0, 0, 2), { until: 20 })); }, [body], 25, () => miss !== undefined);
    expect(miss).toMatchObject({ verb: 'walkTo', why: expect.stringContaining('no nearer') });
    expect(ended).toBeLessThan(15);
  });
});
