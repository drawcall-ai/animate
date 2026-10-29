import { Group, Object3D, Vector3 } from 'three';
import { action, parallel, runTimeline, type NonReuseableTimeline } from '@pmndrs/timeline';
import { expect, it } from 'vitest';
import { Body, carry, dog, grab, horse, humanoid, lookAt, reach, release, wait, walkTo, type Species } from '@drawcall/animate';
import { selfOf } from '../../packages/animate/src/body/body';
import { cases } from '../../packages/animate/test/open';
import { DOG, HORSE, PERSON, scaled } from '../src/skeletons';
import { ball, box, cylinder, empty } from '../src/things';

// Each verb on each body, off the demo cases: goals at angles round the body, near and far, things high and low. Every run must
// finish its story within its time, throw nothing and leave the dev log empty. The cases that do not yet are listed open (expected
// to fail: each one fixed comes off the list).
const check = cases([
  // Turns instead of backing up.
  'a dog walks 0.5 m back, keeping its facing',
  // Placement ends 9 mm off its empty (5 mm limit).
  'a dog takes a ball, puts it down 1 m off, takes it again and puts it back',
]);

type Story = NonReuseableTimeline<unknown, unknown>;

/** a room holding `body`, its things put in it */
function roomWith(body: Body): Group {
  const room = new Group();
  room.add(body.object);
  return room;
}

/** runs `story` for at most `seconds` as an app runs one, a 1/60 s frame at a time: whether it finished, what it threw, its first problems */
function run(body: Body, story: () => Story, seconds: number) {
  let done = false, error = '';
  const step = runTimeline(function* () { yield* story(); done = true; });
  try {
    for (let i = 0; i < seconds * 60 && !done; i++) {
      step(undefined, 1 / 60);
      body.update(1 / 60);
    }
  } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  return { done, error, log: body.log.map((entry) => `${entry.check} ${entry.where} @${entry.time.toFixed(2)}`).slice(0, 3) };
}

const creature = <S extends Species>(species: S) => new Body(species, { dev: true });
const person = () => new Body(humanoid(PERSON), { dev: true });
const around = (degrees: number, distance: number, y = 0) => new Vector3(Math.sin(degrees * DEG) * distance, y, Math.cos(degrees * DEG) * distance);
const ok = { done: true, error: '', log: [] };

/** a ball of 6 cm across lying in `room` at `at`, taken as the jaw or hand comes */
function ballIn(room: Object3D, at: Vector3) {
  const thing = ball(room, 'ball', 0.04, at);
  thing.userData.mass = 0.06;
  return thing;
}
/** a cup of 0.3 kg standing in `room` at `at`, taken round its middle as the hand comes */
function cupIn(room: Object3D, at: Vector3) {
  const thing = cylinder(room, 'cup', 0.04, 0.1, at);
  thing.userData.mass = 0.3;
  return thing;
}
/** a 2 kg box in `room` at `at`, a grip on each side taken as the hands come: where the palms close, a hand's half-thickness out */
function boxIn(room: Object3D, at: Vector3) {
  const thing = box(room, 'box', new Vector3(0.3, 0.2, 0.2), at);
  thing.userData.mass = 2;
  empty(thing, 'left', new Vector3(0.165, 0, 0));
  empty(thing, 'right', new Vector3(-0.165, 0, 0));
  return thing;
}

