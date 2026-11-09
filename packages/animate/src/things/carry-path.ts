import type { Object3D } from 'three';
import type { Frame } from '../kernel/frame';
import type { Goal } from '../kernel/goal';
import type { Thing } from './thing';
import { bodyOf, boneOf } from './hold';
import type { Self } from '../body/self';

/** How a carried thing is kept clear of the body: of its trunk and head (true); of its head alone (`head`: on its way to a place on the
 * body); of its trunk, and of its head by each of its parts' bounds (`parts`: on its way along the outside to a place on the body); or
 * not at all. */
export type Clearance = boolean | 'head' | 'parts';

/** A carry's way: its points (placements in the world, a sub-step at a time), the last one's orientation the thing takes. */
export type CarryPath = ReturnType<typeof carryPathOf>;

/** Exit the source approach from its nearest point, then traverse targets and the destination approach. */
export function carryPathOf(person: Self, thing: Thing, targets: readonly ((f: Frame) => Goal)[], end: Object3D | null) {
  const f = person.frame, at = person.track(thing.object).current.position.clone();
  const turn = (f: Frame) => targets[targets.length - 1](f).quaternion;
  const seat = thing.object.parent;
  const leaving = seat ? approachOf(seat).reverse().map((empty) => (frame: Frame) => ({ position: person.track(empty).at(frame.time).current.position })) : [];
  const coming = end ? approachOf(end).map((empty) => (frame: Frame) => ({ position: person.track(empty).at(frame.time).current.position, quaternion: turn(frame) })) : [];
  const points: ((f: Frame) => Goal)[] = [...leaving, ...targets.slice(0, -1), ...coming, targets[targets.length - 1]];
  // (a draw from part way out of a scabbard does not push back in to the mouth first)
  let nearest = 0, best = Infinity;
  leaving.forEach((point, k) => {
    const distance = point(f).position.distanceTo(at);
    if (distance < best) [best, nearest] = [distance, k];
  });
  const speed = end?.userData.speed;
  if (speed !== undefined && (typeof speed !== 'number' || !Number.isFinite(speed) || speed <= 0)) {
    throw new Error(`"${end?.name}" has invalid userData.speed: expected finite positive m/s`);
  }
  /** the mean speed (m/s) of its last straight, an approach's own; none: the carry's */
  const last = speed !== undefined && coming.length > 0 && nearest < points.length - 1 ? speed : undefined;
  const hasBodyApproach = (empty: Object3D | null) => empty !== null && boneOf(person, empty) >= 0 && approachOf(empty).length > 0;
  return {
    /** Destination follows this body, so walking cannot bring it nearer. */
    own: end !== null && bodyOf(end) === person,
    /** Waypoints before a body-mounted insertion corridor. */
    outside: hasBodyApproach(end) && !hasBodyApproach(seat) ? targets.length - 1 : 0,
    /** the points it passes through, the last its end */
    points: points.slice(Math.min(nearest, points.length - 1)),
    last,
    /** whether it is kept clear of the body (`clearBody`): not on a way out of or into an empty on one of the body's bones by that
     * empty's approach (a pouch, a scabbard, a helm's place on the head), which brings it out or in */
    clear: hasBodyApproach(seat) || hasBodyApproach(end) ? false : end !== null && boneOf(person, end) >= 0 ? 'head' as const : true,
  };
}

/** the empties beside `empty` its approach names (`userData.approach`, outermost first) */
function approachOf(empty: Object3D): Object3D[] {
  const names = empty.userData.approach;
  if (names === undefined) return [];
  if (!Array.isArray(names) || !names.every((name): name is string => typeof name === 'string')) throw new Error(`"${empty.name}" has a userData.approach that is no list of names`);
  const around = empty.parent ?? empty;
  return names.map((name) => {
    const found = around.getObjectByName(name);
    if (!found) throw new Error(`"${empty.name}" approaches by "${name}", which is not beside it`);
    return found;
  });
}
