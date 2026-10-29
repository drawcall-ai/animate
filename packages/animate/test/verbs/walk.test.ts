import { Object3D, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { expect, it } from 'vitest';
import { arriving, grab, lookAt, reach, release, wait, walkTo } from '../../src/index';
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
    if (Number.isNaN(at.walked) && body.owners.go) legs.add(body.owners.go.verb);
    return !Number.isNaN(at.held) && !Number.isNaN(at.walked);
  });
  expect(at.started).toBeLessThan(at.walked);
  // (asked, the walk keeps the legs while the grab would borrow them)
  expect([...legs]).toEqual(['walkTo']);
  expect(h.pose.com(new Vector3()).setY(0).distanceTo(to)).toBeLessThan(0.3);
  expect(body.log).toEqual([]);
});

it('arriving reads what the body begins to move toward once it is made: false till then, its walk while it walks, true once that ends', () => {
  const body = person(), h = insides(body);
  const seen: boolean[] = [], at = { arriving: NaN, walked: NaN };
  play(function* () {
    const soon = arriving(body, 0.5);
    // (at rest, nothing begun since it was made)
    seen.push(soon());
    yield* parallel('race', walkTo(body, new Vector3(0, 0, 5)), function* () {
      yield* wait(0.5);
      // (walking, still far off; and one made after the walk began does not count it)
      seen.push(soon(), arriving(body, 0.5)());
    });
    // (the walk cancelled under way: nothing it began moves toward anything now)
    seen.push(soon());
    // (made beside a walk, ahead of it in the branches, it waits for that walk)
    yield* parallel('all', function* () {
      yield* wait(arriving(body, 0.5));
      at.arriving = h.frame.time;
    }, function* () {
      yield* walkTo(body, new Vector3(0, 0, 3));
      at.walked = h.frame.time;
    });
  }, [body], 15, () => !Number.isNaN(at.walked));
  expect(seen).toEqual([false, false, false, true]);
  expect(at.walked - at.arriving).toBeGreaterThan(0.25);
  expect(at.walked - at.arriving).toBeLessThan(0.75);
});

// (a walk ends once there, turned and settled: its feet squared and held still; `arriving` foresees that end, not the moment it is there)
it.each([
  ['a walk', new Vector3(0, 0, 3), undefined],
  ['a walk ending turned', new Vector3(0, 0, 3), Math.PI / 2],
  ['a small turn in place', new Vector3(), Math.PI / 6],
  ['a quarter turn in place', new Vector3(), Math.PI / 2],
] as const)('arriving foresees when %s ends', (_, to, face) => {
  const body = person(), soon = arriving(body, 0.4);
  let foreseen = NaN, ended = NaN, time = 0;
  play(function* () {
    yield* walkTo(body, to, face === undefined ? {} : { face });
    ended = time;
  }, [body], 10, (t) => {
    time = t;
    if (Number.isNaN(foreseen) && soon()) foreseen = t;
    return !Number.isNaN(ended);
  });
  expect(ended - foreseen).toBeGreaterThan(0.4 - 0.25);
  expect(ended - foreseen).toBeLessThan(0.4 + 0.25);
});

/** an empty on the floor at (`x`, `z`), unturned */
function markAt(x: number, z: number): Object3D {
  const mark = new Object3D();
  mark.position.set(x, 0, z);
  mark.updateMatrixWorld();
  return mark;
}

