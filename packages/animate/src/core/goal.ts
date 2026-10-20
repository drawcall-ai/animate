import type { Quaternion, Vector3 } from 'three';
import type { ReusableTimeline, UntilCondition } from '@pmndrs/timeline';
import type { Frame } from './body';
import type { Placed } from './carrier';

/** A behaviour: a timeline a body steps every sub-step, writing its pose. */
export type Behaviour<W = unknown> = ReusableTimeline<Frame<W>>;

/** A goal as it is, or as it is at each sub-step (`T` is never itself a function). */
export type Live<T, W = unknown> = T | ((f: Frame<W>) => T);

/** what a live goal is at `f` */
export function live<T, W>(goal: Live<T, W>, f: Frame<W>): T {
  return isRead(goal) ? goal(f) : goal;
}

const isRead = <T, W>(goal: Live<T, W>): goal is (f: Frame<W>) => T => typeof goal === 'function';

/** Where something is, and turned how (world, or a carrier's frame). */
export interface Placement {
  position: Vector3;
  quaternion?: Quaternion;
}

/** A placement to go to: its own velocity (m/s) and spin (rad/s) are followed without lag. */
export interface Target extends Placement {
  velocity?: Vector3;
  spin?: Vector3;
  /** the tip may roll freely about this line (a hand round a bar, a palm on a face; in the frame the target is in): of the rotations so, the one nearest it is */
  axis?: Vector3;
}

/** How fast something may move: its acceleration (m/s²) and speed (m/s), and its turn's (rad/s², rad/s). */
export interface Motion {
  accel: number;
  speed?: number;
  turnAccel?: number;
  turnSpeed?: number;
}

/** How a value moves toward its goal (see `follow`). */
export type FollowOptions<V> = Pick<Motion, 'accel' | 'speed'> & {
  /** the goal's own velocity (per s; for a rotation its angular velocity, rad/s), followed without lag (default still) */
  velocity?: V;
  /** the goal (and its velocity) is in this carrier's frame, placed so at the step's time and the two before (`Carrier.at`): the value is followed relative to it */
  on?: Placed;
};

/** When a goal-following behaviour ends: a condition, or once it has `'reached'` its goal (within 1 cm and 2°, under 5 cm/s off its velocity). */
export type Until<W = unknown> = UntilCondition<Frame<W>> | 'reached';

/** what `'reached'` allows: m, rad, m/s */
export const REACHED = { distance: 0.01, angle: (2 * Math.PI) / 180, speed: 0.05 };
