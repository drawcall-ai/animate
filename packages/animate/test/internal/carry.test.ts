import { Euler, Group, Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Body, carry, grab, release, wait } from '../../src/index';
import { INDEX, person, play } from '../kit/bodies';
import { box, empty, named, roomOf, worldOf } from '../kit/things';
import { personSelf, palmAt } from './self';

const BOTH = { left: 'left', right: 'right' } as const;

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
  const h = personSelf(body);
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
      const body = person({ dev: true }), h = personSelf(body), room = roomOf(body);
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
            preparation = Math.max(preparation, h.asks.lower);
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

});

describe('release', () => {
  it('puts what one hand carries onto an empty, the hand keeping hold of it there and going with it as its place moves', () => {
    const body = person({ dev: true }), h = personSelf(body), room = roomOf(body);
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
    expect(personSelf(body).holding.left?.thing.object).toBe(load);
    expect(personSelf(body).holding.right).toBeNull();
    expect(load.parent).toBe(body.bones.leftHand);
    expect(body.log).toEqual([]);
  });

});

