import { BoxGeometry, Mesh, Object3D, Quaternion, Vector3 } from 'three';
import { grip, attempt, Body, dog, grab, Missed, reach, release, wait } from '../../src/index';
import { describe, expect, it } from 'vitest';
import { cases } from '../kit/open';
import { runTimeline } from '@pmndrs/timeline';
import { DOG } from '../../skills/animate/references/dog';
import { run, INDEX, type Side, dt, readings, person, play, feetOf, gazeOff, type Readings } from '../kit/bodies';
import { box, empty, roomOf, worldOf, named } from '../kit/things';
import { handSpeeds } from '../kit/hands';

const BOTH = { left: 'left', right: 'right' } as const;

/** hand `side` in the hips' frame: where it is moved to, not carried along by the body */
const onHips = (h: Readings, side: Side) =>
  h.pose.position(INDEX[`${side}Hand`]).clone().sub(h.pose.position(INDEX.hips)).applyQuaternion(h.pose.rotation(INDEX.hips).clone().invert());

/**
 * a grab from where the body stands, set off after a second's standing, of grips alone (as the reference measured them: no mesh to go
 * round, no mass to lift): each hand's speed (m/s) at each frame from then, and how long until the hands closed (s)
 */
function reachFrom(at: Vector3, sides: readonly Side[] = ['right']): { speed: Record<Side, number[]>; took: number } {
  const body = person(), h = readings(body), room = roomOf(body);
  const thing = box(room, at, { mass: null, solid: false });
  let going = false, took = NaN;
  const hands = handSpeeds(h, () => going);
  play(function* () {
    yield* wait(1);
    going = true;
    yield* grab(body, thing, Object.fromEntries(sides.map((side) => [side, side])));
  }, [body], 4, (time) => {
    if (Number.isNaN(took) && body.holds(thing)) took = time - 1;
    hands.sample();
  });
  return { speed: hands.speed, took };
}

describe('grab, walking up', () => {
  const pickup = (variation: number) => `looks at a two-hand pickup at least a second before its last travelling touchdown (variation ${variation})`;
  // (XCoM past the feet for a sub-step or two, its bound 0.1 m: a facing turning fast brakes into the 50° it may stand off a planted foot, and the trunk jolts: to 0.126 m at these life seeds)
  const test = cases([[pickup(0), /XCoM/, [1]], [pickup(1), /XCoM/, [1, 3]]]);
  for (const variation of [0, 1, 2]) test(pickup(variation), () => {
    const body = person({ dev: true, at: new Vector3(1.5 + variation * 0.02, 0, 0), face: -0.1 }), h = readings(body), room = roomOf(body);
    const load = box(room, new Vector3(1.1, 0.88, 2), { size: new Vector3(0.44, 0.25, 0.3), mass: 8, turn: Math.PI / 2 });
    const feet = [0, 1].map(() => ({ phase: 'planted', from: new Vector3() }));
    let walking = false, stood = NaN, looking = NaN, touchdown = NaN, held = false;
    play(function* () {
      held = yield* grab(body, load, BOTH);
    }, [body], 10, (time) => {
      walking ||= h.velocity.length() > 0.5;
      // (judged until it stands: its eyes leave the load as its hands close on it)
      if (!Number.isNaN(stood)) return held;
      if (gazeOff(h.gazer, h.pose, worldOf(load)) >= 0.2) looking = NaN;
      else if (Number.isNaN(looking)) looking = time;
      const com = h.pose.com(new Vector3());
      feetOf(h).forEach((foot, s) => {
        const was = feet[s];
        if (foot.phase === 'swing' && was.phase !== 'swing') was.from.copy(com);
        if (foot.phase === 'planted' && was.phase === 'swing' && Math.hypot(com.x - was.from.x, com.z - was.from.z) > 0.1) touchdown = time;
        was.phase = foot.phase;
      });
      if (walking && h.velocity.length() < 0.05 && Number.isNaN(stood)) stood = time;
      return held;
    });
    expect(held).toBe(true);
    expect(stood).toBeGreaterThan(touchdown);
    // Derived acceptance bound, not a measured human threshold.
    expect(touchdown - looking).toBeGreaterThanOrEqual(1);
    expect(body.log).toEqual([]);
  });

  it('anticipates: the eyes and then the hands go to what it takes before the body has come up to it', () => {
    const body = person({ dev: true }), h = readings(body), room = roomOf(body);
    const load = box(room, new Vector3(0.1, 0.9, 2.2));
    const at = { eyes: NaN, hands: NaN, stood: NaN };
    const was = new Vector3();
    let held = false;
    play(function* () {
      held = yield* grab(body, load, BOTH);
    }, [body], 8, (time) => {
      if (Number.isNaN(at.eyes) && gazeOff(h.gazer, h.pose, worldOf(load)) < 0.2) at.eyes = time;
      const hand = onHips(h, 'right');
      if (Number.isNaN(at.hands) && time > 0.5 && hand.distanceTo(was) * 60 > 0.15) at.hands = time;
      was.copy(hand);
      if (Number.isNaN(at.stood) && time > 1 && h.velocity.length() < 0.05) at.stood = time;
      return held;
    });
    expect(held).toBe(true);
    expect(body.holds(load)).toBe(true);
    // (the eyes there, then the hands on their way, before the walk has come to a stop)
    expect(at.eyes).toBeLessThan(at.hands);
    expect(at.hands).toBeLessThan(at.stood);
    expect(body.log).toEqual([]);
  });

  it('comes down for what lies low as it plants its last step, not after standing still', () => {
    const body = person(), h = readings(body), room = roomOf(body);
    const load = box(room, new Vector3(0.1, 0.15, 2.2));
    const at = { arrived: NaN, down: NaN };
    const standing = h.pose.position(INDEX.hips).y;
    let walked = false, held = false;
    play(function* () {
      held = yield* grab(body, load, BOTH);
    }, [body], 8, (time) => {
      const speed = h.velocity.length();
      walked ||= speed > 0.3;
      if (walked && Number.isNaN(at.arrived) && speed < 0.05) at.arrived = time;
      if (Number.isNaN(at.down) && h.pose.position(INDEX.hips).y < standing - 0.1) at.down = time;
      return held;
    });
    expect(held).toBe(true);
    // (the hips 10 cm down within 0.3 s of coming to a stop, not waiting to stand still)
    expect(at.down - at.arrived).toBeLessThan(0.3);
  });

  it('lifts what lay loose clear of where it lay, and fails where no stand reaches the grips', () => {
    const body = person({ dev: true }), room = roomOf(body);
    const load = box(room, new Vector3(0, 0.9, 0.45));
    const high = box(room, new Vector3(0, 4, 0.45), { name: 'high' });
    let miss: Missed | null = null, took: boolean | undefined;
    play(function* () {
      miss = yield* attempt(grab(body, high, BOTH));
      took = yield* grab(body, load, BOTH);
    }, [body], 6, () => took !== undefined);
    expect(miss).toMatchObject({ verb: 'grab', why: expect.stringContaining('above the shoulders on tiptoe') });
    expect(took).toBe(true);
    expect(worldOf(load).y).toBeGreaterThan(0.9 + 0.02);
    expect(load.parent).not.toBe(room);
    expect(body.holds(load)).toBe(true);
    expect(body.log).toEqual([]);
  });
});

