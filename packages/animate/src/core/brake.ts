import { Quaternion, Vector3 } from 'three';
import type { Frame } from './body';
import { followRotation } from './follow';
import type { Motion } from './goal';
import { spinOf } from './rotation';

/**
 * Brakes `bones` (each a joint: its rotation in its parent's frame) to `motion`'s acceleration
 * and speed (rad/s², rad/s): each moves on from its history toward what `current` has for it as
 * `followRotation` would, the goal's own motion since the last sub-step (`goals`: the caller's
 * memory of them, by bone, kept up to date here) followed without lag unless it is faster than
 * `speed` (a jump).
 * A behaviour calls it on the bones it wrote (after a `solveChain`, whose joints can spin where a
 * limb swivels), so that none of them turns faster than a joint does.
 */
export function brake(f: Pick<Frame, 'prev2' | 'prev' | 'current' | 'dt'>, bones: readonly number[], motion: Pick<Motion, 'accel' | 'speed'>, goals: Map<number, Quaternion>): void {
  for (const b of bones) {
    const goal = _goal.copy(f.current.local(b));
    // (a goal not seen before is taken as still)
    let last = goals.get(b);
    if (!last) goals.set(b, (last = goal.clone()));
    // (a goal that jumped faster than the joint may turn, a limb's solve swivelling, is braked, not followed)
    const velocity = spinOf(last, goal, f.dt, _v);
    if (velocity.length() > (motion.speed ?? Infinity)) velocity.set(0, 0, 0);
    last.copy(goal);
    f.current.setLocal(b, followRotation(f.prev2.local(b), f.prev.local(b), goal, { ...motion, velocity }, f.dt, _q));
  }
}

const _goal = new Quaternion();
const _q = new Quaternion();
const _v = new Vector3();
