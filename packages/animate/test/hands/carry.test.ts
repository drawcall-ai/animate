import { parallel } from '@pmndrs/timeline';
import { Body, dog, arriving, attempt, carry, grab, grip, humanoid, lookAt, Missed, release, sit, stand, wait, reach, walkTo } from '../../src/index';
import { DOG } from '../../skills/animate/references/dog';
import { BoxGeometry, Group, Mesh, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { NATIVE } from '../kit/skeletons/native';
import { readings, person, play } from '../kit/bodies';
import { box, empty, roomOf, worldOf } from '../kit/things';

const BOTH = { left: 'left', right: 'right' } as const;

describe('carry', () => {




  // (the trial that found it: a bearer who walks a medal to the princess; `arriving` said he was all but there while he lifted it, 1.9 m
  // off, and her grab went for a medal still on its way)
  // (a tall body of the default build: the 2.3 m skeleton's walk carrying this box breaches its XCoM by 2 mm at some life seeds, a legs
  // matter this does not test)
  it.each([['the default person', () => person({ dev: true })], ['a 2.1 m person', () => person({ dev: true }, 2.1)]])(
    'is not arriving while it still has to walk the thing there: %s', (_name, make) => {
      const body = make(), room = roomOf(body), scale = body.species.scale;
      const load = box(room, new Vector3(-0.15, 1, 0.4).multiplyScalar(scale), { size: new Vector3(0.08, 0.08, 0.08), mass: 0.15 });
      const there = empty(room, 'there', new Vector3(0, 1, 2.2).multiplyScalar(scale));
      const near = arriving(body, 0.6);
      let carrying = false, carried = false, far = 0;
      play(function* () {
        yield* grab(body, load, { right: 'right' });
        carrying = true;
        carried = yield* carry(body, load, there);
      }, [body], 15, () => {
        if (carrying && !carried && near()) far = Math.max(far, worldOf(load).distanceTo(worldOf(there)));
        return carried;
      });
      expect(carried).toBe(true);
      // (arriving within 0.6 s, as the walk ends and the raise begins: the thing within about a stride of its place, not across the room)
      expect(far).toBeLessThan(0.8 * scale);
      expect(body.log).toEqual([]);
    });

  // (the trial that found it: a princess standing on a kneeling hero hung a medal at his neck, inside her own trunk; the carry said true
  // with the medal 36 cm off his neck)
  // (at this life seed the body stands near enough that the arms do come to the far end)
  it('misses, saying why, when the thing is not in place: its own body in the way, or its arms short of the end, `until` or not', () => {
    const outcome = (end: Vector3, until?: () => boolean) => {
      // (a life seed of its own: where the arms end, against the 1.5 cm a carry forgives, moves a few millimetres with the idle stance)
      const body = person({ dev: true, life: { seed: 8 } }), room = roomOf(body);
      const load = box(room, new Vector3(0, 1, 0.4), { mass: 1, solid: false });
      let miss: Missed | null | undefined;
      play(function* () {
        yield* grab(body, load, BOTH);
        miss = yield* attempt(carry(body, load, end, { step: false, until }));
      }, [body], 10, () => miss !== undefined);
      return { miss, off: worldOf(load).distanceTo(end), held: body.holds(load) };
    };
    // (before the face: held clear in front of it, at rest there)
    const inside = outcome(new Vector3(0, 1.45, 0.05));
    expect(inside.miss).toMatchObject({ verb: 'carry', why: expect.stringContaining('stands too near it') });
    expect(inside.off).toBeGreaterThan(0.1);
    expect(inside.held).toBe(true);
    // (out ahead at the chin, past where the planted feet let the arms come: within the planning's reach, not quite the arms'. Held in
    // the palms, the box's middle goes a palm further than the wrists: at the chest's height the arms now place it wherever the
    // planning lets them try)
    const far = outcome(new Vector3(0, 1.3, 0.76));
    expect(far.miss).toMatchObject({ why: expect.stringContaining('beyond the arm’s reach') });
    expect(far.off).toBeGreaterThan(0.01);
    // (given a condition that never comes, it still misses: else it held the thing short of its end for ever)
    expect(outcome(new Vector3(0, 1.3, 0.76), () => false).miss).toBeInstanceOf(Missed);
  });

  // (a target on the body given as an object or by a function: either way the carry ends with the thing there and turned, and keeps it so)
  for (const kind of ['an object', 'a function'] as const) it(`turns what one hand holds as a turned empty on the body asks, given as ${kind}`, () => {
    const body = person({ dev: true }), room = roomOf(body);
    const ball = box(room, new Vector3(-0.2, 1.1, 0.35), { size: new Vector3(0.06, 0.06, 0.06), mass: 0.4 });
    Object.assign(empty(ball, 'grip', new Vector3()).userData, { handle: [0, 1, 0], facing: [0, 0, -1], radius: 0.03 });
    const place = empty(body.object, 'ready', new Vector3());
    place.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), -2.2);
    const ready = () => {
      place.position.copy(body.object.worldToLocal(body.armPoint('right', new Vector3(0.18, 0.08, 0.98), 0.85)));
      place.updateMatrixWorld();
      return place;
    };
    const off = () => ball.getWorldQuaternion(new Quaternion()).angleTo(place.getWorldQuaternion(new Quaternion()));
    const outcomes: boolean[] = [];
    let ended = Infinity;
    play(function* () {
      outcomes.push(yield* grab(body, ball, { right: 'grip' }));
      outcomes.push(yield* carry(body, ball, kind === 'an object' ? ready() : () => ready(), { step: false }));
      ended = off();
    }, [body], 6, () => void ready());
    expect(outcomes).toEqual([true, true]);
    expect(ended).toBeLessThan(0.06);
    expect(off()).toBeLessThan(0.06);
  });
});