// (a body `size` times the dog's takes √size as long: dynamically similar gaits, at equal Froude numbers, last ∝ √length)
// (a cat: the dog at 0.55 its size, its numbers made dynamically similar with it)
const CAT = dog(scaled(DOG, 0.55));
for (const [name, species, size] of [['dog', dog(DOG), 1], ['cat', CAT, 0.55], ['horse', horse(HORSE), 2.5]] as const) {
  for (const angle of [0, 45, 90, 135, 180]) for (const distance of [1.5, 4]) {
    check(`a ${name} walks to a still goal ${angle}° off its facing, ${distance} body lengths away`, () => {
      const body = creature(species);
      expect(run(body, () => walkTo(body, around(angle, distance * size)), 25 * Math.sqrt(size))).toEqual(ok);
    });
  }
  check(`a ${name} walks on to a still goal after a walk its until ended`, () => {
    const body = creature(species);
    expect(run(body, function* () {
      yield* walkTo(body, (time) => around(time * 20, 3 * size), { until: 4 });
      yield* walkTo(body, around(-90, 2 * size));
    }, 40 * Math.sqrt(size))).toEqual(ok);
  });
  // (a walk after one its `until` ended: it stops where it can, measured as its legs carry it)
  for (const seconds of [0.5, 4]) {
    check(`a ${name} comes to rest after a walk its until ended at ${seconds} s`, () => {
      const body = creature(species);
      expect(run(body, function* () {
        yield* walkTo(body, around(0, 4 * size), { until: seconds });
        yield* wait(() => body.settled);
      }, 30)).toEqual(ok);
    });
    check(`a ${name} walks back to where it stood after a walk its until ended at ${seconds} s`, () => {
      const body = creature(species), start = body.position;
      expect(run(body, function* () {
        yield* walkTo(body, around(0, 4 * size), { until: seconds });
        yield* walkTo(body, start);
      }, 30)).toEqual(ok);
    });
  }
  check(`a ${name} goes once round a circle after a carrot, then stops`, () => {
    const body = creature(species), radius = 1.6 * size, centre = new Vector3(0, 0, radius);
    const angleOf = (at: Vector3) => Math.atan2(at.z - centre.z, at.x - centre.x);
    let swept = 0, last = angleOf(new Vector3());
    const carrot = () => { const angle = angleOf(body.position) + 1.5 * size / radius; return new Vector3(centre.x + radius * Math.cos(angle), 0, centre.z + radius * Math.sin(angle)); };
    const round = () => {
      const angle = angleOf(body.position);
      swept += Math.atan2(Math.sin(angle - last), Math.cos(angle - last));
      last = angle;
      return swept >= 2 * Math.PI;
    };
    expect(run(body, function* () {
      yield* walkTo(body, carrot, { until: round });
      yield* wait(() => body.settled);
    }, 90)).toEqual(ok);
  });
  check(`a ${name} walks round a circle`, () => {
    const body = creature(species), points = Array.from({ length: 8 }, (_, k) => around(90 + k * 45, 2 * size).add(new Vector3(-2 * size, 0, 0)));
    expect(run(body, function* () { for (const point of points) yield* walkTo(body, point); }, 60 * Math.sqrt(size))).toEqual(ok);
  });
}

check('a dog walks 0.5 m back, keeping its facing', () => {
  const body = creature(dog(DOG));
  expect(run(body, () => walkTo(body, around(180, 0.5), { face: 0 }), 10)).toEqual(ok);
});

for (const [angle, distance, height] of [[0, 2, 0.04], [90, 2, 0.04], [180, 2, 0.04], [45, 1, 0.01], [0, 2, 0.2]]) {
  check(`a dog takes a ball ${angle}° off its facing, ${distance} m away, ${height} m up, and carries it off`, () => {
    const body = creature(dog(DOG)), toy = ballIn(roomWith(body), around(angle, distance, height));
    expect(run(body, function* () {
      yield* grab(body, toy, { jaw: 'ball' });
      yield* walkTo(body, around(angle + 180, 1));
    }, 25)).toEqual(ok);
    expect(body.holds(toy)).toBe(true);
  });
}

for (const angle of [0, 90, 180]) for (const distance of [1, 3]) {
  check(`a person walks to a still goal ${angle}° off its facing, ${distance} m away`, () => {
    const body = person();
    expect(run(body, () => walkTo(body, around(angle, distance)), 20)).toEqual(ok);
  });
}
for (const height of [0.05, 0.5, 0.8, 1.2, 1.6]) for (const angle of [0, 120]) {
  check(`a person takes a cup ${height} m up, ${angle}° off its facing`, () => {
    const body = person(), cup = cupIn(roomWith(body), around(angle, 1.5, height));
    expect(run(body, () => grab(body, cup, { right: 'cup' }), 20)).toEqual(ok);
  });
}
for (const height of [0.3, 0.5, 0.75, 0.8, 1.0, 1.2]) {
  check(`a person takes a box ${height} m up in both hands`, () => {
    const body = person(), parcel = boxIn(roomWith(body), around(0, 1.5, height));
    expect(run(body, () => grab(body, parcel, { left: 'left', right: 'right' }), 20)).toEqual(ok);
  });
}
for (const height of [0.3, 0.5, 0.8, 1.1]) {
  check(`a person puts a box down on a table ${height} m high`, () => {
    const body = person(), room = roomWith(body), parcel = boxIn(room, around(0, 1.2, 0.8));
    const table = empty(room, 'table top', around(90, 1.5, height + 0.1));
    expect(run(body, function* () {
      yield* grab(body, parcel, { left: 'left', right: 'right' });
      yield* carry(body, parcel, table);
      release(body, parcel, table);
    }, 30)).toEqual(ok);
    expect(parcel.parent).toBe(table);
  });
}

