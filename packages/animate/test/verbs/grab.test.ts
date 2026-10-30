import { Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Body, dog, grab, humanoid, reach, release, wait } from '../../src/index';
import { CHEWBACCA } from '../skeletons/chewbacca';
import { DOG } from '../../skills/animate/references/dog';
import { run } from '../bodies';
import { INDEX, type Side } from '../../src/species/humanoid/bones';
import type { Person } from '../../src/body/person';
import { insides, palmAt, person, play, feetOf, gazeOff } from '../bodies';
import { box, roomOf, worldOf, named } from '../things';
import { handSpeeds } from '../hands';

const BOTH = { left: 'left', right: 'right' } as const;

/** hand `side` in the hips' frame: where it is moved to, not carried along by the body */
const onHips = (h: Person, side: Side) =>
  h.pose.position(INDEX[`${side}Hand`]).clone().sub(h.pose.position(INDEX.hips)).applyQuaternion(h.pose.rotation(INDEX.hips).clone().invert());

/**
 * a grab from where the body stands, set off after a second's standing, of grips alone (as the reference measured them: no mesh to go
 * round, no mass to lift): each hand's speed (m/s) at each frame from then, and how long until the hands closed (s)
 */
function reachFrom(at: Vector3, sides: readonly Side[] = ['right']): { speed: Record<Side, number[]>; took: number } {
  const body = person(), h = insides(body), room = roomOf(body);
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

/** when a hand has gone `distance` (s) */
const gone = (speed: number[], distance: number) => {
  let path = 0;
  return speed.findIndex((v) => (path += v / 60) > distance) / 60;
};

describe('grab, walking up', () => {
  it.each([0, 1, 2])('looks at a two-hand pickup at least a second before its last travelling touchdown (variation %i)', (variation) => {
    const body = person({ dev: true, at: new Vector3(1.5 + variation * 0.02, 0, 0), face: -0.1 }), h = insides(body), room = roomOf(body);
    const load = box(room, new Vector3(1.1, 0.88, 2), { size: new Vector3(0.44, 0.25, 0.3), mass: 8, turn: Math.PI / 2 });
    const feet = [0, 1].map(() => ({ phase: 'planted', from: new Vector3() }));
    let walking = false, stood = NaN, looking = NaN, touchdown = NaN, held = false;
    play(function* () {
      held = yield* grab(body, load, BOTH);
    }, [body], 10, (time) => {
      walking ||= h.locomotion.velocity.length() > 0.5;
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
      if (walking && !h.locomotion.moving && Number.isNaN(stood)) stood = time;
      return held;
    });
    expect(held).toBe(true);
    expect(stood).toBeGreaterThan(touchdown);
    // Derived acceptance bound, not a measured human threshold.
    expect(touchdown - looking).toBeGreaterThanOrEqual(1);
    expect(body.log).toEqual([]);
  });

  it('anticipates: the eyes and then the hands go to what it takes before the body has come up to it', () => {
    const body = person({ dev: true }), h = insides(body), room = roomOf(body);
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
      if (Number.isNaN(at.stood) && time > 1 && h.locomotion.velocity.length() < 0.05) at.stood = time;
      return held;
    });
    expect(held).toBe(true);
    expect(h.holding.right?.thing.object).toBe(load);
    // (the eyes there, then the hands on their way, before the walk has come to a stop)
    expect(at.eyes).toBeLessThan(at.hands);
    expect(at.hands).toBeLessThan(at.stood);
    expect(body.log).toEqual([]);
  });

  it('comes down for what lies low as it plants its last step, not after standing still', () => {
    const body = person(), h = insides(body), room = roomOf(body);
    const load = box(room, new Vector3(0.1, 0.15, 2.2));
    const at = { arrived: NaN, down: NaN };
    const standing = h.pose.position(INDEX.hips).y;
    let walked = false, held = false;
    play(function* () {
      held = yield* grab(body, load, BOTH);
    }, [body], 8, (time) => {
      const speed = h.locomotion.velocity.length();
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
    const outcomes: boolean[] = [];
    play(function* () {
      outcomes.push(yield* grab(body, high, BOTH));
      outcomes.push(yield* grab(body, load, BOTH));
    }, [body], 6, () => outcomes.length === 2);
    expect(outcomes).toEqual([false, true]);
    expect(worldOf(load).y).toBeGreaterThan(0.9 + 0.02);
    expect(load.parent).not.toBe(room);
    expect(body.holds(load)).toBe(true);
    expect(body.log.map(({ check }) => check)).toEqual(['approach: grip above the shoulders on tiptoe (m)']);
  });
});

describe('grab, from where it stands', () => {
  it('takes as long as a reach that far takes (Fitts): longer for a farther grip', () => {
    expect(reachFrom(new Vector3(-0.1, 1.05, 0.5)).took).toBeGreaterThan(reachFrom(new Vector3(-0.05, 1.0, 0.3)).took);
  });

  it('sets off toward the grip at once: the hand never first draws back from it', () => {
    for (const at of [new Vector3(-0.1, 1.0, 0.45), new Vector3(-0.15, 0.3, 0.5), new Vector3(-0.3, 1.4, 0.3)]) {
      const body = person(), h = insides(body), room = roomOf(body);
      const thing = box(room, at, { mass: null, solid: false });
      const grip = named(thing, 'right');
      const off: number[] = [];
      play(function* () {
        yield* wait(1);
        yield* grab(body, thing, { right: 'right' });
      }, [body], 2.5, (time) => {
        if (time > 1 + 1e-9) off.push(palmAt(h, 'right').distanceTo(worldOf(grip)));
      });
      // (the first 0.3 s: never further off than it set off from)
      expect(Math.max(...off.slice(0, 18)) - off[0]).toBeLessThan(0.001);
    }
  });

  it('two hands reaching together are not mirror images: the left sets off a moment after the right', () => {
    const { speed } = reachFrom(new Vector3(0, 1.0, 0.45), ['left', 'right']);
    // (10 cm on its way 40–150 ms after the right)
    const lag = gone(speed.left, 0.1) - gone(speed.right, 0.1);
    expect(lag).toBeGreaterThanOrEqual(0.04);
    expect(lag).toBeLessThanOrEqual(0.15);
  });

  it("turns the hand as its grip is turned, the hand bone's axes on the empty's", () => {
    const body = person(), room = roomOf(body);
    const handle = box(room, new Vector3(-0.2, 1.0, 0.35), { mass: null, solid: false, name: 'handle' });
    const grip = named(handle, 'right');
    // (turned as the hand hangs, then a quarter turn more about its forearm: a hand that must turn to take it)
    grip.userData.handTurn = true;
    grip.quaternion.copy(body.bones.rightHand.getWorldQuaternion(new Quaternion())).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.8));
    room.updateMatrixWorld(true);
    let held = false;
    play(function* () {
      held = yield* grab(body, handle, { right: 'right' });
    }, [body], 3, () => held);
    expect(held).toBe(true);
    room.updateMatrixWorld(true);
    expect(body.bones.rightHand.getWorldQuaternion(new Quaternion()).angleTo(grip.getWorldQuaternion(new Quaternion()))).toBeLessThan(0.05);
  });

  it('takes a grip on a turned thing, the palm on it', () => {
    const body = person(), h = insides(body), room = roomOf(body);
    const thing = box(room, new Vector3(-0.15, 1.0, 0.4), { turn: 0.6 });
    let held = false;
    play(function* () {
      held = yield* grab(body, thing, { right: 'right' });
    }, [body], 3, () => held);
    expect(held).toBe(true);
    const grip = named(thing, 'right');
    expect(palmAt(h, 'right').distanceTo(worldOf(grip))).toBeLessThan(0.03);
    expect(h.holding.right?.grip).toBe('right');
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

for (const verb of ['grab', 'reach'] as const) it(`${verb} fails an unreachable hand turn and reports its angular error`, () => {
  for (const dev of [false, true]) {
    const body = person({ dev }), room = roomOf(body);
    const handle = box(room, new Vector3(-0.2, 1, 0.35), { mass: null, solid: false });
    const grip = named(handle, 'right');
    grip.userData.handTurn = true;
    grip.rotation.z = Math.PI;
    let result: boolean | undefined;
    play(function* () {
      result = yield* (verb === 'grab' ? grab(body, handle, { right: 'right' }) : reach(body, { right: grip }));
    }, [body], 12, () => result !== undefined);
    expect(result).toBe(false);
    expect(body.holds(handle)).toBe(false);
    const angles = body.log.filter(({ check }) => check.startsWith('late reach: angle'));
    expect(angles).toHaveLength(dev ? 1 : 0);
    if (dev) expect(angles[0].value).toBeGreaterThan(angles[0].limit);
    expect(body.log.filter(({ check }) => check.startsWith('late reach: distance'))).toEqual([]);
  }
});

// (the trial that asked for it: a bearer who had to be seen picking both medals up, 9 s of the beat, to start it holding them)
describe('grab at once (speed: Infinity)', () => {
  const BODIES: [string, () => Body][] = [['the default person', () => person({ dev: true })], ['a 2.3 m skeleton', () => new Body(humanoid(CHEWBACCA), { dev: true })]];

  it.each(BODIES)('starts the body holding a cushion before it in both hands, as if it always had: %s', (_name, make) => {
    const body = make(), room = roomOf(body), scale = body.species.scale;
    // (where the arms hold it out before the chest, as far as they are long: the tall skeleton's are short for its height)
    const arm = body.species.person?.armLength ?? 0, at = new Vector3(0, (body.species.person?.shoulderHeight ?? 0) - 0.6 * arm, 0.55 * arm);
    const cushion = box(room, at, { size: new Vector3(0.36, 0.06, 0.24).multiplyScalar(scale), mass: 0.5, name: 'cushion' });
    let took: boolean | null = null, first = NaN, fastest = 0, last: Vector3 | null = null;
    play(function* () {
      took = yield* grab(body, cushion, BOTH, { speed: Infinity });
      yield* wait(3);
    }, [body], 3, (time) => {
      if (Number.isNaN(first) && body.holds(cushion)) first = time;
      const hand = worldOf(body.bones.rightHand);
      if (last) fastest = Math.max(fastest, hand.distanceTo(last) * 60);
      last = hand;
    });
    expect(took).toBe(true);
    expect(first).toBeCloseTo(1 / 60, 6);
    // (the hands as still as standing holds them: no reach, no jump onto the grips)
    expect(fastest).toBeLessThan(0.05);
    expect(worldOf(cushion).distanceTo(at)).toBeLessThan(0.02 * scale);
    expect(palmAt(insides(body), 'left').distanceTo(worldOf(named(cushion, 'left')))).toBeLessThan(0.02);
    expect(body.log).toEqual([]);
  });

  it('fails, saying so, for a grip out of reach of where the body stands; throws once the body has been shown, or for a creature', () => {
    const far = person({ dev: true }), room = roomOf(far);
    const thing = box(room, new Vector3(0, 1, 1.5), { mass: 0.5 });
    let took: boolean | null = null;
    play(function* () { took = yield* grab(far, thing, BOTH, { speed: Infinity }); }, [far], 0.5);
    expect(took).toBe(false);
    expect(far.log).toEqual(expect.arrayContaining([expect.objectContaining({ check: 'grab at once: a grip beyond the arm’s reach from where the body stands (m short)' })]));
    const shown = person(), near = box(roomOf(shown), new Vector3(0, 1, 0.35), { mass: 0.5 });
    run(shown, 0.1);
    expect(() => play(function* () { yield* grab(shown, near, BOTH, { speed: Infinity }); }, [shown], 0.1)).toThrow('only as a body starts');
    const pup = new Body(dog(DOG));
    expect(() => grab(pup, near, { jaw: 'left' }, { speed: Infinity })).toThrow('a person’s');
  });
});
