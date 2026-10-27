import type { Object3D } from 'three';
import type { Frame } from '../kernel/frame';
import type { Goal } from '../kernel/goal';
import type { Thing } from '../things/thing';
import { bodyOf, hangsFrom } from '../things/hold';
import type { Handed } from './handed';

/** A carry's way: its points (placements in the world, a sub-step at a time), the last one's orientation the thing takes. */
export type Clearance = boolean | 'head' | 'parts';

export interface Way {
  /** Destination follows this body, so walking cannot bring it nearer. */
  own: boolean;
  /** Waypoints before a body-mounted insertion corridor. */
  outside: number;
  /** the points it passes through, the last its end */
  points: readonly ((f: Frame) => Goal)[];
  /** the mean speed (m/s) of its last straight, an approach's own; none: the carry's */
  last?: number;
  /** whether it is kept clear of the body (`clearBody`): not on a way out of or into an empty on one of the body's bones by that
   * empty's approach (a pouch, a scabbard, a helm's place on the head), which brings it out or in */
  clear: Clearance;
}

/** Exit the source approach from its nearest point, then traverse targets and the destination approach. */
export function wayOf(person: Handed, thing: Thing, targets: readonly ((f: Frame) => Goal)[], end: Object3D | null): Way {
  const f = person.frame, at = person.track(thing.object).current.position.clone();
  const turn = (f: Frame) => targets[targets.length - 1](f).quaternion;
  const seat = thing.object.parent;
  const leaving = seat ? approachOf(seat).reverse().map((empty) => (frame: Frame) => ({ position: person.track(empty).at(frame.time).current.position })) : [];
  const coming = end ? approachOf(end).map((empty) => (frame: Frame) => ({ position: person.track(empty).at(frame.time).current.position, quaternion: turn(frame) })) : [];
  const points = [...leaving, ...targets.slice(0, -1), ...coming, targets[targets.length - 1]];
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
  const last = speed !== undefined && coming.length > 0 && nearest < points.length - 1 ? speed : undefined;
  const hasBodyApproach = (empty: Object3D | null) => empty !== null && hangsFrom(person, empty) >= 0 && approachOf(empty).length > 0;
  return { own: end !== null && bodyOf(end) === person, outside: hasBodyApproach(end) && !hasBodyApproach(seat) ? targets.length - 1 : 0, points: points.slice(Math.min(nearest, points.length - 1)), last, clear: hasBodyApproach(seat) || hasBodyApproach(end) ? false : end !== null && hangsFrom(person, end) >= 0 ? 'head' : true };
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