describe('release', () => {
  it('leaves what a body in no scene lifted under what it was lifted from, not riding the body', () => {
    const body = person(), table = new Group(), load = box(table, new Vector3(0, 1, 0.42), { solid: false, name: 'load' });
    let left = new Vector3();
    play(function* () {
      yield* grab(body, load, BOTH);
      release(body, load);
      left = worldOf(load);
      yield* walkTo(body, new Vector3(0, 0, -3));
    }, [body], 10);
    expect(load.parent).toBe(table);
    expect(worldOf(load).distanceTo(left)).toBeLessThan(1e-6);
  });

  it('leaves a fixed rail where it is as one of the hands on it lets go', () => {
    const body = person({ dev: true }), room = roomOf(body), rail = new Group();
    rail.position.set(0, 1, 0.35);
    room.add(rail);
    for (const [name, x] of [['left', 0.2], ['right', -0.2]] as const) Object.assign(empty(rail, name, new Vector3(x, 0, 0)).userData, { handle: [1, 0, 0], radius: 0.02 });
    room.updateMatrixWorld(true);
    play(function* () {
      yield* grab(body, rail, BOTH, { already: true });
      yield* wait(0.5);
      release(body, { left: rail });
    }, [body], 1);
    expect(rail.parent).toBe(room);
    expect(body.holds(rail)).toBe(true);
  });

  it('seats what a carry brought so that a release onto its target at once has nothing to say', () => {
    const body = new Body(humanoid(NATIVE), { at: new Vector3(0.98, 0, -1.5), face: Math.atan2(-0.98, -0.15), dev: true, life: { seed: 1, steady: 1 } }), room = roomOf(body);
    const home = empty(room, 'home', new Vector3(0.62, 0.79, -1.31)), load = new Mesh(new BoxGeometry(0.04, 0.02, 0.04).translate(0, 0.01, 0));
    load.userData.mass = 0.2;
    home.add(load);
    empty(load, 'top', new Vector3(0, 0.0292, 0));
    const place = empty(room, 'place', new Vector3(0.54, 0.79, -1.45));
    room.updateMatrixWorld(true);
    let carried = false;
    play(function* () {
      yield* grab(body, load, { left: 'top' }, { step: false });
      carried = yield* carry(body, load, place, { step: false });
      release(body, load, place);
    }, [body], 20, () => carried);
    expect(carried).toBe(true);
    expect(body.log).toEqual([]);
  });


  it('follows through: a hand let go of something moving carries on its way, then off it', () => {
    const body = person(), h = readings(body), room = roomOf(body);
    const load = box(room, new Vector3(0, 1.0, 0.4), { mass: 1, solid: false });
    const at = { let: new Vector3(), after: new Vector3() };
    let done = false;
    play(function* () {
      yield* grab(body, load, { right: 'right' });
      // (swept to the right, let go of halfway)
      yield* carry(body, load, new Vector3(-0.35, 1.0, 0.4), { until: 0.4 });
      at.let.copy(h.pose.position(h.hands.right));
      release(body, load);
      yield* wait(0.4);
      at.after.copy(h.pose.position(h.hands.right));
      done = true;
    }, [body], 6, () => done);
    expect(done).toBe(true);
    // (0.4 s after letting go, well on to the right, where it was carrying the box: not just coasting to a stop)
    expect(at.let.x - at.after.x).toBeGreaterThan(0.04);
    expect(body.holds(load)).toBe(false);
  });


  it('puts a thing back where it was taken from, or onto an empty, exactly there', () => {
    const body = person({ dev: true }), room = roomOf(body);
    const taken = new Vector3(0, 0.9, 0.45);
    const load = box(room, taken, { mass: 1, solid: false });
    const slot = empty(room, 'slot', new Vector3(0.1, 0.9, 0.45));
    const steps: string[] = [];
    play(function* () {
      yield* grab(body, load, BOTH);
      yield* carry(body, load, taken);
      release(body, load);
      steps.push(load.parent === room ? 'home' : 'elsewhere');
      yield* grab(body, load, BOTH);
      yield* carry(body, load, slot);
      release(body, load, slot);
      steps.push(load.parent === slot ? `onto ${load.position.length()}` : 'off');
    }, [body], 10, () => steps.length === 2);
    expect(steps).toEqual(['home', 'onto 0']);
    expect(body.log).toEqual([]);
  });

  it('throws when a thing is put onto an empty already taken, misses one far off it, and lets one go in mid-air without a word', () => {
    const body = person(), room = roomOf(body);
    const load = box(room, new Vector3(0, 0.9, 0.45), { mass: 1, solid: false });
    const other = box(room, new Vector3(1, 0.9, 1), { name: 'other', mass: 1, solid: false });
    const far = empty(room, 'far', new Vector3(1, 0.9, 1)), farther = empty(room, 'farther', new Vector3(-1, 0.9, 1));
    far.attach(other);
    let done = false;
    play(function* () {
      yield* grab(body, load, BOTH);
      yield* carry(body, load, new Vector3(0, 1.1, 0.4));
      expect(() => release(body, load, far)).toThrow('"far" holds another thing already');
      // (the release stands: only its saying so is a throw)
      expect(body.holds(load)).toBe(true);
      expect(() => release(body, load, farther)).toThrow(Missed);
      expect(body.holds(load)).toBe(false);
      done = true;
    }, [body], 8, () => done);
    expect(load.parent).toBe(farther);
    // (carried up off where it was taken and let go there: nothing under it)
    const loose = box(room, new Vector3(0.2, 0.9, 0.45), { name: 'loose', mass: 1, solid: false });
    done = false;
    play(function* () {
      yield* grab(body, loose, BOTH);
      yield* carry(body, loose, new Vector3(0.2, 1.1, 0.4));
      release(body, loose);
      done = true;
    }, [body], 8, () => done);
    expect(body.log).toEqual([]);
  });
});