// (every hand verb takes any body: a dog's jaw carries, puts down, lets go and reaches as a person's hands do)
check('a dog takes a ball, puts it down 1 m off, takes it again and puts it back', () => {
  const body = creature(dog(DOG)), room = roomWith(body), toy = ballIn(room, around(0, 1.5, 0.04));
  const down = empty(room, 'down', around(90, 1, 0.04)), back = empty(room, 'back', around(0, 1.5, 0.04));
  expect(run(body, function* () {
    yield* grab(body, toy, { jaw: 'ball' });
    yield* carry(body, toy, down);
    release(body, toy, down);
    yield* grab(body, toy, { jaw: 'ball' });
    yield* carry(body, toy, back);
    release(body, toy, back);
  }, 40)).toEqual(ok);
  expect(toy.parent).toBe(back);
});
check('a dog carries a ball onto a step 0.3 m up, 2.5 m ahead', () => {
  const body = creature(dog(DOG)), room = roomWith(body), toy = ballIn(room, around(0, 1.5, 0.04)), step = empty(room, 'step', around(0, 2.5, 0.3));
  expect(run(body, function* () {
    yield* grab(body, toy, { jaw: 'ball' });
    yield* carry(body, toy, step);
    release(body, toy, step);
  }, 25)).toEqual(ok);
  expect(toy.parent).toBe(step);
});
check('a dog reaches its jaw to a point without taking anything', () => {
  const body = creature(dog(DOG));
  expect(run(body, () => reach(body, { jaw: around(0, 0.5, 0.3) }), 10)).toEqual(ok);
});
// (a reach takes nothing: a short-necked creature lets itself down and bows to a bowl on the floor, as a cat drinks)
check('a short-necked creature reaches a bowl on the floor, letting itself down and bowing', () => {
  const shortNecked = DOG.map((bone) => bone.name === 'head' ? { ...bone, position: [0, 0.53, 0.31] as const }
    : bone.name === 'jaw' ? { ...bone, position: [0, 0.48, 0.43] as const } : bone);
  const body = creature(dog(shortNecked));
  let lowest = Infinity;
  const result = run(body, function* () {
    yield* parallel('race', reach(body, { jaw: around(10, 1.2, 0.03) }), action({ update: () => void (lowest = Math.min(lowest, body.pose.position(0).y)) }));
  }, 10);
  expect(result).toEqual(ok);
  expect(lowest).toBeLessThan(0.4);
});
for (const height of [0.1, 0.4, 1.2]) {
  check(`a person reaches a point ${height} m up, 1.5 m away`, () => {
    const body = person();
    expect(run(body, () => reach(body, { right: around(10, 1.5, height) }), 20)).toEqual(ok);
  });
}
check('a dog reaches a point on the floor 1.5 m away', () => {
  const body = creature(dog(DOG));
  expect(run(body, () => reach(body, { jaw: around(10, 1.5, 0.01) }), 20)).toEqual(ok);
});
// (the scene moves its own things each frame, whatever frames the app updates by, and the body reads them eased across its sub-steps: a
// person takes a ball off a tray the scene slides along)
check('a person takes a ball the scene slides along, the frames uneven', () => {
  const at = (time: number) => new Vector3(0.3 * Math.sin(time * 0.8), 0.9, 1.2);
  const body = person(), toy = ballIn(roomWith(body), at(0));
  let time = 0, taken = false, error = '';
  const step = runTimeline(() => parallel('race',
    action({ update: (_, clock) => { time += clock.delta; if (!body.holds(toy)) toy.position.copy(at(time)); } }),
    function* () { taken = yield* grab(body, toy, { right: 'ball' }); },
  ));
  try {
    for (let i = 0; i < 600 && !taken; i++) {
      const frame = [1 / 30, 1 / 45, 1 / 120, 1 / 60][i % 4];
      step(undefined, frame);
      body.update(frame);
    }
  } catch (cause) { error = String(cause); }
  expect(error).toBe('');
  expect(taken).toBe(true);
  expect(body.log).toEqual([]);
});
// (a goal in the head is held clear in front of it: noted, never silent)
it('a cup carried to the mouth stops in front of the face, and the notes say so', () => {
  const body = new Body(humanoid(PERSON), { dev: { notes: true } }), cup = cupIn(roomWith(body), around(0, 0.6, 0.9));
  const mouth = empty(body.bones.head, 'mouth', new Vector3(0, -0.06, 0.08));
  expect(run(body, function* () {
    yield* grab(body, cup, { right: 'cup' });
    yield* carry(body, cup, mouth, { until: 2 });
  }, 15)).toEqual(ok);
  // (and that the grab walked up to the cup first)
  expect([...new Set(body.notes.map((note) => note.check))]).toEqual([
    'approach: walks up to stand in reach, staying there (m to walk; `step: false` keeps the feet)', 'held goal moved clear of the head (m)',
  ]);
});
it('a hand a body does not have fails to compile', () => {
  const body = person(), toy = ballIn(roomWith(body), around(0, 1.5, 0.04));
  // @ts-expect-error: a person's hands are left and right
  const asking = () => grab(body, toy, { rigth: 'ball' });
  expect(asking).toBeTypeOf('function');
});
it('a horse has a jaw but no human hands: grab rejects an absent hand', () => {
  const mare = new Body(horse(HORSE)), toy = ballIn(roomWith(mare), around(0, 1.5, 0.04));
  // @ts-expect-error: a horse has a jaw, not a right hand
  expect(run(mare, () => grab(mare, toy, { right: 'ball' }), 1).error).toMatch('no hand "right"');
});

