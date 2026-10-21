import { Box3, Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { expect, it } from 'vitest';
import { Body, createSkeletonModel, grab, hold, horse, Humanoid, idle, Item, place, Pose, walkTo, type Behaviour, type Frame, type Species } from '@drawcall/animate';
import { DOG } from '../src/scenarios/dog';

// Each verb on each body, off the demo cases: goals at angles round the body, near and far, items high and low. Every run must
// finish its story within its time, throw nothing and leave the dev log empty. The cases that do not yet are listed in `OPEN`
// (expected to fail: each one fixed comes off the list).
const OPEN = new Set([
  'a person takes a cup 0.05 m up, 0° off its facing', 'a person takes a cup 0.05 m up, 120° off its facing',
  'a person takes a cup 0.5 m up, 0° off its facing',
  ...[0.3, 0.5, 0.75].map((h) => `a person takes a box ${h} m up in both hands`),
  ...[0.3, 0.5, 0.8].map((h) => `a person puts a box down on a table ${h} m high`),
]);
const check = (name: string, test: () => void) => (OPEN.has(name) ? it.fails : it)(name, test);

/** runs `story` on `body` for at most `seconds`: whether it finished, and what went wrong */
function run(make: (story: (body: Body) => Behaviour) => Body, story: (body: Body) => Behaviour, seconds: number) {
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
  const body: Body = new Body(species, () => parallel<Frame>('all', idle(body), story(body)), { pose: start, dev: true });
  return body;
};
const person = (story: (body: Body) => Behaviour) => new Humanoid(createSkeletonModel(), (h) => () => parallel<Frame>('all', idle(h), story(h)), { dev: true });
const around = (degrees: number, distance: number, y = 0) => new Vector3(Math.sin(degrees * DEG) * distance, y, Math.cos(degrees * DEG) * distance);
const ok = { done: true, error: '', log: [] };

// (a body `size` times the dog's takes √size as long: dynamically similar gaits, at equal Froude numbers, last ∝ √length)
for (const [name, species, size] of [['dog', DOG, 1], ['horse', horse(), 2.5]] as const) {
  for (const angle of [0, 45, 90, 135, 180]) for (const distance of [1.5, 4]) {
    check(`a ${name} walks to a still goal ${angle}° off its facing, ${distance} body lengths away`, () =>
      expect(run(creature(species), (b) => walkTo(b, { to: around(angle, distance * size) }), 25 * Math.sqrt(size))).toEqual(ok));
  }
  check(`a ${name} walks round a circle`, () => {
    const points = Array.from({ length: 8 }, (_, k) => around(90 + k * 45, 2 * size).add(new Vector3(-2 * size, 0, 0)));
    expect(run(creature(species), (b) => function* () { for (const to of points) yield* walkTo(b, { to })(); }, 60 * Math.sqrt(size))).toEqual(ok);
  });
}

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
      yield* place(b as Humanoid, box, { position: around(90, 1.5, height + 0.1), quaternion: new Quaternion() })();
    }, 30)).toEqual(ok);
  });
}

// (a body asked for what it can never get to says so in the dev log, once, and stands where it is: no throw, nothing searched for it)
for (const [what, story] of [
  ['take a ball 1.5 m up, beyond its jaw', (b: Body) => grab(b, { jaw: [ballAt(around(0, 1, 1.5)), 'middle'] })],
  ['walk to a goal that is no point', (b: Body) => walkTo(b, { to: new Vector3(NaN, 0, 1) })],
] as const) {
  it(`a dog asked to ${what} logs it once and stands`, () => {
    const body = creature(DOG)(story), start = body.pose.position(0).clone();
    for (let i = 0; i < 10 * 60; i++) body.update(1 / 60);
    expect(body.log.length).toBe(1);
    expect(body.pose.position(0).distanceTo(start)).toBeLessThan(0.05);
  });
}

function ballAt(at: Vector3) {
  return new Item(at, new Quaternion(), { middle: { position: new Vector3() } }, { name: 'ball', mass: 0.06, bounds: new Box3(new Vector3(-0.04, -0.04, -0.04), new Vector3(0.04, 0.04, 0.04)) });
}
function boxAt(at: Vector3) {
  return new Item(at, new Quaternion(), { left: { position: new Vector3(0.15, 0, 0) }, right: { position: new Vector3(-0.15, 0, 0) } },
    { name: 'box', mass: 2, bounds: new Box3(new Vector3(-0.15, -0.1, -0.1), new Vector3(0.15, 0.1, 0.1)) });
}

const DEG = Math.PI / 180;