// (the stance a walk squares its feet into is the one the body then stands in: no shuffle follows its arrival)
it.each([
  ['a point', new Vector3(0.3, 0, 3), 1.3],
  ['a mark, facing as it does', markAt(0.3, 3), 1.3],
  ['a mark, slowly', markAt(0.3, 3), 0.5],
] as const)('stands as it arrived after a walk to %s', (_, to, speed) => {
  const body = person({ dev: true }), h = insides(body);
  let ended = NaN, unsettled = 0, moved = 0;
  const feet: Vector3[] = [];
  play(function* () {
    yield* walkTo(body, to, { speed, accel: speed });
    ended = h.frame.time;
    feet.push(...h.stepper!.legs.map((leg) => leg.anchor.clone()));
  }, [body], 15, () => {
    if (Number.isNaN(ended)) return false;
    if (!body.settled) unsettled += 1;
    h.stepper!.legs.forEach((leg, i) => moved = Math.max(moved, leg.anchor.distanceTo(feet[i])));
    return h.frame.time > ended + 2;
  });
  expect(unsettled).toBe(0);
  expect(moved).toBeLessThan(0.005);
  expect(body.log).toEqual([]);
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
      yield* wait(arriving(body, 0.6));
      yield* mark('reach arriving')();
    });
    const grabbed = arriving(body, 0.1);
    yield* grab(body, near, { right: 'right' });
    yield* wait(() => h.locomotion.settled);
    release(body, near);
    yield* wait(0.1);
    // (the hands backing out — the body's own request — while what its stories moved has arrived: as settled as the body is)
    at.backing = h.requests.some((request) => request.owned) ? 1 : 0;
    at.unheld = grabbed() && h.locomotion.settled ? 1 : 0;
    yield* parallel('all', function* () {
      yield* grab(body, far, { left: 'left', right: 'right' });
      yield* mark('grabbed')();
    }, function* () {
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

// (people turn into their gaze: an about-turn goes round the side the head is turned to — recalled: Hollands et al. 2001, gaze and head
// lead a turn; exactly opposite, with the head ahead, it goes to the right)
it.each([[1, 'left'], [-1, 'right']] as const)('turns about round the side it looks to: %i, %s', (side, _name) => {
  const body = person({ dev: true }), h = insides(body);
  let turned = 0, done = false;
  play(function* () {
    yield* parallel('race', lookAt(body, new Vector3(side * 2, 1.6, -0.5)), function* () {
      yield* wait(1);
      yield* walkTo(body, new Vector3(), { face: Math.PI });
      done = true;
    });
  }, [body], 10, () => {
    if (h.frame.time > 1 && !turned && Math.abs(h.locomotion.facing) > 0.3) turned = Math.sign(h.locomotion.facing);
    return done;
  });
  expect(done).toBe(true);
  expect(turned).toBe(side);
  expect(body.log).toEqual([]);
});

// (a few steps back or aside, asked to face as it does, it keeps its facing — backing, side-stepping — slower than it walks: recalled,
// backward walking's self-selected pace ~60–70% of forward; further, it turns and walks)
it.each([
  ['back 1.3 m', new Vector3(0, 0, -1.3), true],
  ['aside 0.8 m', new Vector3(0.8, 0, 0), true],
  ['back 2 m', new Vector3(0, 0, -2), false],
] as const)('steps %s facing as it does: keeps its facing for a few steps, slower', (_, to, kept) => {
  const body = person({ dev: true }), h = insides(body);
  let arrived: boolean | undefined, turned = 0, fastest = 0;
  play(function* () { arrived = yield* walkTo(body, to, { face: 0 }); }, [body], 15, () => {
    turned = Math.max(turned, Math.abs(h.locomotion.facing));
    fastest = Math.max(fastest, h.locomotion.velocity.length());
    return arrived !== undefined;
  });
  expect(arrived).toBe(true);
  expect(body.position.distanceTo(to)).toBeLessThan(0.1);
  if (kept) {
    expect(turned).toBeLessThan(0.05);
    expect(fastest).toBeLessThan(0.9);
  } else expect(turned).toBeGreaterThan(Math.PI / 2);
  expect(body.log).toEqual([]);
});

it('throws on a pace that is none, and for a body its app drives', () => {
  const body = person();
  expect(() => walkTo(body, new Vector3(), { speed: 0 })).toThrow('no pace');
  const driven = person({ drive: () => ({ position: new Vector3(), velocity: new Vector3(), yaw: 0 }) });
  expect(() => play(function* () { yield* walkTo(driven, new Vector3(0, 0, 1)); }, [driven], 0.1)).toThrow('drives it');
});
