import { Object3D, Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { describe, expect, it } from 'vitest';
import { attempt, Body, carry, dog, grab, horse, humanoid, lookAt, Missed, reach, release, wait } from '../../src/index';
import { species } from '../../src/species';
import { HORSE } from '../../skills/animate/references/horse';
import { now, person, play } from '../kit/bodies';
import { box, empty, roomOf, worldOf } from '../kit/things';
import { DOG } from '../../skills/animate/references/dog';
import { PERSON } from '../../skills/animate/references/person';

const BOTH = { left: 'left', right: 'right' } as const;

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

// (no stand brings it there: the try is the arm's reach as it comes, not as hasty as the true way is long)
describe('a try for what is out of reach', () => {
  it.each([
    ['1.72 m ahead', new Vector3(-.2, 1.2, 1.72), 'reach'],
    ['2.5 m ahead', new Vector3(-.2, 1.2, 2.5), 'reach'],
    ['1.72 m ahead', new Vector3(-.2, 1.2, 1.72), 'grab'],
  ] as const)('goes for what is %s no faster than a person does, the weight barely shifted: %s', (_, target, verb) => {
    const body = person({ dev: true }), room = roomOf(body), start = worldOf(body.bones.hips);
    const asked = verb === 'reach'
      ? reach(body, { right: target }, { step: false })
      : grab(body, box(room, target, { size: new Vector3(.1, .1, .1), mass: 1 }), { right: 'right' }, { step: false });
    let miss: Missed | null | undefined, last = worldOf(body.bones.rightHand), fastest = 0, travel = 0;
    play(function* () { miss = yield* attempt(asked); }, [body], 6, () => {
      const hand = worldOf(body.bones.rightHand), hips = worldOf(body.bones.hips);
      if (miss === undefined) fastest = Math.max(fastest, hand.distanceTo(last) * 60);
      travel = Math.max(travel, Math.hypot(hips.x - start.x, hips.z - start.z));
      last = hand;
      return miss !== undefined;
    });
    expect(miss).toBeInstanceOf(Missed);
    expect(fastest).toBeLessThan(1.7);
    expect(travel).toBeLessThan(.13);
  });
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

it('a reach out of it with its feet kept tries for the arm\'s time, then misses', () => {
  const body = person(), target = new Vector3(-.2, 1.15, .8), from = worldOf(body.bones.rightHand).distanceTo(target);
  let miss: Missed | null = null, took = NaN;
  play(function* () { miss = yield* attempt(reach(body, { right: target }, { step: false })); }, [body], 10, (time) => {
    if (miss) took = time;
    return miss !== null;
  });
  expect(miss).toBeInstanceOf(Missed);
  expect(miss).toMatchObject({ verb: 'reach', why: expect.stringContaining('beyond reach with the feet planted') });
  expect(took).toBeGreaterThan(0.4);
  expect(took).toBeLessThan(2);
  expect(worldOf(body.bones.rightHand).distanceTo(target)).toBeLessThan(from - 0.2);
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

// (a viewer sees the try: the same whether `until` was given or not, no hidden flag for it)
describe('what no stand reaches', () => {
  const tried = (asked: (body: Body, jar: Object3D) => Generator<unknown, unknown, unknown>) => {
    const body = person(), room = roomOf(body), jar = box(room, new Vector3(0, 2.6, 0.6), { solid: false, size: new Vector3(0.1, 0.2, 0.1) });
    let miss: Missed | null = null, top = 0, ended = NaN;
    play(function* () {
      miss = (yield* attempt(asked(body, jar) as Generator<never, unknown, unknown>)) as Missed | null;
      ended = now();
    }, [body], 6, () => {
      top = Math.max(top, worldOf(body.bones.rightHand).y);
      return !Number.isNaN(ended);
    });
    return { miss, top, ended };
  };

  it.each([
    ['a reach', (body: Body, jar: Object3D) => reach(body, { right: jar })],
    ['a reach given until', (body: Body, jar: Object3D) => reach(body, { right: jar }, { until: Infinity })],
    ['a grab', (body: Body, jar: Object3D) => grab(body, jar, { right: 'right' })],
    ['a grab given until', (body: Body, jar: Object3D) => grab(body, jar, { right: 'right' }, { until: Infinity })],
    ['a grab of two hands', (body: Body, jar: Object3D) => grab(body, jar, BOTH)],
  ])('%s: the arm goes as far as it can for its time, then it misses', (_name, asked) => {
    const { miss, top, ended } = tried(asked);
    expect(miss).toBeInstanceOf(Missed);
    expect(top).toBeGreaterThan(1.9);
    expect(ended).toBeGreaterThan(0.5);
    expect(ended).toBeLessThan(2);
  });

  it('a creature\'s: its hand goes for it too, before it misses', () => {
    const pet = new Body(dog(DOG)), jaw = worldOf(pet.bones.jaw), target = jaw.clone().add(new Vector3(0, 3, 0.2));
    let miss: Missed | null = null, ended = NaN, top = 0;
    play(function* () {
      miss = yield* attempt(reach(pet, { jaw: target }));
      ended = now();
    }, [pet], 6, () => {
      top = Math.max(top, worldOf(pet.bones.jaw).y);
      return !Number.isNaN(ended);
    });
    expect(miss).toBeInstanceOf(Missed);
    expect(ended).toBeGreaterThan(0.5);
    expect(top).toBeGreaterThan(jaw.y + 0.05);
  });
});

it('borrows no eyes for a place on its own head: the head stays, the hand gets there', () => {
  const body = person({ dev: true }), head = body.bones.head, spot = empty(head, 'spot', new Vector3(-0.25, 0.05, 0.1));
  const start = head.getWorldQuaternion(new Quaternion());
  let result: boolean | undefined, turned = 0;
  play(function* () { result = yield* reach(body, { right: spot }, { step: false }); }, [body], 6, () => {
    turned = Math.max(turned, head.getWorldQuaternion(new Quaternion()).angleTo(start));
    return result !== undefined;
  });
  expect(result).toBe(true);
  expect(turned).toBeLessThan(0.2);
  expect(body.log).toEqual([]);
});

it('says a point a function gives on its own head turned with the head as the eyes chased it, not that a joint held the arm off it', () => {
  const body = person({ dev: true, life: { seed: 3, steady: 1 } }), head = body.bones.head, spot = empty(head, 'spot', new Vector3(-0.25, 0.05, 0.1));
  let miss: unknown, done = false;
  play(function* () { miss = yield* attempt(reach(body, { right: () => spot.getWorldPosition(new Vector3()) }, { step: false })); done = true; }, [body], 6, () => done);
  expect(miss).toBeInstanceOf(Missed);
  expect((miss as Missed).message).toMatch(/turned with the head as the eyes turned it to look/);
  expect((miss as Missed).message).not.toMatch(/joint’s range/);
});

it('looks at a place on what hangs from its other hand, as a grab of it does: no look moves it; one on its chest it leaves be', () => {
  const looked = (on: (body: Body, held: Object3D) => Object3D, verb: 'reach' | 'grab') => {
    const body = person({ dev: true }), room = roomOf(body), held = box(room, new Vector3(0.2, 0.9, 0.42), { size: new Vector3(0.12, 0.12, 0.12), mass: 0.3 });
    empty(held, 'top', new Vector3(0, 0.06, 0));
    const spot = on(body, held);
    let looking = false, result: boolean | undefined;
    play(function* () {
      yield* grab(body, held, { left: 'top' }, { step: false });
      result = verb === 'reach' ? yield* reach(body, { right: spot }, { step: false }) : yield* grab(body, held, { right: spot.name }, { step: false });
    }, [body], 8, () => {
      looking ||= body.owners.look?.verb === verb;
      return result !== undefined;
    });
    expect(result).toBe(true);
    expect(body.log).toEqual([]);
    return looking;
  };
  const onHeld = (_body: Body, held: Object3D) => empty(held, 'side', new Vector3(-0.06, 0, 0));
  expect(looked(onHeld, 'reach')).toBe(true);
  expect(looked(onHeld, 'grab')).toBe(true);
  expect(looked((body) => empty(body.bones.chest, 'badge', new Vector3(-0.1, 0, 0.15)), 'reach')).toBe(false);
});
