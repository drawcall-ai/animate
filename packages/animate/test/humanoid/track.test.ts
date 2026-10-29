import { Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { track } from '../../src/index';
import { beyond } from '../../src/kernel/limits';
import { INDEX } from '../../src/species/humanoid/bones';
import type { Person } from '../../src/body/person';
import { insides, person, play } from '../bodies';

const eyes = (h: Person) => h.pose.point(INDEX.head, h.proportions.eyes, new Vector3());
const turned = (yaw: number, pitch = 0) => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch));

/** every joint of the spine within its range */
function withinRanges(h: Person) {
  for (const bone of [INDEX.spine, INDEX.chest, INDEX.neck, INDEX.head]) {
    const limit = h.skeleton.limits[bone];
    if (!limit) throw new Error('no limit');
    expect(beyond(h.pose.local(bone), limit)).toBeLessThan(1e-6);
  }
}

describe('track', () => {
  it('puts the eyes and turns the head as a headset is, through the spine, the body standing and lowering a little for a look round and down', () => {
    const body = person(), h = insides(body), p = h.proportions;
    // (a headset turned round and down about the skull's centre, as a head turns)
    const headset = new Object3D();
    headset.quaternion.copy(turned(0.9, 0.3));
    const centre = body.pose.point(INDEX.head, p.headCenter, new Vector3());
    headset.position.subVectors(p.eyes, p.headCenter).applyQuaternion(headset.quaternion).add(centre);
    play(function* () { yield* track(body, { head: headset }); }, [body], 2);
    // (pitched about the skull's centre, the head's base would rise past what the straight spine reaches: all but that, the body
    // letting itself down a few centimetres for eyes lower than it stands)
    expect(eyes(h).distanceTo(headset.position)).toBeLessThan(0.04);
    expect(h.pose.rotation(INDEX.head).angleTo(headset.quaternion)).toBeLessThan((2 * Math.PI) / 180);
    expect(p.hipHeight - h.pose.position(0).y).toBeLessThan(0.05);
    expect(Math.abs(body.facing)).toBeLessThan(0.01);
    withinRanges(h);
  });

  it('brings the body down under eyes lower than it stands', () => {
    const body = person(), h = insides(body), p = h.proportions;
    const target = new Vector3(0, p.eyeHeight - 0.4, 0.15);
    play(function* () { yield* track(body, { head: target }); }, [body], 4);
    expect(eyes(h).distanceTo(target)).toBeLessThan(0.03);
    expect(h.pose.position(0).y).toBeLessThan(p.hipHeight - 0.1);
    withinRanges(h);
  });

  it('puts each hand where its controller is, turned as it is', () => {
    const tracked = (turn?: Quaternion) => {
      const body = person({ dev: true }), h = insides(body);
      const left = new Object3D(), right = new Object3D();
      left.position.set(0.3, 1.2, 0.35);
      right.position.set(-0.25, 1.35, 0.4);
      if (turn) right.quaternion.copy(turn);
      play(function* () { yield* track(body, turn ? { left, right } : { left, right: right.position }); }, [body], 2.5);
      expect(h.pose.position(INDEX.leftHand).distanceTo(left.position)).toBeLessThan(0.01);
      expect(h.pose.position(INDEX.rightHand).distanceTo(right.position)).toBeLessThan(0.01);
      expect(body.owners.hands.left).toMatchObject({ verb: 'track', tier: 'asked' });
      return h.pose.rotation(INDEX.rightHand).clone();
    };
    // (a controller turned a little from where the hand turns on its own: the hand turns with it)
    const asked = tracked().multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.4));
    expect(tracked(asked).angleTo(asked)).toBeLessThan(0.05);
  });

  it('says so when a hand stays short of a target out of its reach, once, and not for one it keeps up with', () => {
    const logged = (right: Vector3) => {
      const body = person({ dev: true });
      play(function* () { yield* track(body, { right }); }, [body], 3);
      return body.log;
    };
    // (a wrist held up and out past the arm's length: it comes to rest about 10 cm short, said as it stops coming nearer)
    const short = logged(new Vector3(-0.2, 1.9, 0.6));
    expect(short).toEqual([expect.objectContaining({ check: 'tracked hand short of a target out of reach (m)', where: 'right', limit: 0.02 })]);
    expect(short[0].value).toBeGreaterThan(0.05);
    expect(logged(new Vector3(-0.25, 1.35, 0.4))).toEqual([]);
  });

  // (the trial that found it: a fist pump whose top went 0.2 m past the arm each stroke, never for half a second at a stretch, unsaid)
  it('says so too of a gesture out of reach only part of each stroke, and not of one within reach throughout', () => {
    const pumped = (top: number) => {
      const body = person({ dev: true });
      const right = (time: number) => new Vector3(-0.25, 1.35 + top * Math.max(0, Math.sin(2 * Math.PI * time)), 0.3);
      play(function* () { yield* track(body, { right }); }, [body], 4);
      return body.log;
    };
    expect(pumped(0.75)).toEqual([expect.objectContaining({ check: 'tracked hand short of a target out of reach (m)', where: 'right' })]);
    expect(pumped(0.25)).toEqual([]);
  });
});
