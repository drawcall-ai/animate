import { Object3D, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { expect, it } from 'vitest';
import { arriving, grab, wait, walkTo } from '../../src';
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
