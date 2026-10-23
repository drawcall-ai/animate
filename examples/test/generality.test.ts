import { Box3, Quaternion, Vector3 } from 'three';
import { parallel, timePassed } from '@pmndrs/timeline';
import { expect, it } from 'vitest';
import { Body, withGaze, scaled, carried, carry, holds, offer, offered, touch, when, World, createSkeletonModel, grab, handTo, hold, horse, release, Humanoid, Item, INDEX, place, Pose, walkTo, type Behaviour, type Frame, type Species } from '@drawcall/animate';
import { DOG, SHORT_NECKED } from '../src/scenarios/dog';
import { cases } from '../../packages/animate/test/open';

// Each verb on each body, off the demo cases: goals at angles round the body, near and far, items high and low. Every run must
// finish its story within its time, throw nothing and leave the dev log empty. The cases that do not yet are listed in `OPEN`
// (expected to fail: each one fixed comes off the list).
// (on the core legs, the people's only legs since 2026-10-23: a box put down at hip height or below ends its carry's course late)
const check = cases([
  'a person puts a box down on a table 0.3 m high',
  'a person puts a box down on a table 0.5 m high',
  // (asked a goal 0.5 m behind it, facing on, the planner turns it round to walk there and back round — it never kept its facing — and
  // the Labrador's paws, 0.58 m apart fore to hind where the old dog's stood 0.46 m, turn it round slower than its stall check allows)
  'a dog walks 0.5 m back, keeping its facing',
  // (the cat — the Labrador scaled down — standing on all but straight forelegs, a planted fore paw falls out of its leg's reach once
  // on its eighth goal round the circle)
  'a cat walks round a circle',
  // (its life seed varied, the handover's dev log has problems)
  ['a person hands a bottle to another, who takes it and carries it off', [3]],
]);

/** runs `story` on `body` for at most `seconds`: whether it finished, and what went wrong */
function run<B extends Body>(make: (story: (body: B) => Behaviour) => B, story: (body: B) => Behaviour, seconds: number) {
  let done = false;
  const body = make((b) => function* () { yield* story(b)(); done = true; });
  let error = '';
  try {
    for (let i = 0; i < seconds * 60 && !done; i++) body.update(1 / 60);
  } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  return { done, error, log: body.log.map((e) => `${e.check} ${e.where} @${e.time.toFixed(2)}`).slice(0, 3) };
}

const creature = (species: Species) => (story: (body: Body) => Behaviour) => {
  const start = new Pose(species.skeleton);
  return new Body(species, story, { pose: start, dev: true });
};
const person = (story: (h: Humanoid) => Behaviour) => new Humanoid(createSkeletonModel(), story, { dev: true });
const around = (degrees: number, distance: number, y = 0) => new Vector3(Math.sin(degrees * DEG) * distance, y, Math.cos(degrees * DEG) * distance);
const ok = { done: true, error: '', log: [] };

