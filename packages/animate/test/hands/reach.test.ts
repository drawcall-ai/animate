import { Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { expect, it } from 'vitest';
import { attempt, Body, carry, dog, grab, horse, humanoid, lookAt, Missed, reach, release, wait } from '../../src/index';
import { species } from '../../src/species';
import { HORSE } from '../../skills/animate/references/horse';
import { person, play } from '../kit/bodies';
import { empty, roomOf, worldOf } from '../kit/things';
import { DOG } from '../../skills/animate/references/dog';
import { PERSON } from '../../skills/animate/references/person';

// Trial 3's stationary neck: bent at rest, with no joint limits or walking roles.
const NECK = species([
  { name: 'trunk', position: [0, 1.35, 0] },
  { name: 'neck', parent: 'trunk', position: [0, 1.35, .55] },
  { name: 'head', parent: 'neck', position: [0, 1.70, 1.12] },
  { name: 'jaw', parent: 'head', position: [0, 1.30, 1.62] },
] as const, { hands: { jaw: ['neck', 'head', 'jaw'] } }, { masses: { trunk: 350, neck: 35, head: 15 } });

it.each([
  { target: new Vector3(0, .25, .75), met: true },
  { target: new Vector3(0, 1.35, 1.8), met: true },
  { target: new Vector3(0, 1.35, 3), met: false },
  { target: new Vector3(0, 3, .75), met: false },
])('a stationary chain reaches without borrowing legs, or misses: $target', ({ target, met }) => {
  const body = new Body(NECK, { dev: true });
  let miss: Missed | null | undefined, distance = Infinity, walked = false;
  play(function* () {
    miss = yield* attempt(reach(body, { jaw: target }));
    distance = worldOf(body.bones.jaw).distanceTo(target);
  }, [body], 10, () => {
    walked ||= body.owners.legs !== undefined;
    return miss !== undefined;
  });
  expect(miss === null).toBe(met);
  expect(walked).toBe(false);
  if (met) {
    expect(distance).toBeLessThan(.01);
    expect(body.log).toEqual([]);
  } else expect(distance).toBeGreaterThan(.01);
});

it('the reference horse lowers its jaw to the ground in front of its hooves', () => {
  const body = new Body(horse(HORSE), { dev: true });
  const target = new Vector3(0, 0, 1.1);
  let result: boolean | undefined, distance = Infinity, finished = false;
  play(function* () {
    result = yield* reach(body, { jaw: target });
    distance = worldOf(body.bones.jaw).distanceTo(target);
    yield* wait(1);
    finished = true;
  }, [body], 10, () => finished);
  expect(result).toBe(true);
  expect(distance).toBeLessThan(.01);
  expect(body.log).toEqual([]);
});

it('a person crouches to reach a point at a lying dog’s head height', () => {
  const body = person({ dev: true });
  const target = new Vector3(-.2, .3, .45);
  const standing = worldOf(body.bones.hips).y;
  let result: boolean | undefined, distance = Infinity, lowered = 0;
  play(function* () {
    result = yield* reach(body, { right: target });
    distance = worldOf(body.bones.rightHand).distanceTo(target);
    lowered = standing - worldOf(body.bones.hips).y;
  }, [body], 10, () => result !== undefined);
  expect(result).toBe(true);
  expect(distance).toBeLessThan(.01);
  expect(lowered).toBeGreaterThan(.2);
  expect(body.log).toEqual([]);
});

it('a child reaches a dog’s head while it looks up at the child', () => {
  const child = person({ dev: true, at: new Vector3(3, 0, 1), face: Math.PI }, 1.75 * .75);
  const pet = new Body(dog(DOG), { dev: true, at: new Vector3(3, 0, 0) });
  roomOf(child, pet);
  let result: boolean | undefined;
  play(function* () {
    yield* parallel('race', lookAt(pet, child.bones.head), function* () {
      yield* wait(3);
      result = yield* reach(child, { right: () => worldOf(pet.bones.head) });
    });
  }, [child, pet], 15, () => result !== undefined);
  expect(result, JSON.stringify(child.log)).toBe(true);
  expect([...child.log, ...pet.log]).toEqual([]);
});

// (a knee feedback off the actual shoulder squatted further while the bow still came, and stood back up with the bucket on the ground:
// the hand turned with the rising body, the bucket by its handle 11 mm off its place)
it('sets a low load down on its place', () => {
  const farmer = person({ dev: true, at: new Vector3(0, 0, 3), face: Math.PI });
  const room = roomOf(farmer);
  const bucket = empty(room, 'bucket', new Vector3(0, 0, 2.6));
  bucket.userData.mass = 2;
  empty(bucket, 'handle', new Vector3(0, .55, 0));
  const place = empty(room, 'ground', new Vector3(0, 0, 1.5));
  place.rotation.y = Math.PI;
  let finished = false;
  play(function* () {
    expect(yield* grab(farmer, bucket, { right: 'handle' })).toBe(true);
    expect(yield* carry(farmer, bucket, place)).toBe(true);
    // (a carry ends with the thing at rest within 5 mm of its end as it was a sub-step before, moving under 5 cm/s: read a sub-step on)
    expect(worldOf(bucket).distanceTo(worldOf(place))).toBeLessThan(.005 + .05 / 60);
    release(farmer, bucket, place);
    yield* wait(1);
    finished = true;
  }, [farmer], 15, () => finished);
  expect(finished).toBe(true);
  expect(bucket.parent).toBe(place);
  expect(farmer.log).toEqual([]);
});

it('does not borrow a driven creature’s legs for an unreachable point', () => {
  const pet = new Body(dog(DOG), { dev: true, drive: () => ({ position: new Vector3(), yaw: 0 }) });
  let miss: Missed | null | undefined, walked = false;
  play(function* () { miss = yield* attempt(reach(pet, { jaw: new Vector3(0, .5, 2) })); }, [pet], 10, () => {
    walked ||= pet.owners.legs !== undefined;
    return miss !== undefined;
  });
  expect(miss).toBeInstanceOf(Missed);
  expect(walked).toBe(false);
});

// (a body its app drives cannot walk up: its hand stops at arm's length, and the reach misses as soon as it comes no nearer)
it('fails a reach whose hand has stopped short at once, saying where it stopped and what held it', () => {
  const body = person({ dev: true, drive: () => ({ position: new Vector3(), yaw: 0 }) });
  let miss: Missed | null | undefined, ended = NaN, time = 0;
  play(function* () {
    miss = yield* attempt(reach(body, { right: new Vector3(-0.2, 1.3, 1.6) }));
    ended = time;
  }, [body], 8, (t) => {
    time = t;
    return miss !== undefined;
  });
  // (a calm reach that far takes about a second; failed 4 s past that before)
  expect(ended).toBeLessThan(2.5);
  expect(miss).toMatchObject({
    verb: 'reach', where: 'right',
    why: expect.stringMatching(/^stopped \d+\.\d cm off it \(\d+\.\d cm behind, .* in the body's frame\): beyond the arm’s reach: the shoulder 1\.\d\d m from it, the arm 0\.\d\d m$/),
  });
});

it('allows balance-support steps to finish a cross-body reach before judging it late', () => {
  const body = new Body(humanoid(PERSON), { dev: true });
  const results: boolean[] = [], errors: number[] = [];
  play(function* () {
    for (const target of [new Vector3(-.15, 1.15, .5), new Vector3(.4, 1.15, .3)]) {
      results.push(yield* reach(body, { right: target }));
      errors.push(worldOf(body.bones.rightHand).distanceTo(target));
    }
  }, [body], 10, () => results.length === 2);
  expect(results).toEqual([true, true]);
  expect(errors.every(distance => distance < .01)).toBe(true);
  expect(body.log).toEqual([]);
});

it.each([
  { ahead: .8, step: true, walks: true },
  { ahead: .66, step: false, walks: false },
])('a reach $ahead m ahead, step $step: there, walking up $walks', ({ ahead, step, walks }) => {
  const body = person({ dev: true }), target = new Vector3(-.2, 1.15, ahead), start = body.position;
  let result: boolean | undefined, moved = 0;
  play(function* () {
    result = yield* reach(body, { right: target }, { step });
  }, [body], 10, () => {
    moved = Math.max(moved, body.position.distanceTo(start));
    return result !== undefined;
  });
  expect(result).toBe(true);
  // (planted, the weight shifts toward the hand within the feet, a few centimetres; walking up, it stands ~0.2 m nearer and stays)
  expect(moved > .1).toBe(walks);
  expect(worldOf(body.bones.rightHand).distanceTo(target)).toBeLessThan(.011);
  expect(body.log).toEqual([]);
});

it('a reach out of it with its feet kept misses at once', () => {
  const body = person();
  let miss: Missed | null = null, took = NaN;
  play(function* () { miss = yield* attempt(reach(body, { right: new Vector3(-.2, 1.15, .8) }, { step: false })); }, [body], 10, (time) => {
    if (miss) took = time;
    return miss !== null;
  });
  expect(miss).toBeInstanceOf(Missed);
  expect(miss).toMatchObject({ verb: 'reach', why: expect.stringContaining('beyond reach with the feet planted') });
  expect(took).toBeLessThan(0.1);
});

it('grab and a creature reach keep the feet planted with step false, missing out of reach', () => {
  const farmer = person({ dev: true }), pet = new Body(dog(DOG), { dev: true, at: new Vector3(3, 0, 0) });
  const room = roomOf(farmer, pet);
  const bucket = empty(room, 'bucket', new Vector3(0, 0, 1.5));
  empty(bucket, 'handle', new Vector3(0, .55, 0));
  const misses: (Missed | null)[] = [];
  play(function* () {
    misses.push(yield* attempt(grab(farmer, bucket, { right: 'handle' }, { step: false })));
    misses.push(yield* attempt(reach(pet, { jaw: new Vector3(3, .5, 2) }, { step: false })));
  }, [farmer, pet], 5, () => misses.length === 2);
  expect(farmer.position.length()).toBeLessThan(.05);
  expect(pet.position.distanceTo(new Vector3(3, 0, 0))).toBeLessThan(.05);
  expect(misses).toEqual([
    expect.objectContaining({ verb: 'grab', why: expect.stringContaining('beyond reach with the feet planted') }),
    expect.objectContaining({ verb: 'reach', why: expect.stringContaining('out of reach with the feet planted') }),
  ]);
});

it('an empty parented to a body on a raised floor is read where the scene has it', () => {
  // the same reach on a floor 1 m up must play exactly as on the ground, 1 m higher (the body's object stands at the floor's height)
  const handAt = (floor: number) => {
    const body = person({ floor: () => floor });
    const target = empty(body.object, 'target', new Vector3(-0.2, 1.3, 0.35));
    play(function* () {
      // (this empty's turn is beyond the wrist, so given time the reach misses: where the hand got to is what is compared)
      yield* attempt(reach(body, { right: target }, { step: false, until: 2 }));
    }, [body], 2);
    body.object.updateMatrixWorld(true);
    return worldOf(body.bones.rightHand);
  };
  expect(handAt(1).distanceTo(handAt(0).add(new Vector3(0, 1, 0)))).toBeLessThan(0.005);
});

it('a dog reaches an object’s orientation as well as its position', () => {
  const pet = new Body(dog(DOG), { dev: true }), room = roomOf(pet);
  const target = empty(room, 'mouth target', worldOf(pet.bones.jaw));
  target.rotation.z = Math.PI;
  let result: boolean | undefined;
  let closest = Infinity;
  play(function* () { result = yield* reach(pet, { jaw: target }); }, [pet], 10, () => {
    closest = Math.min(closest, pet.bones.jaw.getWorldQuaternion(new Quaternion()).angleTo(target.getWorldQuaternion(new Quaternion())));
    return result !== undefined;
  });
  expect(result).toBe(true);
  expect(closest).toBeLessThan(0.05);
  expect(pet.log).toEqual([]);
});
