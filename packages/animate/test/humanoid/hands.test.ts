import { Euler, Object3D, Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { describe, expect, it } from 'vitest';
import { carry, grab, lookAt, reach } from '../../src/index';
import { INDEX, type Side } from '../../src/species/humanoid/bones';
import { clearBody } from '../../src/hands/person/clearance';
import { grasp } from '../../src/things/hold';
import { Thing } from '../../src/things/thing';
import { pointSegmentDistance } from '../../src/kernel/math';
import type { Person } from '../../src/body/person';
import { dt, feetOf, insides, person, play, run } from '../bodies';
import { box, empty, roomOf, worldOf } from '../things';

const BOTH = { left: 'left', right: 'right' } as const;

/** each hand's speed (m/s) each frame from when `going()` turns true */
function handSpeeds(h: Person, going: () => boolean) {
  const speed: Record<Side, number[]> = { left: [], right: [] };
  const was = { left: new Vector3(), right: new Vector3() };
  return {
    speed,
    sample() {
      for (const side of ['left', 'right'] as const) {
        const hand = h.pose.position(h.hands[side]);
        if (going()) speed[side].push(hand.distanceTo(was[side]) / dt);
        was[side].copy(hand);
      }
    },
  };
}

/** a knee's bend (rad): π less the angle at it */
function knee(h: Person, side: Side): number {
  const at = (joint: 'UpperLeg' | 'LowerLeg' | 'Foot') => h.pose.position(INDEX[`${side}${joint}`]).clone();
  const joint = at('LowerLeg');
  return Math.PI - at('UpperLeg').sub(joint).angleTo(at('Foot').sub(joint));
}

const chestPitch = (h: Person) => new Euler().setFromQuaternion(h.pose.rotation(INDEX.chest), 'YXZ').x;

describe('two hands', () => {
  it('the following hand waits where it is: held out, it does not drop toward its hang before it sets off', () => {
    const body = person(), h = insides(body), room = roomOf(body);
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

  it('carrying a thing in each hand: the left sets off a moment after the right', () => {
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
    const body = person({ dev: true }), h = insides(body), room = roomOf(body);
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

  it('takes and holds a load at hip height standing: its weight shifting over planted feet is no walk', () => {
    // (it once was, which switched the loaded reach's bow off and on every sub-step)
    const body = person({ dev: true }), h = insides(body), room = roomOf(body);
    const load = box(room, new Vector3(0, 0.88, 0.61), { size: new Vector3(0.44, 0.25, 0.3), mass: 5 });
    let planted = 0, walking = 0;
    play(function* () {
      yield* grab(body, load, BOTH);
      yield* carry(body, load, new Vector3(0, 0.93, 0.5), { until: 3 });
    }, [body], 8, () => {
      if (!feetOf(h).every((foot) => foot.phase === 'planted')) return;
      planted++;
      if (h.locomotion.moving) walking++;
    });
    expect(planted).toBeGreaterThan(400);
    expect(walking).toBe(0);
    expect(body.log).toEqual([]);
  });
});

describe('a load kept clear of the head', () => {
  it('keeps the head clear while a wide held load rises through a downward gaze', () => {
    const body = person({ dev: true }), h = insides(body), room = roomOf(body);
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

  it.each([0.02, 0.22])('clears a %s m load from the neck→head segment, above the trunk too', (radius) => {
    const body = person(), h = insides(body), room = roomOf(body);
    run(body, 1);
    const size = new Vector3(2, 2, 2).multiplyScalar(radius);
    const thing = Thing.of(box(room, new Vector3(), { size, name: `${radius} m` }));
    const neck = h.pose.position(INDEX.neck), head = h.pose.point(INDEX.head, h.proportions.headCenter, new Vector3());
    const reserve = radius + 0.06 * h.proportions.height;
    for (const part of [0, 0.5, 1]) {
      const at = neck.clone().lerp(head, part);
      clearBody(h, h.frame, thing, at, new Quaternion(), { position: at.clone(), quaternion: new Quaternion() });
      expect(head.distanceTo(at)).toBeGreaterThan(reserve);
      expect(pointSegmentDistance(at, neck, head)).toBeGreaterThan(reserve);
    }
  });
});

describe('a grip taken', () => {
  it.each([false, true])('is checked against the wrist as the hand takes it (10 cm off: %s)', (off) => {
    const body = person({ dev: true }), h = insides(body), room = roomOf(body);
    run(body, 0.5);
    const rope = new Object3D();
    rope.name = 'loose rope';
    rope.position.copy(h.pose.position(h.hands.left)).add(new Vector3(off ? 0.1 : 0, 0, 0));
    room.add(rope);
    empty(rope, 'end', new Vector3());
    grasp(h, 'left', { thing: Thing.of(rope), grip: 'end', goal: { position: new Vector3() } });
    body.update(dt);
    const problems = body.log.filter((entry) => entry.check === 'grip activation distance (m)');
    if (off) expect(problems).toEqual([expect.objectContaining({ value: expect.closeTo(0.1, 1), where: 'loose rope left end' })]);
    else expect(problems).toEqual([]);
  });
});