// (a body `size` times the dog's takes √size as long: dynamically similar gaits, at equal Froude numbers, last ∝ √length)
// (a cat: the dog at 0.55 its size, its gait scaled with it as dynamically similar gaits are)
const CAT = scaled(DOG, 0.55);
for (const [name, species, size] of [['dog', DOG, 1], ['cat', CAT, 0.55], ['horse', horse(), 2.5]] as const) {
  for (const angle of [0, 45, 90, 135, 180]) for (const distance of [1.5, 4]) {
    check(`a ${name} walks to a still goal ${angle}° off its facing, ${distance} body lengths away`, () =>
      expect(run(creature(species), (b) => walkTo(b, { to: around(angle, distance * size) }), 25 * Math.sqrt(size))).toEqual(ok));
  }
  check(`a ${name} walks on to a still goal after a walk its until ended`, () => {
    expect(run(creature(species), (b) => function* () {
      yield* walkTo(b, { to: (f) => around(f.time * 20, 3 * size), until: timePassed(4, 'seconds') })();
      yield* walkTo(b, { to: around(-90, 2 * size) })();
    }, 40 * Math.sqrt(size))).toEqual(ok);
  });
  // (a walk after one its `until` ended, on a body run alone: it stops where it can, measured as its legs carry it)
  for (const [then, next] of [['comes to a stop', () => ({})], ['walks back to where it stood', (b: Body) => ({ to: b.pose.position(0).clone().setY(0) })]] as const) {
    for (const seconds of [0.5, 4]) check(`a ${name} ${then} after a walk its until ended at ${seconds} s`, () => {
      expect(run(creature(species), (b) => function* () {
        yield* walkTo(b, { to: around(0, 4 * size), until: timePassed(seconds, 'seconds') })();
        yield* walkTo(b, next(b))();
      }, 30)).toEqual(ok);
    });
  }
  check(`a ${name} goes once round a circle after a carrot, then stops`, () => {
    const R = 1.6 * size, centre = new Vector3(0, 0, R), angle = (p: Vector3) => Math.atan2(p.z - centre.z, p.x - centre.x);
    let swept = 0, last = angle(new Vector3());
    expect(run(creature(species), (b) => function* () {
      yield* walkTo(b, {
        to: () => { const a = angle(b.pose.position(0)) + 1.5 * size / R; return new Vector3(centre.x + R * Math.cos(a), 0, centre.z + R * Math.sin(a)); },
        until: () => {
          const a = angle(b.pose.position(0));
          swept += Math.atan2(Math.sin(a - last), Math.cos(a - last)); last = a;
          return swept >= 2 * Math.PI;
        },
      })();
      yield* walkTo(b, {})();
    }, 90)).toEqual(ok);
  });
  check(`a ${name} walks round a circle`, () => {
    const points = Array.from({ length: 8 }, (_, k) => around(90 + k * 45, 2 * size).add(new Vector3(-2 * size, 0, 0)));
    expect(run(creature(species), (b) => function* () { for (const to of points) yield* walkTo(b, { to })(); }, 60 * Math.sqrt(size))).toEqual(ok);
  });
}

check('a dog walks 0.5 m back, keeping its facing', () =>
  expect(run(creature(DOG), (b) => walkTo(b, { to: around(180, 0.5), face: 0 }), 10)).toEqual(ok));

for (const [angle, distance, height] of [[0, 2, 0.04], [90, 2, 0.04], [180, 2, 0.04], [45, 1, 0.01], [0, 2, 0.2]]) {
  check(`a dog takes a ball ${angle}° off its facing, ${distance} m away, ${height} m up, and holds it`, () => {
    const ball = ballAt(around(angle, distance, height));
    expect(run(creature(DOG), (b) => function* () {
      yield* grab(b, { jaw: [ball, 'middle'] })();
      yield* parallel<Frame>('race', hold(b, ball), walkTo(b, { to: around(angle + 180, 1) }));
    }, 25)).toEqual(ok);
  });
}

for (const angle of [0, 90, 180]) for (const distance of [1, 3]) {
  check(`a person walks to a still goal ${angle}° off its facing, ${distance} m away`, () =>
    expect(run(person, (b) => walkTo(b, { to: around(angle, distance) }), 20)).toEqual(ok));
}
for (const height of [0.05, 0.5, 0.8, 1.2, 1.6]) for (const angle of [0, 120]) {
  check(`a person takes a cup ${height} m up, ${angle}° off its facing`, () => {
    const cup = new Item(around(angle, 1.5, height), new Quaternion(), { handle: { position: new Vector3() } }, { name: 'cup', mass: 0.3 });
    expect(run(person, (b) => grab(b, { right: [cup, 'handle'] }), 20)).toEqual(ok);
  });
}
for (const height of [0.3, 0.5, 0.75, 0.8, 1.0, 1.2]) {
  check(`a person takes a box ${height} m up in both hands`, () => {
    const box = boxAt(around(0, 1.5, height));
    expect(run(person, (b) => grab(b, { left: [box, 'left'], right: [box, 'right'] }), 20)).toEqual(ok);
  });
}
for (const height of [0.3, 0.5, 0.8, 1.1]) {
  check(`a person puts a box down on a table ${height} m high`, () => {
    const box = boxAt(around(0, 1.2, 0.8));
    expect(run(person, (b) => function* () {
      yield* grab(b, { left: [box, 'left'], right: [box, 'right'] })();
      yield* place(b, box, { position: around(90, 1.5, height + 0.1), quaternion: new Quaternion() })();
    }, 30)).toEqual(ok);
  });
}