it.each(['reach', 'grab', 'carry'] as const)('uses creature %s pace in its motion', (verb) => {
  const after = (speed: number) => {
    const body = new Body(dog(DOG)), room = roomOf(body);
    const load = box(room, new Vector3(0, 0.4, 0.48), { mass: 0.1, solid: false });
    if (verb === 'carry') {
      play(function* () { yield* grab(body, load, { jaw: 'left' }); }, [body], 6);
      expect(body.holds(load)).toBe(true);
    }
    play(function* () {
      if (verb === 'reach') yield* reach(body, { jaw: new Vector3(0, 0.4, 0.48) }, { speed });
      else if (verb === 'grab') yield* grab(body, load, { jaw: 'left' }, { speed });
      else yield* carry(body, load, new Vector3(0, 0.4, 0.48), { speed });
    }, [body], 0.3);
    return body.bones.jaw.getWorldPosition(new Vector3());
  };
  expect(after(0.2)).not.toEqual(after(0.8));
});

it('lifts an attached item when a creature starts carrying it', () => {
  const body = new Body(dog(DOG)), room = roomOf(body);
  const load = box(room, new Vector3(0, 0.4, 0.48), { mass: 0.1, solid: false });
  body.bones.trunk.attach(load);
  let finished = false;
  play(function* () {
    if (!(yield* grab(body, load, { jaw: 'left' }))) throw new Error('fixture grab failed');
    expect(load.parent).toBe(body.bones.trunk);
    yield* carry(body, load, new Vector3(0, 0.45, 0.5), { until: 0.2 });
    finished = true;
  }, [body], 12, () => finished);
  expect(finished).toBe(true);
  expect(load.parent).toBe(body.bones.jaw);
});