describe('grab, from where it stands', () => {
  it('takes as long as a reach that far takes (Fitts): longer for a farther grip', () => {
    expect(reachFrom(new Vector3(-0.1, 1.05, 0.5)).took).toBeGreaterThan(reachFrom(new Vector3(-0.05, 1.0, 0.3)).took);
  });


  it('faces the palm as its grip asks, on a body without finger bones too', () => {
    const body = person(), room = roomOf(body);
    const handle = box(room, new Vector3(-0.2, 1.0, 0.35), { mass: null, solid: false, name: 'handle' });
    const grip = named(handle, 'right');
    // (the palm facing in toward the body's middle, +X)
    grip.userData.facing = [1, 0, 0];
    room.updateMatrixWorld(true);
    let held = false;
    play(function* () {
      held = yield* grab(body, handle, { right: 'right' });
    }, [body], 3, () => held);
    expect(held).toBe(true);
    // (the T-pose's palm faces down, −Y, in the hand bone's turn from rest)
    const h = readings(body), turn = h.pose.rotation(h.hands.right);
    expect(new Vector3(0, -1, 0).applyQuaternion(turn).dot(new Vector3(1, 0, 0))).toBeGreaterThan(0.8);
  });


  it('leaves a thing with no mass, or one on a body, where it is: the hand follows it', () => {
    const body = person(), room = roomOf(body);
    const handle = box(room, new Vector3(-0.15, 1.0, 0.4), { mass: null, solid: false, name: 'handle' });
    const pouch = box(room, new Vector3(0, 0, 0), { mass: 0.5, solid: false, name: 'pouch' });
    body.bones.hips.add(pouch);
    pouch.position.set(-0.15, 0, 0.12);
    const parents = { handle: new Set<Object3D | null>(), pouch: new Set<Object3D | null>() };
    const held = { handle: false, pouch: false };
    let taking: 'handle' | 'pouch' | null = 'handle';
    play(function* () {
      held.handle = yield* grab(body, handle, { right: 'right' });
      release(body, handle);
      taking = 'pouch';
      held.pouch = yield* grab(body, pouch, { right: 'right' });
      taking = null;
    }, [body], 8, () => {
      if (taking) parents[taking].add(taking === 'handle' ? handle.parent : pouch.parent);
      return !taking;
    });
    expect(held).toEqual({ handle: true, pouch: true });
    expect([...parents.handle]).toEqual([room]);
    expect([...parents.pouch]).toEqual([body.bones.hips]);
  });
});

