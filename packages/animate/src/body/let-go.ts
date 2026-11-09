import { Object3D, Vector3 } from 'three';
import { SUBSTEP } from '../kernel/frame';
import { REACHED, type Placement } from '../kernel/goal';
import type { Miss } from '../kernel/requests';
import { spinOf } from '../kernel/rotation';
import { topOf } from '../kernel/scene';
import { attach, bodyOf, carriedBy, grasp, handsOn, take } from '../things/hold';
import type { Thing } from '../things/thing';
import { END } from './hand-staging';
import type { Self } from './self';

/** how near an empty, and how near its turn, a thing put onto it must be (m, rad): nearer, it is set exactly there — what a carry there calls
 * there (`REACHED`), a sub-step on at the speed and spin it has come to rest within (`END`) */
const ONTO = { distance: REACHED.close + END.speed * SUBSTEP, turn: REACHED.closeTurn + END.spin * SUBSTEP };

/** How a thing was moving as it was let go (world): its velocity (m/s) and its spin (rad/s about the world's axes). */
export interface Released {
  velocity: Vector3;
  spin: Vector3;
}

/** `self`'s `hands` letting go of `thing` (see `release`), and backing out of it unless they go on to something else (`backOut`
 * false): how it was moving as they did, and how far off an empty `onto` it was left */
export function letGo(self: Self, thing: Thing, hands: readonly string[], onto?: Object3D, backOut = true): { motion: Released; miss: Miss | null } {
  const f = self.frame, object = thing.object, trail = self.movingFrameOf(object).at(f.time);
  const motion = { velocity: new Vector3().subVectors(trail.current.position, trail.prev.position).divideScalar(f.dt), spin: spinOf(trail.prev.quaternion, trail.current.quaternion, f.dt, new Vector3()) };
  const placed = trail.current;
  if (onto && onto.children.some((child) => child !== object && child.userData.mass !== undefined)) throw new Error(`release: "${onto.name}" holds another thing already, so "${object.name}" cannot go onto it`);
  // (a fingertip draws back off its button the way it came in)
  const away = Object.fromEntries(hands.flatMap((hand) => {
    const hold = self.holding[hand], way = hold && self.handStaging.away(hold, placed);
    return way ? [[hand, way]] : [];
  }));
  const carried = carriedBy(self, thing);
  for (const hand of hands) grasp(self, hand, null);
  self.stopMoving(object);
  if (backOut) self.handStaging.backOut(hands, away);
  const holder = [...thing.holders].find((other): other is Self => other !== self);
  if (onto) {
    const miss = put(self, thing, onto, placed);
    // (a hand kept on it holds it where it rests now, no longer as the carry that brought it keeps it in the hand)
    for (const hand of handsOn(self, thing)) delete self.holding[hand]?.idle;
    return { motion, miss };
  }
  // (a hand of its own still on it: that hand carries it alone, if it was carried — what stayed where it is as the hands held it, a rifle worn on its mount, a fixed rail, stays there)
  else if (handsOn(self, thing).length) {
    if (carried) take(self, thing);
  } else if (holder) take(holder, thing);
  else {
    // (a thing lifted is left in the world where it is, under the scene's root; one never lifted — a button, a part still in its place —
    // stays where it is)
    if (thing.lifted) attach(thing, topOf(object));
    if (!bodyOf(object)) thing.lifted = false;
  }
  return { motion, miss: null };
}

/**
 * `thing`, which is `at` (world), put onto the empty `onto`: set exactly there as near as a carry there leaves it, else where it is, a miss
 */
function put(self: Self, thing: Thing, onto: Object3D, at: Readonly<Placement>): Miss | null {
  const empty = self.movingFrameOf(onto).at(self.frame.time).current, off = at.position.distanceTo(empty.position), turned = at.quaternion.angleTo(empty.quaternion);
  // (an empty out of the scene takes the thing out of it with it)
  if (self.object.parent && topOf(onto) !== topOf(self.object)) self.warn(`onto gone ${onto.uuid}`, `"${thing.object.name}" was put onto "${onto.name}", which is not in the body's scene, so it has gone out of the scene with it: put it onto an empty still there`);
  attach(thing, onto);
  if (!bodyOf(thing.object)) thing.lifted = false;
  const fix = 'and stays so: `carry` it there and let go as that carry ends, for after it the thing rides the hand';
  const where = `${thing.object.name} onto ${onto.name}`;
  if (off > ONTO.distance) return { where, off, limit: ONTO.distance, why: `it was ${(100 * off).toFixed(1)} cm off the empty as it was let go, ${fix}` };
  if (turned > ONTO.turn) return { where, off: turned, limit: ONTO.turn, why: `it was turned ${(turned * 180 / Math.PI).toFixed(0)}° off the empty as it was let go (off and limit in rad), ${fix}` };
  thing.object.position.set(0, 0, 0);
  thing.object.quaternion.identity();
  return null;
}