// (the trial that found it: sat, sipped, lowered to the lap, stood: the turn it was left in is one the arm cannot hold at the body's carrying
// place, and the carry waited on that place for ever, the walk done and the raise never begun)
it('walks on with what the arm cannot hold at its carrying place, and ends', () => {
  const body = person(), room = roomOf(body), cup = empty(room, 'cup', new Vector3(-0.28, 0.95, 0.25));
  cup.userData.mass = 0.3;
  grip(cup, 'handle', new Vector3(-0.06, 0, 0), { handle: [0, 1, 0], facing: [1, 0, 0], radius: 0.012 });
  const seat = empty(room, 'seat', new Vector3(0, 0.45, 3)), spot = empty(room, 'spot', new Vector3(0.5, 0.5, 3)), bird = empty(room, 'bird', new Vector3(-1, 1.8, 1.5));
  seat.rotation.y = Math.PI;
  const tilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.9), head = body.species.person!.head, lips = empty(body.bones.head, 'lips', new Vector3(0, head.nose.y - 0.03, head.nose.z + 0.12).sub(new Vector3(0, 0.05, 0.04).applyQuaternion(tilt)));
  lips.quaternion.copy(tilt);
  let carried: boolean | null = null;
  play(function* () {
    yield* grab(body, cup, { right: 'handle' }, { already: true });
    yield* carry(body, cup, () => body.armPoint('right', new Vector3(0, -0.5, 1).normalize(), 0.6));
    yield* sit(body, seat);
    yield* parallel('all', lookAt(body, bird, { until: 4 }), carry(body, cup, lips));
    yield* carry(body, cup, () => body.armPoint('right', new Vector3(0.2, -0.7, 1).normalize(), 0.6));
    yield* stand(body);
    carried = yield* carry(body, cup, spot);
  }, [body], 30, () => carried !== null);
  expect(carried).toBe(true);
});

describe('set down low', () => {
  // (from a stand with its knees let down as far as they need to, its bow capped by what it holds; a grab of the same place had always reached it)
  it.each<[number, number, number]>([[2, 0.3, 0.45], [2, 0.2, 0.45], [2, 0.05, 0.45], [8, 0.3, 1.5], [8, 0.05, 1.5], [5, 0.3, 3], [12, 0.3, 0.6], [25, 0.5, 3]])('%f kg in both hands to %f m up, %f m ahead', (mass, y, z) => {
    const body = person(), room = roomOf(body), load = box(room, new Vector3(0, 1, 0.4), { mass, solid: false }), spot = empty(room, 'spot', new Vector3(0, y, z));
    let carried: boolean | null = null;
    play(function* () {
      yield* grab(body, load, BOTH);
      carried = yield* carry(body, load, spot);
    }, [body], 20);
    expect(carried).toBe(true);
  });

  // (its hips as low as what it holds has them come level with its top: it stands clear of them, not as near as a shallow bow would have it)
  it.each<[number, number]>([[15, 3], [12, 0.7], [20, 3], [20, 0.7]])('a box as high as the crouched hips, %f kg to 0.15 m up, %f m ahead', (mass, z) => {
    const body = person(), room = roomOf(body), load = box(room, new Vector3(0, 1, 0.42), { mass, size: new Vector3(0.3, 0.2, 0.25) });
    let carried: boolean | null = null;
    play(function* () {
      yield* grab(body, load, BOTH);
      carried = yield* carry(body, load, new Vector3(0, 0.15, z));
    }, [body], 20);
    expect(carried).toBe(true);
  });
});

