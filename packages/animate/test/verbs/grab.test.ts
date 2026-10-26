import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { grab, wait } from '../../src';
import { gazeOff } from '../../src/core/gaze';
import { INDEX, type Side } from '../../src/humanoid/bones';
import type { Person } from '../../src/humanoid/person';
import { insides, person, play } from '../bodies';
import { box, roomOf, worldOf } from '../things';

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
  const speed: Record<Side, number[]> = { left: [], right: [] };
  const was = { left: new Vector3(), right: new Vector3() };
  let going = false, took = NaN;
  play(function* () {
    yield* wait(1);
    going = true;
    yield* grab(body, thing, Object.fromEntries(sides.map((side) => [side, side])));
  }, [body], 4, (time) => {
    if (Number.isNaN(took) && body.holds(thing)) took = time - 1;
    for (const side of ['left', 'right'] as const) {
      const hand = h.pose.position(h.hands[side]);
      if (going) speed[side].push(hand.distanceTo(was[side]) * 60);
      was[side].copy(hand);
    }
  });
  return { speed, took };
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
    const feet = h.feet.map((foot) => ({ phase: foot.phase, from: new Vector3() }));
    let walking = false, stood = NaN, looking = NaN, touchdown = NaN, held = false;
    play(function* () {
      held = yield* grab(body, load, BOTH);
    }, [body], 10, (time) => {
      walking ||= h.locomotion.velocity.length() > 0.5;
      // (judged until it stands: its eyes leave the load as its hands close on it)
      if (!Number.isNaN(stood)) return held;
      if (gazeOff(h.gazer!, h.pose, worldOf(load)) >= 0.2) looking = NaN;
      else if (Number.isNaN(looking)) looking = time;
      const com = h.pose.com(new Vector3());
      h.feet.forEach((foot, s) => {
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
      if (Number.isNaN(at.eyes) && gazeOff(h.gazer!, h.pose, worldOf(load)) < 0.2) at.eyes = time;
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
      const grip = thing.getObjectByName('right')!;
      const off: number[] = [];
      play(function* () {
        yield* wait(1);
        yield* grab(body, thing, { right: 'right' });
      }, [body], 2.5, (time) => {
        if (time > 1 + 1e-9) off.push(h.pose.position(h.hands.right).distanceTo(worldOf(grip)));
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
    const grip = handle.getObjectByName('right')!;
    // (turned as the hand hangs, then a quarter turn more about its forearm: a hand that must turn to take it)
    delete grip.userData.free;
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

  it('takes a grip on a turned thing, the wrist on it', () => {
    const body = person(), h = insides(body), room = roomOf(body);
    const thing = box(room, new Vector3(-0.15, 1.0, 0.4), { turn: 0.6 });
    let held = false;
    play(function* () {
      held = yield* grab(body, thing, { right: 'right' });
    }, [body], 3, () => held);
    expect(held).toBe(true);
    const grip = thing.getObjectByName('right')!;
    expect(h.pose.position(h.hands.right).distanceTo(worldOf(grip))).toBeLessThan(0.03);
    expect(h.holding.right?.grip).toBe('right');
  });
});