// (every hand verb takes any body: a dog's jaw carries, puts down, lets go and reaches as a person's hands do)
check('a dog takes a ball, carries it up to its rest, lets go, takes it again and puts it down 1 m off', () => {
  const ball = ballAt(around(0, 1.5, 0.04)), down = { position: around(90, 1, 0.04), quaternion: new Quaternion() };
  expect(run(creature(DOG), (b) => function* () {
    yield* grab(b, { jaw: [ball, 'middle'] })();
    yield* carry(b, ball, carried(b))();
    yield* release(b, ['jaw'])();
    yield* grab(b, { jaw: [ball, 'middle'] })();
    yield* place(b, ball, down)();
  }, 30)).toEqual(ok);
  expect(ball.current.position.distanceTo(down.position)).toBeLessThan(0.05);
});
check('a dog reaches its jaw to a point without taking anything', () => {
  expect(run(creature(DOG), (b) => handTo(b, 'jaw', { position: around(0, 0.5, 0.3) }, { until: 'reached' }), 10)).toEqual(ok);
});
// (a touch reaches without taking: a short-necked creature lets itself down and bows to a bowl on the floor, as a cat drinks)
check('a short-necked creature touches a bowl on the floor, letting itself down and bowing', () => {
  let lowest = Infinity;
  const body = creature(SHORT_NECKED)((b) => touch(b, 'jaw', around(10, 1.2, 0.03)));
  for (let i = 0; i < 10 * 60 && !body.done; i++) { body.update(1 / 60); lowest = Math.min(lowest, body.pose.position(0).y); }
  expect(body.done).toBe(true);
  expect(body.log).toEqual([]);
  expect(lowest).toBeLessThan(0.4);
});
for (const height of [0.1, 0.4, 1.2]) {
  check(`a person touches a point ${height} m up, 1.5 m away`, () => {
    expect(run(person, (b) => touch(b, 'right', around(10, 1.5, height)), 20)).toEqual(ok);
  });
}
check('a dog touches a point on the floor 1.5 m away', () => {
  expect(run(creature(DOG), (b) => touch(b, 'jaw', around(10, 1.5, 0.01)), 20)).toEqual(ok);
});
// (a hand-over: one story offers, the other takes; they meet on a condition, not on time)
check('a person hands a bottle to another, who takes it and carries it off', () => {
  const bottle = new Item(around(0, 1.2, 0.9), new Quaternion(), { bottom: { position: new Vector3(0, -0.08, 0) }, top: { position: new Vector3(0, 0.08, 0) } },
    { name: 'bottle', mass: 0.5, bounds: new Box3(new Vector3(-0.04, -0.12, -0.04), new Vector3(0.04, 0.12, 0.04)) });
  let offering = NaN, coming = NaN;
  const giver = new Humanoid(createSkeletonModel(), (h) => function* () {
    yield* grab(h, { right: [bottle, 'bottom'] })();
    yield* when(timePassed(1, 'seconds')); // it looks at it a while before it holds it out
    offering = h.frame.time;
    yield* offer(h, bottle, taker)();
  }, { dev: true });
  const taker: Humanoid = new Humanoid(createSkeletonModel(), (h) => function* () {
    yield* when(() => offered(giver, bottle)); // it comes for it once it is held out
    coming = h.frame.time;
    yield* grab(h, { right: [bottle, 'top'] })();
    yield* hold(h, bottle, { to: carried(h, 'right') })();
  }, { at: { x: 0, z: 3 }, yaw: Math.PI, dev: true });
  const world = new World().add(giver, taker);
  let error = '';
  try { for (let i = 0; i < 20 * 60 && !(giver.done && holds(taker, bottle) && !holds(giver, bottle)); i++) world.update(1 / 60); } catch (cause) { error = String(cause); }
  expect(error).toBe('');
  expect(giver.done).toBe(true);
  expect(holds(taker, bottle)).toBe(true);
  expect(coming).toBeGreaterThanOrEqual(offering);
  expect(offered(giver, bottle)).toBe(false);
  expect([...giver.log, ...taker.log]).toEqual([]);
});
// (the scene moves its own things before each sub-step, whatever frames the world is updated by: a person takes a ball off a sliding tray)
check('a person takes a ball off a tray the scene slides along, the world updated by uneven frames', () => {
  const at = (time: number) => new Vector3(0.3 * Math.sin(time * 0.8), 0.9, 1.2);
  const ball = ballAt(at(0));
  const body = new Humanoid(createSkeletonModel(), (h) => function* () {
    yield* grab(h, { right: [ball, 'middle'] })();
    yield* hold(h, ball, { to: carried(h, 'right') })();
  }, { dev: true });
  let taken = false;
  const world = new World().add(body).moving((time) => { if (!holds(body, ball)) ball.move(time, at(time)); else taken = true; });
  let error = '';
  try { for (let i = 0; i < 600 && !taken; i++) world.update([1 / 30, 1 / 45, 1 / 120, 1 / 60][i % 4]); } catch (cause) { error = String(cause); }
  expect(error).toBe('');
  expect(taken).toBe(true);
  expect(body.log).toEqual([]);
});
// (a goal in the head is held clear in front of it: noted, never silent)
it('a cup held to the mouth stops in front of the face, and the notes say so', () => {
  const cup = new Item(around(0, 0.6, 0.9), new Quaternion(), { handle: { position: new Vector3() } }, { name: 'cup', mass: 0.3 });
  const body = new Humanoid(createSkeletonModel(), (h) => function* () {
    yield* grab(h, { right: [cup, 'handle'] })();
    yield* hold(h, cup, { to: (f) => ({ position: f.prev.point(INDEX.head, new Vector3(0, -0.06, 0.08), new Vector3()) }), until: timePassed(2, 'seconds') })();
  }, { dev: { notes: true } });
  for (let i = 0; i < 15 * 60 && !body.done; i++) body.update(1 / 60);
  expect(body.done).toBe(true);
  expect(body.log).toEqual([]);
  expect(body.notes.map((note) => note.check)).toEqual(['held goal moved clear of the head (m)']);
});
it('a hand a body does not have fails to compile', () => {
  const ball = ballAt(around(0, 1.5, 0.04));
  const person = new Humanoid(createSkeletonModel(), (h) => function* () {
    // @ts-expect-error: a person's hands are left and right
    yield* grab(h, { rigth: [ball, 'middle'] })();
  });
  expect(person.hands).toHaveProperty('right');
});
it('a horse has no hands to take things with: grab fails to compile', () => {
  const ball = ballAt(around(0, 1.5, 0.04));
  const mare = new Body(horse(), (m) => function* () {
    // @ts-expect-error: a horse's species names no hands
    yield* grab(m, { jaw: [ball, 'middle'] })();
  }, { idle: false });
  expect(mare.hands).toEqual({});
});

