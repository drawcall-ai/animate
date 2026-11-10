import { attempt, Missed, arriving, Body, dog, grab, lookAt, reach, release, wait, walkTo } from '../../src/index';
import { Object3D, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { expect, it } from 'vitest';
import { DOG } from '../../skills/animate/references/dog';
import { now, readings, person, play } from '../kit/bodies';
import { box, roomOf } from '../kit/things';

it('a grab waiting on the walk starts before the walk ends, without taking the legs from it', () => {
  const body = person({ dev: true }), h = readings(body), room = roomOf(body);
  const to = new Vector3(0, 0, 2);
  const load = box(room, new Vector3(-0.1, 0.9, 2.45), { solid: false });
  const at = { started: NaN, walked: NaN, held: NaN };
  const legs = new Set<string>();
  play(function* () {
    yield* parallel('all', function* () {
      yield* walkTo(body, to);
      at.walked = now();
    }, function* () {
      yield* wait(arriving(body, 0.6));
      at.started = now();
      yield* grab(body, load, { right: 'right' });
      at.held = now();
    });
  }, [body], 10, () => {
    if (Number.isNaN(at.walked) && body.owners.legs) legs.add(body.owners.legs.verb);
    return !Number.isNaN(at.held) && !Number.isNaN(at.walked);
  });
  expect(at.started).toBeLessThan(at.walked);
  // (asked, the walk keeps the legs while the grab would borrow them)
  expect([...legs]).toEqual(['walkTo']);
  expect(h.pose.com(new Vector3()).setY(0).distanceTo(to)).toBeLessThan(0.3);
  expect(body.log).toEqual([]);
});

it('arriving reads what the body begins to move toward once it is made: false till then, its walk while it walks, true once that ends', () => {
  const body = person();
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
      at.arriving = now();
    }, function* () {
      yield* walkTo(body, new Vector3(0, 0, 3));
      at.walked = now();
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
  const body = person({ dev: true });
  let ended = NaN, unsettled = 0, moved = 0;
  const feet: Vector3[] = [];
  play(function* () {
    yield* walkTo(body, to, { speed });
    ended = now();
    feet.push(...body.feet.map((foot) => foot.position));
  }, [body], 15, () => {
    if (Number.isNaN(ended)) return false;
    if (!body.settled) unsettled += 1;
    body.feet.forEach((foot, i) => moved = Math.max(moved, foot.position.distanceTo(feet[i])));
    return now() > ended + 2;
  });
  expect(unsettled).toBe(0);
  expect(moved).toBeLessThan(0.005);
  expect(body.log).toEqual([]);
});

it('arriving foresees every mover: a reach before its hands get there, a grab while it walks up; what the body does itself after a release holds it up not', () => {
  const body = person(), h = readings(body), room = roomOf(body);
  const near = box(room, new Vector3(-0.2, 1.1, 0.4), { mass: 1, solid: false, name: 'near' });
  const far = box(room, new Vector3(0.1, 0.9, 2.5), { mass: 1, solid: false, name: 'far' });
  const at: Record<string, number> = {};
  const mark = (name: string) => function* () { at[name] = now(); };
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
    yield* wait(() => h.settled);
    release(body, near);
    yield* wait(0.1);
    // (the hands backing out — the body's own request — while what its stories moved has arrived: as settled as the body is)
    at.backing = body.owners.hands.right ? 1 : 0;
    at.unheld = grabbed() && h.settled ? 1 : 0;
    yield* parallel('all', function* () {
      yield* grab(body, far, { left: 'left', right: 'right' });
      yield* mark('grabbed')();
    }, function* () {
      yield* wait(arriving(body, 0.6));
      yield* mark('grab arriving')();
      at.walking = body.settled ? 0 : 1;
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

// (an empty standing still is a goal standing still, as a point is: its velocity, known, is none)
it.each([
  ['as it comes', undefined],
  ['facing as asked', Math.PI / 2],
] as const)('a dog walks to an empty standing still and ends there, %s', (_, face) => {
  const body = new Body(dog(DOG), { dev: true }), mark = markAt(0.5, 3);
  roomOf(body).add(mark);
  let done: boolean | undefined;
  play(function* () { done = yield* walkTo(body, mark, face === undefined ? {} : { face }); }, [body], 15, () => done !== undefined);
  expect(done).toBe(true);
  expect(body.position.setY(0).distanceTo(mark.position)).toBeLessThan(0.5);
  expect(body.log).toEqual([]);
});

// (one it followed as it rolled, ended on arriving once it lay still, it is at: walked to again, it is there, and the walk ends)
it('a dog following a ball that rolls to a stop, ended on arriving, is there: walked to again, it ends at once', () => {
  const body = new Body(dog(DOG)), ball = markAt(0, 2);
  roomOf(body).add(ball);
  let followed: boolean | undefined, ended = NaN, again = NaN;
  play(function* () {
    followed = yield* walkTo(body, ball, { until: arriving(body, 0.3) });
    ended = now();
    yield* walkTo(body, ball);
    again = now();
  }, [body], 20, (time) => {
    ball.position.x = Math.min(time, 2);
    return !Number.isNaN(again);
  });
  expect(followed).toBe(true);
  expect(body.position.setY(0).distanceTo(ball.position)).toBeLessThan(0.5);
  expect(again - ended).toBeLessThan(2);
});

it('a dog keeps to an empty at a person\'s heel at a run and stands by it, and one held slower than its target says so', () => {
  const leader = person({ dev: true }), rex = new Body(dog(DOG), { dev: true, at: new Vector3(-0.6, 0, 0) });
  roomOf(leader, rex);
  const heel = new Object3D();
  heel.position.set(-0.6, 0, 0);
  leader.object.add(heel);
  let ended = false;
  play(function* () {
    yield* parallel('race', function* () { yield* walkTo(leader, new Vector3(0, 0, 12), { face: 0 }); yield* wait(9); }, walkTo(rex, heel, { speed: 1.7, until: Infinity }));
    ended = true;
  }, [leader, rex], 40, () => ended);
  expect(ended).toBe(true);
  expect(rex.position.setY(0).distanceTo(heel.getWorldPosition(new Vector3()).setY(0))).toBeLessThan(0.2);
  const slow = person({ dev: true }), runner = new Object3D();
  roomOf(slow).add(runner);
  let done: boolean | undefined;
  play(function* () { done = yield* walkTo(slow, runner, { speed: 1, until: 6 }); }, [slow], 7, (time) => {
    runner.position.z = time * 2.5;
    return done !== undefined;
  });
  expect(done).toBe(false);
  expect(slow.log.map((row) => row.check)).toContain('walk cannot keep up with its target (m/s)');
});

// (people turn into their gaze: an about-turn goes round the side the head is turned to — recalled: Hollands et al. 2001, gaze and head
// lead a turn; exactly opposite, with the head ahead, it goes to the right)
it.each([[1, 'left'], [-1, 'right']] as const)('turns about round the side it looks to: %i, %s', (side, _name) => {
  const body = person({ dev: true }), h = readings(body);
  let turned = 0, done = false;
  play(function* () {
    yield* parallel('race', lookAt(body, new Vector3(side * 2, 1.6, -0.5)), function* () {
      yield* wait(1);
      yield* walkTo(body, new Vector3(), { face: Math.PI });
      done = true;
    });
  }, [body], 10, () => {
    if (now() > 1 && !turned && Math.abs(h.facing) > 0.3) turned = Math.sign(h.facing);
    return done;
  });
  expect(done).toBe(true);
  expect(turned).toBe(side);
  expect(body.log).toEqual([]);
});


it('throws on a pace that is none, and for a body its app drives', () => {
  const body = person();
  expect(() => walkTo(body, new Vector3(), { speed: 0 })).toThrow('walkTo: a speed of 0');
  const driven = person({ drive: () => ({ position: new Vector3(), velocity: new Vector3(), yaw: 0 }) });
  expect(() => play(function* () { yield* walkTo(driven, new Vector3(0, 0, 1)); }, [driven], 0.1)).toThrow('drives it');
});

it('a walk given until misses once it stalls short of a goal standing still', () => {
  // (a dog before a wall 1.5 m high: it can get no nearer the point beyond)
  const body = new Body(dog(DOG), { dev: true, floor: (_x, z) => (z > 1 ? 1.5 : 0) });
  let miss: Missed | null | undefined;
  const ended = play(function* () { miss = yield* attempt(walkTo(body, new Vector3(0, 0, 2), { until: 20 })); }, [body], 25, () => miss !== undefined);
  expect(miss).toMatchObject({ verb: 'walkTo', why: expect.stringContaining('no nearer') });
  expect(ended).toBeLessThan(15);
});

it('`arriving` counts down to a walk\'s end, its feet squared: half a second before that, the body has stopped on its mark', () => {
  const body = person();
  let speed = Infinity, off = Infinity, ended = false;
  play(function* () {
    yield* walkTo(body, new Vector3(0, 0, 2.5), { until: arriving(body, 0.5) });
    speed = body.velocity.length();
    off = Math.abs(body.position.z - 2.5);
    ended = true;
  }, [body], 10, () => ended);
  expect(speed).toBeLessThan(0.3);
  expect(off).toBeLessThan(0.15);
});
