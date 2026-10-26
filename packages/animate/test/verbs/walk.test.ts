import { Object3D, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { expect, it } from 'vitest';
import { arriving, grab, reach, release, wait, walkTo } from '../../src';
import { insides, person, play } from '../bodies';
import { box, roomOf } from '../things';

it('a grab waiting on the walk starts before the walk ends, without taking the legs from it', () => {
  const body = person({ dev: true }), h = insides(body), room = roomOf(body);
  const to = new Vector3(0, 0, 2);
  const load = box(room, new Vector3(-0.1, 0.9, 2.45), { solid: false });
  const at = { started: NaN, walked: NaN, held: NaN };
  const legs = new Set<string>();
  play(function* () {
    yield* parallel('all', function* () {
      yield* walkTo(body, to);
      at.walked = h.frame.time;
    }, function* () {
      yield* wait(arriving(body, 0.6));
      at.started = h.frame.time;
      yield* grab(body, load, { right: 'right' });
      at.held = h.frame.time;
    });
  }, [body], 10, () => {
    if (Number.isNaN(at.walked) && body.goals.go) legs.add(body.goals.go.verb);
    return !Number.isNaN(at.held) && !Number.isNaN(at.walked);
  });
  expect(at.started).toBeLessThan(at.walked);
  // (asked, the walk keeps the legs while the grab would borrow them)
  expect([...legs]).toEqual(['walkTo']);
  expect(h.pose.com(new Vector3()).setY(0).distanceTo(to)).toBeLessThan(0.3);
  expect(body.log).toEqual([]);
});

it('arriving reads what the body moves toward: its walk while it walks, its rest once nothing moves', () => {
  const body = person();
  const seen: boolean[] = [];
  play(function* () {
    seen.push(arriving(body, 0.5)());
    yield* parallel('race', walkTo(body, new Vector3(0, 0, 5)), function* () {
      yield* wait(0.5);
      seen.push(arriving(body, 0.5)());
    });
    // (the walk cancelled under way: nothing moves toward anything, and the body is not yet at rest)
    seen.push(arriving(body, 0.5)());
    yield* wait(arriving(body, 0.5));
    seen.push(insides(body).locomotion.settled);
  }, [body], 8, () => seen.length === 4);
  expect(seen).toEqual([true, false, false, true]);
});

it('arriving foresees every mover: a reach before its hands get there, a grab while it walks up; what the body does itself after a release holds it up not', () => {
  const body = person(), h = insides(body), room = roomOf(body);
  const near = box(room, new Vector3(-0.2, 1.1, 0.4), { mass: 1, solid: false, name: 'near' });
  const far = box(room, new Vector3(0.1, 0.9, 2.5), { mass: 1, solid: false, name: 'far' });
  const at: Record<string, number> = {};
  const mark = (name: string) => function* () { at[name] = h.frame.time; };
  play(function* () {
    yield* parallel('all', function* () {
      yield* reach(body, { right: new Vector3(-0.25, 1.2, 0.45) });
      yield* mark('reached')();
    }, function* () {
      yield* wait(0.1);
      yield* wait(arriving(body, 0.6));
      yield* mark('reach arriving')();
    });
    yield* grab(body, near, { right: 'right' });
    yield* wait(() => h.locomotion.settled);
    release(body, near);
    yield* wait(0.1);
    // (the hands backing out — the body's own request — while what its stories moved has arrived: as settled as the body is)
    at.backing = h.requests.some((request) => request.owned) ? 1 : 0;
    at.unheld = arriving(body, 0.1)() && h.locomotion.settled ? 1 : 0;
    yield* parallel('all', function* () {
      yield* grab(body, far, { left: 'left', right: 'right' });
      yield* mark('grabbed')();
    }, function* () {
      yield* wait(0.1);
      yield* wait(arriving(body, 0.6));
      yield* mark('grab arriving')();
      at.walking = insides(body).locomotion.moving ? 1 : 0;
    });
  }, [body], 15, () => at.grabbed !== undefined);
  expect(at['reach arriving']).toBeLessThan(at.reached - 0.3);
  expect([at.backing, at.unheld]).toEqual([1, 1]);
  expect(at['grab arriving']).toBeLessThan(at.grabbed - 0.4);
  expect(at.walking).toBe(1);
});

it('given until, walks after a target that moves, and stops with it', () => {
  const body = person({ dev: true }), room = roomOf(body);
  const lead = new Object3D();
  room.add(lead);
  let done = false;
  play(function* () {
    yield* walkTo(body, lead, { until: 8 });
    done = true;
  }, [body], 9, (time) => {
    lead.position.set(0, 0, Math.min(time, 4) * 0.8);
    return done;
  });
  expect(done).toBe(true);
  expect(body.position.distanceTo(lead.position)).toBeLessThan(0.15);
  expect(body.log).toEqual([]);
});

it('throws on a pace that is none, and for a body its app drives', () => {
  const body = person();
  expect(() => walkTo(body, new Vector3(), { speed: 0 })).toThrow('no pace');
  const driven = person({ drive: () => ({ position: new Vector3(), velocity: new Vector3(), yaw: 0 }) });
  expect(() => play(function* () { yield* walkTo(driven, new Vector3(0, 0, 1)); }, [driven], 0.1)).toThrow('drives it');
});
