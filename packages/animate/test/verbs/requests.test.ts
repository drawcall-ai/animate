import { Vector3 } from 'three';
import { parallel, runTimeline } from '@pmndrs/timeline';
import { describe, expect, it } from 'vitest';
import { grab, lookAt, reach, wait, walkTo, watch } from '../../src';
import { claim, dt, insides, person, play, run } from '../bodies';
import { box, roomOf } from '../things';

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
      const look = body.goals.look;
      const now = look ? `${look.verb} ${look.tier}` : 'idle';
      if (looks[looks.length - 1] !== now) looks.push(now);
      return held;
    });
    expect(held).toBe(true);
    // (the grab's eyes borrowed, the look asked over them for its second, then the grab's again; at contact they leave)
    expect(looks.slice(0, 4)).toEqual(['grab borrowed', 'lookAt asked', 'grab borrowed', 'idle']);
  });

  it('the newest asked request takes a part, and the one it overrode takes it back when it ends', () => {
    const body = person();
    const looks: string[] = [];
    let done = false;
    play(function* () {
      yield* parallel('all', lookAt(body, new Vector3(2, 1.6, 2), { until: 2 }), function* () {
        yield* wait(0.5);
        yield* lookAt(body, new Vector3(-2, 1.6, 2), { until: 0.5 });
      });
      done = true;
    }, [body], 4, () => {
      const site = body.goals.look?.site ?? 'idle';
      if (looks[looks.length - 1] !== site) looks.push(site);
      return done;
    });
    expect(looks).toHaveLength(4);
    expect(looks[0]).toBe(looks[2]);
    expect(looks[1]).not.toBe(looks[0]);
    expect(looks[3]).toBe('idle');
  });

  it("only the request that has a part moves it; the legs' others keep their count, unheard", () => {
    const body = person(), h = insides(body);
    const runs = { trunk: [0, 0], go: [0, 0] };
    const borrowed = claim(body, 'trunk', () => void runs.trunk[0]++, 'borrowed');
    const asked = claim(body, 'trunk', () => void runs.trunk[1]++);
    claim(body, 'go', () => void runs.go[0]++, 'borrowed');
    claim(body, 'go', () => {
      runs.go[1]++;
      return { to: new Vector3(0, 0, 1), speed: 1, accel: 1 };
    });
    run(body, 0.5);
    expect(runs.trunk).toEqual([0, 30]);
    expect(runs.go).toEqual([30, 30]);
    expect(h.going?.to.z).toBe(1);
    asked();
    run(body, 0.5);
    expect(runs.trunk).toEqual([30, 30]);
    borrowed();
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
      const go = body.goals.go;
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
    }, [body], 2, () => void (legs ||= body.goals.go !== undefined));
    expect(legs).toBe(false);
  });

  it('a verb ends true once met, false once it cannot be; until ends it true whatever its goal', () => {
    const body = person(), room = roomOf(body);
    const high = box(room, new Vector3(0, 4, 0.5));
    const outcomes: boolean[] = [];
    play(function* () {
      outcomes.push(yield* walkTo(body, new Vector3(0, 0, 1)));
      outcomes.push(yield* grab(body, high, { right: 'right' }));
      outcomes.push(yield* walkTo(body, new Vector3(0, 0, 9), { until: 0.5 }));
    }, [body], 10, () => outcomes.length === 3);
    expect(outcomes).toEqual([true, false, true]);
  });
});

describe('development', () => {
  it('a watch puts what it finds into the log of the body it names, under its label', () => {
    const body = person({ dev: true });
    play(function* () {
      yield* parallel('race', wait(0.1), watch('stays home', () => ({ body, check: 'away (m)', value: 1, limit: 0, where: 'hips' })));
    }, [body], 0.2);
    expect(body.log[0]).toMatchObject({ check: 'stays home: away (m)', where: 'hips' });
  });

  it('says when an aimer without until stands in a sequence, and when a story stops stepping its verbs', () => {
    const body = person({ dev: true });
    play(function* () {
      yield* lookAt(body, new Vector3(0, 1.6, 2));
      yield* wait(1);
    }, [body], 0.5);
    expect(body.log.map(({ check }) => check)).toEqual(['lookAt without until in a sequence: it never ends, and what follows it never runs']);
    // (a story stepped once, then never again: its request goes stale)
    const other = person({ dev: true });
    const step = runTimeline(function* () { yield* lookAt(other, new Vector3(0, 1.6, 2), { until: 5 }); });
    step(undefined, dt);
    for (let t = 0; t < 1.5; t += dt) other.update(dt);
    expect(other.log.map(({ check }) => check)).toEqual(['request not renewed for 1 s: its story stopped stepping (s)']);
  });
});