// (a creature carries as far as its hand can)
check('a dog carries a ball up to a point until told, bearing its weight', () => {
  const body = creature(dog(DOG)), toy = ballIn(roomWith(body), around(0, 1.5, 0.04)), up = around(0, 0.6, 0.35);
  expect(run(body, function* () {
    yield* grab(body, toy, { jaw: 'ball' });
    yield* carry(body, toy, up, { until: 2 });
  }, 20)).toEqual(ok);
  expect([...selfOf(body).borne].some(([thing, { kg }]) => thing.object === toy && kg > 0.05)).toBe(true);
});
check('a dog follows a point on a moving cart with its jaw', () => {
  // (the point just ahead of where the jaw rests)
  const body = creature(dog(DOG)), cart = empty(roomWith(body), 'cart', new Vector3(0, 0.47, 0.52)), point = empty(cart, 'point', new Vector3(0, 0.05, 0));
  let time = 0;
  expect(run(body, () => parallel('race',
    action({ update: (_, clock) => { time += clock.delta; cart.position.x = 0.1 * Math.sin(Math.min(time, 2) * 2); } }),
    reach(body, { jaw: point }, { until: 3 }),
  ), 4)).toEqual(ok);
  expect(body.pose.position(body.pose.skeleton.index('jaw')).distanceTo(point.getWorldPosition(new Vector3()))).toBeLessThan(0.05);
});
check('a horse looks at a point without a neck chain', () => {
  const body = creature(horse(HORSE));
  expect(run(body, () => lookAt(body, around(60, 3, 1), { until: 0.5 }), 10)).toEqual(ok);
});

// (a body asked for what it can never get to says so in the dev log, once, and stands where it is: no throw, nothing searched for it)
it('a dog asked to take a ball 1.5 m up, beyond its jaw, logs it once and stands', () => {
  const body = creature(dog(DOG)), toy = ballIn(roomWith(body), around(0, 1, 1.5)), start = body.position;
  let taken: boolean | undefined;
  run(body, function* () { taken = yield* grab(body, toy, { jaw: 'ball' }); }, 10);
  expect(taken).toBe(false);
  expect(body.log.length).toBe(1);
  expect(body.position.distanceTo(start)).toBeLessThan(0.05);
});

it('a dog puts a ball down under its chest without an unnecessary approach', () => {
  const body = creature(dog(DOG)), toy = ballIn(roomWith(body), around(0, 1.5, 0.04));
  let outcome: boolean | undefined;
  expect(run(body, function* () {
    yield* grab(body, toy, { jaw: 'ball' });
    outcome = yield* carry(body, toy, () => body.position.setY(0.04));
  }, 30)).toEqual(ok);
  expect(outcome).toBe(true);
});

// (a walk no nearer its goal for a while logs it once and ends false)
it('a dog asked to walk up to a goal that keeps ahead of it logs that it stalled', () => {
  const body = creature(dog(DOG));
  let outcome: boolean | undefined;
  const result = run(body, function* () {
    outcome = yield* walkTo(body, () => body.position.add(new Vector3(0, 0, 1)));
  }, 30);
  expect(outcome).toBe(false);
  expect(result.log.length).toBe(1);
  expect(result.log[0]).toMatch(/^stalled walk/);
});

// (a walk asked for what can be no walk throws, for any body: misuse, not lateness — a facing at once, a goal that is no point as it is read)
for (const [name, make] of [['dog', () => creature(dog(DOG))], ['person', person]] as const) {
  it(`a ${name} asked to walk with a facing that is no angle throws at once`, () => {
    expect(() => walkTo(make(), new Vector3(0, 0, 1), { face: NaN })).toThrow(/walkTo/);
  });
  for (const [what, goal] of [['a goal', new Vector3(NaN, 0, 1)], ['a live goal', () => new Vector3(NaN, 0, 1)]] as const) {
    it(`a ${name} asked to walk to ${what} that is no point throws as it reads it`, () => {
      const body = make();
      expect(run(body, () => walkTo(body, goal), 1).error).toMatch(/no point/);
    });
  }
}

const DEG = Math.PI / 180;
