import { Group, Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { carry, grab, release, wait, type Body } from '../../src';
import { insides, person, play } from '../bodies';
import { box, empty, roomOf, worldOf } from '../things';

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

/** the largest distance from each holding wrist to its grip over a run, as `check` reads them each frame */
function grips(body: Body, thing: Object3D) {
  const h = insides(body);
  let most = 0;
  return {
    check: () => {
      for (const side of ['left', 'right'] as const) {
        const hold = h.holding[side];
        if (hold?.thing.object !== thing) continue;
        most = Math.max(most, h.pose.position(h.hands[side]).distanceTo(worldOf(thing.getObjectByName(hold.grip)!)));
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
  }, 20000);

  it('lifts a heavy load slower than a light one, and dips with it as it takes its weight', () => {
    const lift = (mass: number) => {
      const body = person({ dev: true }), room = roomOf(body);
      const load = box(room, new Vector3(-0.15, 1, 0.35), { mass, solid: false });
      let taken = NaN, end = NaN, top = -Infinity, dip = 0;
      play(function* () {
        yield* grab(body, load, { right: 'right' });
        yield* carry(body, load, new Vector3(-0.15, 1.25, 0.35));
        end = insides(body).frame.time;
      }, [body], 8, (time) => {
        if (Number.isNaN(taken) && body.holds(load)) taken = time;
        // (found by event: the load first up at its highest, then its lowest after)
        const y = worldOf(load).y;
        if (y > top) top = y;
        else dip = Math.max(dip, top - y);
        return !Number.isNaN(end);
      });
      expect(body.log).toEqual([]);
      expect(worldOf(load).distanceTo(new Vector3(-0.15, 1.25, 0.35))).toBeLessThan(0.006);
      return { seconds: end - taken, dip };
    };
    const light = lift(0.5), heavy = lift(8);
    // (from taking hold to the load at rest up there)
    expect(heavy.seconds).toBeGreaterThan(light.seconds + 0.5);
    expect(heavy.dip).toBeGreaterThan(0.01);
  });

  it('follows a target that moves and turns, holding the box on it once there, its wrists on the grips', () => {
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
  }, 20000);

  it('throws when no hand holds what it is asked to carry', () => {
    const body = person(), room = roomOf(body);
    const load = box(room, new Vector3(0, 0.9, 0.5));
    expect(() => play(function* () { yield* carry(body, load, new Vector3()); }, [body], 0.1)).toThrow('grab it first');
  });
});

describe('release', () => {
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

  it('says in development when a thing is let go in mid-air, put onto an empty far off it, or onto one already taken', () => {
    const body = person({ dev: true }), room = roomOf(body);
    const load = box(room, new Vector3(0, 0.9, 0.45), { mass: 1, solid: false });
    const other = box(room, new Vector3(1, 0.9, 1), { name: 'other', mass: 1, solid: false });
    const far = empty(room, 'far', new Vector3(1, 0.9, 1));
    far.attach(other);
    let done = false;
    play(function* () {
      yield* grab(body, load, BOTH);
      yield* carry(body, load, new Vector3(0, 1.1, 0.4));
      release(body, load, far);
      done = true;
    }, [body], 8, () => done);
    expect(body.log.map(({ check }) => check)).toEqual(['put onto an empty another thing sits in', 'put onto an empty this far off it (m)']);
    // (carried up off where it was taken and let go there: nothing under it)
    const loose = box(room, new Vector3(0.2, 0.9, 0.45), { name: 'loose', mass: 1, solid: false });
    done = false;
    play(function* () {
      yield* grab(body, loose, BOTH);
      yield* carry(body, loose, new Vector3(0.2, 1.1, 0.4));
      release(body, loose);
      done = true;
    }, [body], 8, () => done);
    expect(body.log.map(({ check }) => check).slice(2)).toEqual(['let go in mid-air: its lowest point above the ground (m)']);
  });
});