describe('a thing in both hands', () => {
  // (a bail in the right hand, a side in the left, as a story might come to hold them: it is the same hold however it got there)
  it.each<[string, readonly ('right' | 'left' | 'both')[]]>([
    ['both at once', ['both']],
    ['right, then left', ['right', 'left']],
    ['left, then right', ['left', 'right']],
    ['right, then both', ['right', 'both']],
  ])('is turned as its target is, taken %s', (_name, order) => {
    const body = person(), room = roomOf(body), bucket = empty(room, 'bucket', new Vector3(0, 0.7, 0.4));
    bucket.userData.mass = 8;
    grip(bucket, 'bail', new Vector3(0, 0.25, 0), { handle: [1, 0, 0], radius: 0.015 });
    grip(bucket, 'side', new Vector3(0.14, 0.05, 0), { facing: [-1, 0, 0] });
    const pour = empty(room, 'pour', new Vector3(0, 0.92, 0.32));
    pour.rotation.x = 0.85;
    let carried: boolean | null = null, off = Infinity;
    const grips = { right: { right: 'bail' }, left: { left: 'side' }, both: { left: 'side', right: 'bail' } } as const;
    play(function* () {
      for (const each of order) yield* grab(body, bucket, grips[each], { step: false });
      carried = yield* carry(body, bucket, pour, { step: false });
      off = bucket.getWorldQuaternion(new Quaternion()).angleTo(pour.getWorldQuaternion(new Quaternion()));
    }, [body], 12);
    expect(carried).toBe(true);
    expect(off).toBeLessThan(0.06);
  });

  it('takes a second hand on what a carry keeps in the first, the carry going on', () => {
    const body = person(), room = roomOf(body), bucket = empty(room, 'bucket', new Vector3(0, 0.7, 0.4));
    bucket.userData.mass = 8;
    grip(bucket, 'bail', new Vector3(0, 0.25, 0), { handle: [1, 0, 0], radius: 0.015 });
    grip(bucket, 'side', new Vector3(0.14, 0.05, 0), { facing: [-1, 0, 0] });
    const ready = empty(room, 'ready', new Vector3(0, 0.95, 0.33));
    let held = false;
    play(function* () {
      yield* grab(body, bucket, { right: 'bail' }, { step: false });
      yield* carry(body, bucket, ready, { step: false });
      yield* parallel('race', carry(body, bucket, ready, { until: Infinity, step: false }), grab(body, bucket, { left: 'side' }, { step: false }));
      yield* wait(0.5);
      held = body.holds(bucket);
    }, [body], 12);
    expect(held).toBe(true);
  });

  // (a hand-over's taker holds it by grips the other way round from the body's own axes)
  it('walked to a point keeps each hand on its own side, keeping its turn from the body', () => {
    const body = person({ dev: true }), room = roomOf(body);
    const load = box(room, new Vector3(0, 1, 0.4), { turn: Math.PI, solid: false });
    let most = -Infinity, carried: boolean | null = null, walking = false;
    play(function* () {
      yield* grab(body, load, { left: 'right', right: 'left' });
      walking = true;
      carried = yield* carry(body, load, new Vector3(0, 1.05, 3));
    }, [body], 15, () => {
      // (how far the left hand is on the body's right of the right hand)
      if (walking) most = Math.max(most, worldOf(body.bones.rightHand).sub(worldOf(body.bones.leftHand)).x);
      return carried !== null;
    });
    expect(carried).toBe(true);
    expect(most).toBeLessThan(0);
    expect(load.getWorldQuaternion(new Quaternion()).angleTo(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI))).toBeLessThan(0.1);
    expect(body.log).toEqual([]);
  });

  // (the trial that found it: a sign read off the grips' sides flipped the walk's turn on 1 mm: −9° with the arms crossed 23 cm, or 169°)
  it.each([0, 0.001, -0.001])('grips fore and aft, %f off the line: it stays as it was taken, the arms as they were', (aside) => {
    const body = person({ dev: true }), room = roomOf(body), pole = empty(room, 'pole', new Vector3(0, 1, 0.4));
    pole.userData.mass = 2;
    empty(pole, 'L', new Vector3(aside, 0, 0.15));
    empty(pole, 'R', new Vector3(-aside, 0, -0.15));
    room.updateMatrixWorld(true);
    let turn = new Quaternion(), facing = 0, drift = 0, carried: boolean | null = null, walking = false;
    const relative = () => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -body.facing).multiply(pole.getWorldQuaternion(new Quaternion()));
    play(function* () {
      yield* grab(body, pole, { left: 'L', right: 'R' });
      turn = relative();
      facing = body.facing;
      walking = true;
      carried = yield* carry(body, pole, new Vector3(0, 1.05, 3));
    }, [body], 15, () => {
      if (walking && body.feet.every((foot) => foot.planted)) drift = Math.max(drift, relative().angleTo(turn));
      return carried !== null;
    });
    expect(carried).toBe(true);
    expect(Math.abs(body.facing - facing)).toBeGreaterThan(0.5);
    expect(drift).toBeLessThan(0.45);
  });

  it('turned by its target so the arms cross, says so in the dev log', () => {
    const body = person({ dev: true }), room = roomOf(body), load = box(room, new Vector3(0, 1, 0.4), { solid: false });
    const there = empty(room, 'there', new Vector3(0, 1.05, 0.45));
    there.rotation.y = Math.PI;
    room.updateMatrixWorld(true);
    play(function* () {
      yield* grab(body, load, BOTH);
      yield* attempt(carry(body, load, there, { step: false }));
    }, [body], 10);
    expect(body.log.map(({ check }) => check)).toContain('arms crossed at the end of a carry (m)');
  });
});