it('a reach takes an object\'s turn only as far as the wrist goes, and is there; `track` holds it exactly or says so', () => {
  const body = person(), room = roomOf(body);
  const handle = box(room, new Vector3(-0.2, 1, 0.35), { mass: null, solid: false });
  const grip = named(handle, 'right');
  grip.rotation.z = Math.PI;
  room.updateMatrixWorld(true);
  const at = grip.getWorldPosition(new Vector3());
  let done = false;
  play(function* () { yield* reach(body, { right: grip }); done = true; }, [body], 12, () => done);
  expect(done).toBe(true);
  expect(body.holds(handle)).toBe(false);
  expect(worldOf(body.bones.rightHand).distanceTo(at)).toBeLessThan(0.05);
  expect(body.bones.rightHand.getWorldQuaternion(new Quaternion()).angleTo(grip.getWorldQuaternion(new Quaternion()))).toBeGreaterThan(0.1);
});

// (the trial that asked for it: a bearer who had to be seen picking both medals up, 9 s of the beat, to start it holding them)
describe('grab already', () => {


  it.each([1 / 72, 1 / 120, 0])('counts an update of %f s, too short for a sub-step, as not having shown the body', (first) => {
    const body = person({ dev: true }), room = roomOf(body), thing = new Object3D();
    thing.position.set(-0.4, 1.1, 0.3);
    empty(thing, 'right', new Vector3());
    room.add(thing);
    room.updateMatrixWorld(true);
    let took: boolean | null = null;
    const step = runTimeline(function* () { took = yield* grab(body, thing, { right: 'right' }, { already: true }); });
    for (let k = 0; k < 12; k++) {
      const seconds = k === 0 ? first : dt;
      step(undefined, seconds);
      body.update(seconds);
    }
    expect(took).toBe(true);
  });

  it('misses for a grip out of reach of where the body stands; throws once the body has been shown, or for a creature', () => {
    const far = person({ dev: true }), room = roomOf(far);
    const thing = box(room, new Vector3(0, 1, 1.5), { mass: 0.5 });
    let miss: Missed | null = null;
    play(function* () { miss = yield* attempt(grab(far, thing, BOTH, { already: true })); }, [far], 0.5);
    expect(miss).toMatchObject({ verb: 'grab', why: expect.stringContaining('beyond the arm\'s reach') });
    const shown = person(), near = box(roomOf(shown), new Vector3(0, 1, 0.35), { mass: 0.5 });
    run(shown, 0.1);
    expect(() => play(function* () { yield* grab(shown, near, BOTH, { already: true }); }, [shown], 0.1)).toThrow('only as a body starts');
    const pup = new Body(dog(DOG));
    expect(() => grab(pup, near, { jaw: 'left' }, { already: true })).toThrow(/^grab already: for a person/);
    // (a speed is no way of saying it, and none goes with it)
    expect(() => grab(shown, near, BOTH, { speed: Infinity })).toThrow('grab: a speed of Infinity');
    expect(() => grab(shown, near, BOTH, { already: true, speed: 2 })).toThrow('give one or the other');
  });
});

it('refuses a reach onto a grip', () => {
  const body = person(), room = roomOf(body);
  const grip = named(box(room, new Vector3(-0.2, 1, 0.35), { mass: null, solid: false }), 'right');
  grip.userData.handle = [0, 1, 0];
  expect(() => reach(body, { right: grip })).toThrow(/reach: "right" has userData.handle, a grip/);
});

describe('grip', () => {
  it('adds a named empty that a grab takes, its spec its userData', () => {
    const body = person(), room = roomOf(body), rod = new Mesh(new BoxGeometry(0.03, 0.2, 0.03));
    rod.name = 'rod';
    rod.position.set(-0.2, 1, 0.3);
    rod.userData.mass = 0.2;
    room.add(rod);
    const handle = grip(rod, 'shaft', new Vector3(0, 0.02, 0), { handle: [0, 1, 0], radius: 0.015 });
    expect(handle).toBeInstanceOf(Object3D);
    expect(handle.parent).toBe(rod);
    expect(handle.userData).toEqual({ handle: [0, 1, 0], radius: 0.015 });
    expect(grip(rod, 'tip', [0, 0.1, 0]).position.y).toBe(0.1);
    let took: boolean | undefined;
    play(function* () { took = yield* grab(body, rod, { right: 'shaft' }); }, [body], 6, () => took !== undefined);
    expect(took).toBe(true);
    expect(body.holds(rod)).toBe(true);
  });
});
