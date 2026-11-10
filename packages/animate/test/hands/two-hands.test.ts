import { Euler, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { describe, expect, it } from 'vitest';
import { carry, grab, lookAt, reach, wait } from '../../src/index';
import { INDEX, type Side, readings, person, play, type Readings } from '../kit/bodies';
import { handSpeeds } from '../kit/hands';
import { box, roomOf, worldOf } from '../kit/things';

const BOTH = { left: 'left', right: 'right' } as const;

/** a knee's bend (rad): π less the angle at it */
function knee(h: Readings, side: Side): number {
  const at = (joint: 'UpperLeg' | 'LowerLeg' | 'Foot') => h.pose.position(INDEX[`${side}${joint}`]).clone();
  const joint = at('LowerLeg');
  return Math.PI - at('UpperLeg').sub(joint).angleTo(at('Foot').sub(joint));
}

const chestPitch = (h: Readings) => new Euler().setFromQuaternion(h.pose.rotation(INDEX.chest), 'YXZ').x;

describe('two hands', () => {
  it('the following hand waits where it is: held out, it does not drop toward its hang before it sets off', () => {
    const body = person(), h = readings(body), room = roomOf(body);
    const load = box(room, new Vector3(0, 0.95, 0.5), { mass: null, solid: false });
    let going = false;
    const hands = handSpeeds(h, () => going);
    play(function* () {
      // (both hands held out before it, then gone for the box from there)
      yield* reach(body, { left: new Vector3(0.2, 1.05, 0.3), right: new Vector3(-0.2, 1.05, 0.3) }, { until: 1.5 });
      going = true;
      yield* grab(body, load, BOTH);
    }, [body], 4, () => void hands.sample());
    // (until the leading hand is well under way, the other keeps still)
    const under = hands.speed.right.findIndex((v) => v > 0.3);
    expect(under).toBeGreaterThan(0);
    expect(Math.max(...hands.speed.left.slice(0, under))).toBeLessThan(0.1);
  });

  it('reaching and carrying together are not mirror images: the left sets off a moment after the right', () => {
    const reaching = person(), held = box(roomOf(reaching), new Vector3(0, 1.0, 0.45), { mass: null, solid: false });
    let going = false;
    const hands = handSpeeds(readings(reaching), () => going);
    play(function* () {
      yield* wait(1);
      going = true;
      yield* grab(reaching, held, BOTH);
    }, [reaching], 4, () => void hands.sample());
    /** when a hand has gone `distance` (s) */
    const gone = (speed: number[], distance: number) => {
      let path = 0;
      return speed.findIndex((v) => (path += v / 60) > distance) / 60;
    };
    // (reaching: 10 cm on its way 40–150 ms after the right)
    const lag = gone(hands.speed.left, 0.1) - gone(hands.speed.right, 0.1);
    expect(lag).toBeGreaterThanOrEqual(0.04);
    expect(lag).toBeLessThanOrEqual(0.15);

    const body = person(), room = roomOf(body);
    const left = box(room, new Vector3(0.2, 1.0, 0.35), { name: 'left box', mass: null, solid: false });
    const right = box(room, new Vector3(-0.2, 1.0, 0.35), { name: 'right box', mass: null, solid: false });
    const from = { left: new Vector3(), right: new Vector3() }, off = { left: NaN, right: NaN };
    let done = false;
    play(function* () {
      yield* parallel('all', grab(body, left, { left: 'right' }), grab(body, right, { right: 'left' }));
      from.left.copy(worldOf(left));
      from.right.copy(worldOf(right));
      yield* parallel('all', carry(body, left, [new Vector3(0.35, 1.25, 0.4), new Vector3(0.35, 1.0, 0.3)]),
        carry(body, right, [new Vector3(-0.35, 1.25, 0.4), new Vector3(-0.35, 1.0, 0.3)]));
      done = true;
    }, [body], 8, (time) => {
      // (when each has gone 3 cm on its way)
      for (const [side, thing] of [['left', left], ['right', right]] as const) {
        if (from[side].lengthSq() && Number.isNaN(off[side]) && worldOf(thing).distanceTo(from[side]) > 0.03) off[side] = time;
      }
      return done;
    });
    expect(done).toBe(true);
    expect(off.left - off.right).toBeGreaterThan(0.04);
    expect(off.left - off.right).toBeLessThan(0.3);
  });

  it('bows to hip-high grips without a transient squat', () => {
    // (rack geometry, recalled: hip-high grips just beyond a standing arm's reach)
    const body = person({ dev: true }), h = readings(body), room = roomOf(body);
    const load = box(room, new Vector3(0, 0.88, 0.61), { mass: null, solid: false });
    let held = false, bent = 0, bow = 0;
    play(function* () {
      held = yield* grab(body, load, BOTH);
    }, [body], 5, () => {
      bow = Math.max(bow, chestPitch(h));
      bent = Math.max(bent, knee(h, 'left'), knee(h, 'right'));
      return held;
    });
    expect(held).toBe(true);
    // (tuned regression bounds: knees under 35°, the back bowed 30° or more)
    expect(bent * 180 / Math.PI).toBeLessThan(35);
    expect(bow * 180 / Math.PI).toBeGreaterThan(30);
    expect(body.log).toEqual([]);
  });

});

describe('a load kept clear of the head', () => {
  it('keeps the head clear while a wide held load rises through a downward gaze', () => {
    const body = person({ dev: true }), h = readings(body), room = roomOf(body);
    const load = box(room, new Vector3(0, 0.88, 0.55), { size: new Vector3(0.44, 0.25, 0.3), mass: 8 });
    let samples = 0, done = false;
    const reserve = 0.22 + 0.06 * h.proportions.height;
    play(function* () {
      yield* grab(body, load, BOTH);
      yield* parallel('race', lookAt(body, load, { until: Infinity }), carry(body, load, new Vector3(0, 1.3, 0.35)));
      done = true;
    }, [body], 10, () => {
      if (load.parent === room) return done;
      samples++;
      const head = h.pose.point(INDEX.head, h.proportions.headCenter, new Vector3());
      expect(head.distanceTo(worldOf(load))).toBeGreaterThan(reserve);
      return done;
    });
    expect(done).toBe(true);
    expect(samples).toBeGreaterThan(60);
  });

});

it('follows a smoothly moving point without treating every sample as a stationary reach', () => {
  const body = person(), h = readings(body), point = new Vector3();
  const target = (time: number) => point.set(-0.3 + 0.15 * Math.sin(6 * time), 1.2, 0.4);
  let error = 0;
  play(function* () {
    yield* reach(body, { right: target }, { speed: 1, until: 5 });
  }, [body], 5, (time) => {
    if (time > 2) error = Math.max(error, h.pose.position(INDEX.rightHand).distanceTo(target(time)));
  });
  expect(error).toBeLessThan(0.03);
});