// (a creature takes a verb's options as far as its hand can, and says at once which are a person's)
check('a dog holds a ball up to a point until told, bearing its weight', () => {
  const ball = ballAt(around(0, 1.5, 0.04));
  let carried = false;
  expect(run(creature(DOG), (b) => function* () {
    yield* grab(b, { jaw: [ball, 'middle'] })();
    yield* hold(b, ball, { to: { position: around(0, 0.6, 0.35) }, until: timePassed(2, 'seconds') })();
    carried = !ball.supported;
  }, 20)).toEqual(ok);
  expect(carried).toBe(true);
});
check('a dog follows a point on a moving cart with its jaw', () => {
  // (the point just ahead of where the jaw rests)
  const cart = new Item(new Vector3(0, 0.47, 0.52), new Quaternion(), {}, { name: 'cart' });
  const body = creature(DOG)((b) => handTo(b, 'jaw', { position: new Vector3(0, 0.05, 0) }, { on: cart, until: timePassed(3, 'seconds') }));
  for (let i = 0; i < 4 * 60 && !body.done; i++) {
    cart.move(body.frame.time + 1 / 60, new Vector3(0, 0.47, 0.52).add(new Vector3(0.1 * Math.sin(Math.min(i, 120) / 30), 0, 0)));
    body.update(1 / 60);
  }
  expect(body.done).toBe(true);
  expect(body.pose.position(body.hands.jaw).distanceTo(cart.toWorld({ position: new Vector3(0, 0.05, 0) }, { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() }).position)).toBeLessThan(0.05);
});
it("a person's options given a dog fail to compile", () => {
  const ball = ballAt(around(0, 1, 0.04));
  const dog = new Body(DOG, (b) => function* () {
    // @ts-expect-error: where to face as it takes hold is a person's
    yield* grab(b, { jaw: [ball, 'middle'] }, { face: 0 })();
    // @ts-expect-error: where the hands go off to is a person's
    yield* release(b, ['jaw'], { away: { jaw: new Vector3() } })();
    // @ts-expect-error: an elbow to bend toward is a person's
    yield* handTo(b, 'jaw', { position: new Vector3() }, { pole: new Vector3() })();
    // @ts-expect-error: a pace for a hand kept at rest is a person's (a creature's hand takes one bringing it `to` somewhere)
    yield* hold(b, ball, { motion: { accel: 1 } })();
    // @ts-expect-error: a creature carries one item at a time
    yield* carry(b, [[ball, [[1, { position: new Vector3() }]]]])();
  }, { idle: false });
  expect(dog.hands).toHaveProperty('jaw');
});
check('a horse leads with its eyes before a task without a neck chain', () => {
  expect(run(creature(horse()), (b) => withGaze(b, around(60, 3, 1), () => when(timePassed(0.5, 'seconds')), { first: true }), 10)).toEqual(ok);
});

