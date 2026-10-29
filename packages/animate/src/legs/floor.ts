// What a body stands on: the floor's height under a point, and a foot fitted onto one level of it.
// Recalled: Unreal's CharacterMovement stands the capsule on the floor under it and steps up to MaxStepHeight, foot IK tracing down to
// the floor under each foot; footstep planners on stairs keep each foothold inside one tread's polygon. Here the floor is a height
// function, and a foothold is moved along the foot until its whole sole is on one level.
import { Vector3 } from 'three';
import { forwardOf } from '../kernel/math';
import type { Spot } from './support';
import type { Feet } from './step/state';

/** the floor's height under a world point (x, z) (m) */
export type Floor = (x: number, z: number) => number;

/** the plane y = 0: a body's floor unless it is given one */
export const FLAT: Floor = () => 0;

/** the highest the floor is under the points of a print (m) */
export function highestUnder(floor: Floor, print: readonly Spot[]): number {
  let most = -Infinity;
  for (const [x, z] of print) most = Math.max(most, floor(x, z));
  return most;
}

/** the lowest the floor is under the points of a print (m) */
export function lowestUnder(floor: Floor, print: readonly Spot[]): number {
  let least = Infinity;
  for (const [x, z] of print) least = Math.min(least, floor(x, z));
  return least;
}

/** the floor's height under a print if it is one level there (within `LEVEL`), else null: the print straddles an edge */
export function levelUnder(floor: Floor, print: readonly Spot[]): number | null {
  let most = -Infinity, least = Infinity;
  for (const [x, z] of print) {
    const y = floor(x, z);
    [most, least] = [Math.max(most, y), Math.min(least, y)];
  }
  return most - least <= LEVEL ? most : null;
}

/**
 * Foot `i`'s ankle `anchor`, standing flat heading `yaw`, fitted onto the floor: its whole sole on one level — moved along the foot,
 * forward or back as little as it takes (a heel on one tread and a toe on the next lands on one of them), and `FIT.clear` back from
 * the edge of a higher level fore or aft where that fits too (a toe off the riser it next swings over, a heel off the nosing it steps
 * down from) — its ankle its height above that; of those, the nearest that `keeps` (the balance a landing keeps), if one does, and first
 * of those on the level it is aimed `onto` (a swing keeps to the tread it set off for as its landing moves on). One that `stays` on that
 * level — a foot turning or squaring where the body stands — stands on it over its edge if the whole sole fits there nowhere (toes over a
 * nosing: a tread shorter than the foot), never on a level below. A sole that fits nowhere within `FIT.most` stands as it is on the highest
 * floor under it.
 */
export function foothold(floor: Floor, feet: Feet, i: number, anchor: Vector3, yaw: number, keeps?: (at: Readonly<Vector3>) => boolean, onto?: number, stays = false): Vector3 {
  if (floor === FLAT) return anchor.setY(feet.ankleHeight);
  const forward = forwardOf(yaw, _forward);
  let found: Vector3 | null = null, level = 0;
  const modes = onto === undefined ? ['any'] as const : stays ? ['kept', 'over'] as const : ['kept', 'any'] as const;
  for (const mode of modes) for (const clear of mode === 'over' ? [0] : [FIT.clear, 0]) for (let moved = 0; moved <= FIT.most + 1e-9; moved += FIT.step) for (const way of moved ? [1, -1] : [1]) {
    const at = _at.copy(anchor).addScaledVector(forward, way * moved), print = feet.print(i, at, yaw);
    // (over its edge: the level it stays on the highest under the sole, and under its ankle)
    const on = mode === 'over' ? over(floor, print, at, onto ?? 0) : levelOf(floor, print, forward, clear);
    if (on === null || (mode !== 'any' && Math.abs(on - (onto ?? on)) > LEVEL)) continue;
    if (!keeps || keeps(at)) return anchor.copy(at).setY(on + feet.ankleHeight);
    if (!found) [found, level] = [_found.copy(at), on];
  }
  if (found) return anchor.copy(found).setY(level + feet.ankleHeight);
  return anchor.setY(highestUnder(floor, feet.print(i, anchor, yaw)) + feet.ankleHeight);
}

/** `level` if a print `at` an ankle stands on it over its edge — no floor under the print higher, the floor under the ankle on it — else null */
function over(floor: Floor, print: readonly Spot[], at: Readonly<Vector3>, level: number): number | null {
  return Math.abs(highestUnder(floor, print) - level) <= LEVEL && Math.abs(floor(at.x, at.z) - level) <= LEVEL ? level : null;
}

/** the level a print stands on (m), if it is all on one and no higher floor is within `clear` (m) of it along `forward`; else null */
function levelOf(floor: Floor, print: readonly Spot[], forward: Readonly<Vector3>, clear: number): number | null {
  const level = levelUnder(floor, print);
  if (level === null || clear === 0) return level;
  for (const way of [clear, -clear]) for (const [x, z] of print) if (floor(x + forward.x * way, z + forward.z * way) > level + LEVEL) return null;
  return level;
}

/** Tuned: a print is on one level if the floor under it differs by no more than this (m) */
const LEVEL = 0.002;
/** Tuned: a foothold is moved along its foot in `step`s (m) up to `most` (m: about a person's foot) to fit it onto one level, kept
 * `clear` (m) off a higher one where it can be */
const FIT = { step: 0.01, most: 0.3, clear: 0.1 };
const _forward = new Vector3(), _at = new Vector3(), _found = new Vector3();
