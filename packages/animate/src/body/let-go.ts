import { Object3D, Vector3 } from 'three';
import { SUBSTEP } from '../kernel/frame';
import { REACHED } from '../kernel/goal';
import type { Miss } from '../kernel/requests';
import { spinOf } from '../kernel/rotation';
import { attach, bodyOf, carriedBy, grasp, handsOn, take } from '../things/hold';
import type { Thing } from '../things/thing';
import { END } from './hand-staging';
import type { Self } from './self';

/** how near an empty a thing put onto it must be (m): nearer, it is set exactly there — what a carry there calls there (`REACHED.close`),
 * a sub-step on at the speed it has come to rest within (`END`) */
const ONTO = REACHED.close + END.speed * SUBSTEP;

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
    const miss = put(self, thing, onto, placed.position);
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
    if (thing.lifted) attach(thing, rootOf(object));
    if (!bodyOf(object)) thing.lifted = false;
  }
  return { motion, miss: null };
}

/**
 * `thing`, which is `at` (world), put onto the empty `onto`: set exactly there as near as a carry there leaves it, else where it is, a miss
 */
function put(self: Self, thing: Thing, onto: Object3D, at: Readonly<Vector3>): Miss | null {
  const off = at.distanceTo(self.movingFrameOf(onto).at(self.frame.time).current.position);
  attach(thing, onto);
  if (!bodyOf(thing.object)) thing.lifted = false;
  if (off > ONTO) return { where: `${thing.object.name} onto ${onto.name}`, off, limit: ONTO, why: `it was ${(100 * off).toFixed(1)} cm off the empty as it was let go, and stays so: \`carry\` it there and let go as that carry ends, for after it the thing rides the hand` };
  thing.object.position.set(0, 0, 0);
  thing.object.quaternion.identity();
  return null;
}

/** the root of the scene `object` is in */
function rootOf(object: Object3D): Object3D {
  let root = object;
  while (root.parent) root = root.parent;
  return root;
}
