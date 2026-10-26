import { Quaternion, Vector3 } from 'three';
import type { ReadonlyPose } from './pose';
import type { Frame } from './frame';

/** A goal as it is, or as it is at each sub-step (`T` is never itself a function). */
export type Live<T> = T | ((f: Frame) => T);

/** what a live goal is at `f` */
export function live<T>(goal: Live<T>, f: Frame): T {
  return isRead(goal) ? goal(f) : goal;
}

const isRead = <T>(goal: Live<T>): goal is (f: Frame) => T => typeof goal === 'function';

/** Where something is, and turned how (world, or a carrier's frame). */
export interface Placement {
  position: Vector3;
  quaternion?: Quaternion;
}

/** Where a carrier is at a sub-step (`current`) and the two before. */
export interface Placed {
  readonly prev2: Required<Placement>;
  readonly prev: Required<Placement>;
  readonly current: Required<Placement>;
}

/** A placement to go to: its own velocity (m/s) and spin (rad/s) are followed without lag. */
export interface Target extends Placement {
  velocity?: Vector3;
  spin?: Vector3;
  /** the body whose bone carries it: that body letting itself down or bowing carries it down too */
  carriedBy?: object;
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
  /** the goal (and its velocity) is in this carrier's frame, placed so at the step's time and the two before (its `at`): the value is followed relative to it */
  on?: Placed;
};

/** the longest a hand takes to get to its goal, unless told, before it is a problem in the dev log (s): a person's and another body's alike */
export const REACHING = 4;
/** what reaching a goal allows: m, rad, m/s */
export const REACHED = { distance: 0.01, angle: (2 * Math.PI) / 180, speed: 0.05 };

/** a point moving with bone `bone` of a body (`offset` from it, turned by `turn`), its velocity read off where it was a sub-step before */
export function movingPoint(h: { readonly pose: ReadonlyPose; readonly scale: number }, bone: number, offset: () => Placement, turn: () => Quaternion) {
  let last: { time: number; position: Vector3 } | null = null;
  const velocity = new Vector3();
  return (f: Frame) => {
    const pose = h.pose;
    const local = offset();
    const quaternion = turn();
    const position = local.position.clone().multiplyScalar(h.scale).applyQuaternion(quaternion).add(pose.position(bone));
    if (local.quaternion) quaternion.multiply(local.quaternion);
    // (read again in the same sub-step: as it was; in the next: from where it was)
    if (last && Math.abs(f.time - f.dt - last.time) < 1e-9) velocity.subVectors(position, last.position).divideScalar(f.dt);
    else if (!last || last.time !== f.time) velocity.set(0, 0, 0);
    if (!last || last.time !== f.time) last = { time: f.time, position: position.clone() };
    return { position, quaternion, velocity: velocity.clone(), carriedBy: h };
  };
}