// (a body asked for what it can never get to says so in the dev log, once, and stands where it is: no throw, nothing searched for it)
for (const [what, story] of [
  ['take a ball 1.5 m up, beyond its jaw', (b: Body) => grab(b, { jaw: [ballAt(around(0, 1, 1.5)), 'middle'] })],
  ['walk to a live goal that turns out no point', (b: Body) => walkTo(b, { to: () => new Vector3(NaN, 0, 1) })],
] as const) {
  it(`a dog asked to ${what} logs it once and stands`, () => {
    const body = creature(DOG)(story), start = body.pose.position(0).clone();
    for (let i = 0; i < 10 * 60; i++) body.update(1 / 60);
    expect(body.log.length).toBe(1);
    expect(body.pose.position(0).distanceTo(start)).toBeLessThan(0.05);
  });
}

// (a story that can never finish says so: a walk, approach or placement no nearer its goal for a while logs it once and goes on)
for (const [what, species, story] of [
  ['a dog asked to put a ball down under its own chest', DOG, (b: Body) => function* () {
    const ball = ballAt(around(0, 1.5, 0.04));
    yield* grab(b, { jaw: [ball, 'middle'] })();
    yield* place(b, ball, () => ({ position: b.pose.position(0).setY(0.04) }))();
  }],
  ['a dog asked to walk up to a goal that keeps ahead of it', DOG, (b: Body) => walkTo(b, { to: (f) => f.prev.position(0).add(new Vector3(0, 0, 1)) })],
] as const) {
  it(`${what} logs that it stalled`, () => {
    const result = run(creature(species), story, 30);
    expect(result.done).toBe(false);
    expect(result.log.length).toBe(1);
    expect(result.log[0]).toMatch(/^stalled walk/);
  });
}

// (a walk asked for what can be no walk throws at once, for any body: misuse, not lateness)
for (const [what, options] of [
  ['a goal that is no point', { to: new Vector3(NaN, 0, 1) }], ['a facing that is no angle', { face: NaN }], ['no acceleration', { to: new Vector3(0, 0, 1), accel: 0 }],
  ['a negative speed', { to: new Vector3(0, 0, 1), speed: -1 }], ['a speed that is no number', { to: new Vector3(0, 0, 1), speed: NaN }], ['a negative within', { to: new Vector3(0, 0, 1), within: -1 }],
] as const) {
  for (const [name, make] of [['dog', () => new Body(DOG, undefined, { idle: false })], ['person', () => new Humanoid(createSkeletonModel(), undefined, { idle: false })]] as const) {
    it(`a ${name} asked to walk with ${what} throws at once`, () => expect(() => walkTo(make(), options)).toThrow(/walkTo/));
  }
}
check('a person asked to walk to a live goal that turns out no point logs it once and stands', () => {
  const body = person((b) => walkTo(b, { to: () => new Vector3(NaN, 0, 1) })), start = body.pose.position(0).clone();
  for (let i = 0; i < 5 * 60; i++) body.update(1 / 60);
  expect(body.log.length).toBe(1);
  expect(body.pose.position(0).distanceTo(start)).toBeLessThan(0.05);
});

function ballAt(at: Vector3) {
  return new Item(at, new Quaternion(), { middle: { position: new Vector3() } }, { name: 'ball', mass: 0.06, bounds: new Box3(new Vector3(-0.04, -0.04, -0.04), new Vector3(0.04, 0.04, 0.04)) });
}
function boxAt(at: Vector3) {
  return new Item(at, new Quaternion(), { left: { position: new Vector3(0.15, 0, 0) }, right: { position: new Vector3(-0.15, 0, 0) } },
    { name: 'box', mass: 2, bounds: new Box3(new Vector3(-0.15, -0.1, -0.1), new Vector3(0.15, 0.1, 0.1)) });
}

const DEG = Math.PI / 180;
