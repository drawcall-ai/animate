import { BoxGeometry, Euler, Group, Mesh, Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { cases } from '../open';
import { arriving, attempt, Body, carry, grab, humanoid, Missed, release, wait } from '../../src/index';
import { INDEX } from '../../src/species/humanoid/bones';
import { NATIVE } from '../skeletons/native';
import { insides, palmAt, person, play } from '../bodies';
import { box, empty, roomOf, worldOf, named } from '../things';

const BOTH = { left: 'left', right: 'right' } as const;

/** a shelf in `room` facing −Z: its top board's empty for a box `height` tall, reached from the empty out in front of it */
function shelf(room: Object3D, height = 0.26): Object3D {
  const stand = new Group();
  stand.position.set(-1.3, 0, 4.4);
  room.add(stand);
  // (the box's middle on the 1.8 m board 34 cm deep, near its front edge; come in to over the edge a little above it)
  const top = empty(stand, 'shelfTop', new Vector3(0, 1.8 + height / 2 + 0.005, -0.01));
  empty(stand, 'shelfFront', new Vector3(0, 1.8 + height / 2 + 0.035, -0.27));
  top.userData.approach = ['shelfFront'];
  room.updateMatrixWorld(true);
  return top;
}

/** the largest distance from each holding palm to its grip over a run, as `check` reads them each frame */
function grips(body: Body, thing: Object3D) {
  const h = insides(body);
  let most = 0;
  return {
    check: () => {
      for (const side of ['left', 'right'] as const) {
        const hold = h.holding[side];
        if (hold?.thing.object !== thing) continue;
        most = Math.max(most, palmAt(h, side).distanceTo(worldOf(named(thing, hold.grip))));
      }
    },
    get most() { return most; },
  };
}

describe('carry', () => {
  it('takes a box off the floor, carries it to a shelf overhead, in over its front, and lets go of it there', () => {
    const body = person({ dev: true }), room = roomOf(body);
    const load = box(room, new Vector3(0.35, 0.13, 2.6), { size: new Vector3(0.37, 0.26, 0.3), mass: 4, turn: 0.35 });
    const top = shelf(room);
    const held = grips(body, load);
    const outcomes: boolean[] = [];
    let done = false, lastRise = 0;
    play(function* () {
      outcomes.push(yield* grab(body, load, BOTH));
      outcomes.push(yield* carry(body, load, top));
      release(body, load, top);
      done = true;
    }, [body], 25, () => {
      held.check();
      // (the last of its way: up over the front edge, then in, not through the board)
      const at = worldOf(load);
      if (at.distanceTo(worldOf(top)) < 0.25) lastRise = Math.max(lastRise, at.y - worldOf(top).y);
      return done;
    });
    expect(outcomes).toEqual([true, true]);
    expect(load.parent).toBe(top);
    expect(load.position.length()).toBe(0);
    expect(worldOf(load).distanceTo(worldOf(top))).toBeLessThan(1e-9);
    expect(lastRise).toBeGreaterThan(0.01);
    expect(held.most).toBeLessThan(0.03);
    expect(body.log).toEqual([]);
  });

  it('prepares a heavy lift before its support leaves it, lifts it slower than a light one, and dips with it as it takes its weight', () => {
    const lift = (mass: number) => {
      const body = person({ dev: true }), h = insides(body), room = roomOf(body);
      const load = box(room, new Vector3(-0.15, 1, 0.35), { mass, solid: false });
      let held = NaN, off = NaN, end = NaN, top = -Infinity, dip = 0, down = 0, preparation = 0, hips = NaN;
      play(function* () {
        yield* grab(body, load, { right: 'right' });
        yield* carry(body, load, new Vector3(-0.15, 1.25, 0.35));
        end = h.frame.time;
      }, [body], 8, (time) => {
        if (Number.isNaN(held) && body.holds(load)) [held, hips] = [time, h.pose.position(0).y];
        if (!Number.isNaN(held) && Number.isNaN(off)) {
          if (load.parent === room) {
            down = Math.max(down, hips - h.pose.position(0).y);
            preparation = Math.max(preparation, h.poise.lower);
          } else off = time;
        }
        // (found by event while the grab lifts it clear, its hand the grab's: the load first up at its highest, then its lowest after)
        const y = worldOf(load).y;
        if (y > top) top = y;
        else if (body.owners.hands.right?.verb === 'grab') dip = Math.max(dip, top - y);
        return !Number.isNaN(end);
      });
      expect(body.log).toEqual([]);
      expect(worldOf(load).distanceTo(new Vector3(-0.15, 1.25, 0.35))).toBeLessThan(0.006);
      return { delay: off - held, down, preparation, dip, seconds: end - held, pitch: new Euler().setFromQuaternion(h.pose.rotation(INDEX.chest), 'YXZ').x };
    };
    const light = lift(0.5), heavy = lift(8);
    // (an anticipatory dip of 100 ms and 5 mm before a heavy load leaves its support; a light one is just taken)
    expect(heavy.delay - light.delay).toBeGreaterThanOrEqual(0.05);
    expect(heavy.delay - light.delay).toBeLessThanOrEqual(0.15);
    expect(heavy.preparation).toBeGreaterThanOrEqual(0.005);
    expect(heavy.down).toBeLessThan(0.01);
    // (from taking hold to the load at rest up there)
    expect(heavy.seconds).toBeGreaterThan(light.seconds + 0.5);
    expect(heavy.pitch).toBeLessThan(light.pitch - 0.01);
    // (its weight is taken in the grab's 3 cm lift clear of the floor's support, where the library's tuned compliance dips an 8 kg load
    // 8 mm and a 0.5 kg one under 1 mm: the heavy one dips at least half that difference more than the light)
    expect(heavy.dip).toBeGreaterThan(light.dip + 0.004);
  });

  it('follows a target that moves and turns, holding the box on it once there, its palms on the grips', () => {
    const body = person({ dev: true }), room = roomOf(body);
    const load = box(room, new Vector3(0, 1.0, 0.45), { size: new Vector3(0.36, 0.2, 0.25), mass: 2, solid: false });
    const goal = empty(room, 'goal', new Vector3(0, 1.15, 0.45));
    const held = grips(body, load);
    let time = 0, carried = false;
    play(function* () {
      yield* grab(body, load, BOTH);
      carried = yield* carry(body, load, goal, { until: 4 });
    }, [body], 10, (t) => {
      time = t;
      // (the goal drifting aside and turning for the first 3 s)
      const u = Math.min(t, 3);
      goal.position.set(0.1 * Math.sin(u), 1.15, 0.45);
      goal.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 0.15 * u);
      held.check();
      return carried;
    });
    expect(carried).toBe(true);
    expect(time).toBeLessThan(10);
    expect(worldOf(load).distanceTo(worldOf(goal))).toBeLessThan(0.01);
    expect(load.getWorldQuaternion(new Quaternion()).angleTo(goal.quaternion)).toBeLessThan(0.02);
    expect(held.most).toBeLessThan(0.03);
    expect(body.log).toEqual([]);
  });

  it('walks a box it holds to a far target: off the table to its body, and onto the target as it arrives', () => {
    const body = person({ dev: true }), room = roomOf(body);
    const load = box(room, new Vector3(0, 0.9, 0.5), { mass: 3 });
    const table = empty(room, 'table', new Vector3(1.5, 0.9, 3));
    const held = grips(body, load);
    let carried = false, walked = 0;
    const from = body.position.clone();
    play(function* () {
      yield* grab(body, load, BOTH);
      carried = yield* carry(body, load, table);
    }, [body], 15, () => {
      held.check();
      walked = Math.max(walked, body.position.distanceTo(from));
      return carried;
    });
    expect(carried).toBe(true);
    expect(walked).toBeGreaterThan(2);
    expect(worldOf(load).distanceTo(worldOf(table))).toBeLessThan(0.01);
    expect(held.most).toBeLessThan(0.03);
    expect(body.log).toEqual([]);
  });

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
  cases([['misses, saying why, when the thing is not in place: its own body in the way, or its arms short of the end, `until` or not', [1]]])('misses, saying why, when the thing is not in place: its own body in the way, or its arms short of the end, `until` or not', () => {
    const outcome = (end: Vector3, until?: () => boolean) => {
      const body = person({ dev: true }), room = roomOf(body);
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

  it('throws when no hand holds what it is asked to carry', () => {
    const body = person(), room = roomOf(body);
    const load = box(room, new Vector3(0, 0.9, 0.5));
    expect(() => play(function* () { yield* carry(body, load, new Vector3()); }, [body], 0.1)).toThrow('grab it first');
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
  it('leaves a fixed rail where it is as one of the hands on it lets go', () => {
    const body = person({ dev: true }), room = roomOf(body), rail = new Group();
    rail.position.set(0, 1, 0.35);
    room.add(rail);
    for (const [name, x] of [['left', 0.2], ['right', -0.2]] as const) Object.assign(empty(rail, name, new Vector3(x, 0, 0)).userData, { handle: [1, 0, 0], radius: 0.02 });
    room.updateMatrixWorld(true);
    play(function* () {
      yield* grab(body, rail, BOTH, { step: false, speed: Infinity });
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

  it('puts what one hand carries onto an empty, the hand keeping hold of it there and going with it as its place moves', () => {
    const body = person({ dev: true }), h = insides(body), room = roomOf(body);
    const ball = box(room, new Vector3(-0.2, 1.1, 0.35), { size: new Vector3(0.06, 0.06, 0.06), mass: 0.4 });
    Object.assign(empty(ball, 'grip', new Vector3()).userData, { handle: [0, 1, 0], radius: 0.03 });
    const place = empty(room, 'place', new Vector3(-0.25, 1.2, 0.4));
    let put = false;
    play(function* () {
      yield* grab(body, ball, { right: 'grip' });
      yield* carry(body, ball, place, { step: false });
      release(body, ball, place, { right: true });
      put = true;
    }, [body], 4, () => put);
    expect(ball.parent).toBe(place);
    expect(body.holds(ball)).toBe(true);
    const palm = () => palmAt(h, 'right').distanceTo(worldOf(ball));
    const held = palm();
    play(function* () { yield* wait(1); }, [body], 1, () => void (place.position.y += 0.05 / 60));
    expect(ball.parent).toBe(place);
    expect(Math.abs(palm() - held)).toBeLessThan(0.01);
    expect(body.log).toEqual([]);
  });

  it('follows through: a hand let go of something moving carries on its way, then off it', () => {
    const body = person(), h = insides(body), room = roomOf(body);
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

  it('lets go with the hands named, the others keeping hold: one hand left carries the thing alone', () => {
    const body = person({ dev: true }), room = roomOf(body);
    const load = box(room, new Vector3(0, 1.0, 0.4), { mass: 1, solid: false });
    let done = false;
    play(function* () {
      yield* grab(body, load, BOTH);
      release(body, { right: load });
      yield* wait(0.5);
      done = true;
    }, [body], 8, () => done);
    expect(insides(body).holding.left?.thing.object).toBe(load);
    expect(insides(body).holding.right).toBeNull();
    expect(load.parent).toBe(body.bones.leftHand);
    expect(body.log).toEqual([]);
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