describe('what a carry calls there, a release onto it accepts', () => {
  // (the trials that found it: each carry ends 6 mm to 1.1 cm off, within a stopped hand's tolerance, and a release there threw)
  const placed = () => {
    const body = person(), room = roomOf(body), load = box(room, new Vector3(0, 1, 0.4), { size: new Vector3(0.3, 0.1, 0.2), solid: false });
    const spot = empty(room, 'spot', new Vector3(0, 0.5, 0.45));
    room.updateMatrixWorld(true);
    let carried = false;
    play(function* () {
      yield* grab(body, load, BOTH);
      carried = yield* carry(body, load, spot);
      release(body, load, spot);
    }, [body], 12, () => load.parent === spot);
    return { carried, load, spot };
  };

  it('in both hands, low: set exactly on it', () => {
    const { carried, load, spot } = placed();
    expect(carried).toBe(true);
    expect(load.parent).toBe(spot);
    expect(worldOf(load).distanceTo(worldOf(spot))).toBeLessThan(1e-9);
  });

  it('a dog\'s jaw, off it by what its tip is allowed', () => {
    const body = new Body(dog(DOG)), room = roomOf(body), ball = box(room, new Vector3(0, 0.05, 0.6), { size: new Vector3(0.06, 0.06, 0.06), mass: 0.06, solid: false, name: 'ball' });
    const spot = empty(room, 'spot', new Vector3(0.3, 0.05, 1.2));
    room.updateMatrixWorld(true);
    let done = false;
    play(function* () {
      yield* grab(body, ball, { jaw: 'left' });
      yield* carry(body, ball, spot);
      release(body, ball, spot);
      done = true;
    }, [body], 15, () => done);
    expect(done).toBe(true);
    expect(ball.parent).toBe(spot);
  });
});

it('a waypoint a walking carry cannot keep in its hands misses, saying what held the hand off', () => {
  const body = person(), room = roomOf(body), tray = box(room, new Vector3(0, 1.05, 0.4), { size: new Vector3(0.36, 0.04, 0.3), mass: 3 });
  const table = empty(room, 'table', new Vector3(0, 0.75, 5));
  let miss: Missed | null = null;
  play(function* () {
    yield* grab(body, tray, BOTH);
    miss = yield* attempt(carry(body, tray, [new Vector3(1, 1.05, 2.5), table]));
  }, [body], 15, () => miss !== null);
  expect(miss!.why).toMatch(/^the hand was drawn [\d.]+ cm off its grip, (beyond the arm|trunk clearance|within reach)/);
});
