import { Quaternion, Vector3 } from 'three';
import type { ReadonlyPose } from './pose';
import type { ReusableTimeline, UntilCondition } from '@pmndrs/timeline';
import type { Frame } from './body';
import type { Placed } from './carrier';

/** A behaviour: a timeline a body steps every sub-step, writing its pose. */
export type Behaviour = ReusableTimeline<Frame>;

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
  /** the goal (and its velocity) is in this carrier's frame, placed so at the step's time and the two before (its `at`): the value is followed relative to it */
  on?: Placed;
};

/** When a goal-following behaviour ends: a condition, or once it has `'reached'` its goal (within 1 cm and 2°, under 5 cm/s off its velocity). */
export type Until = UntilCondition<Frame> | 'reached';

/** what `'reached'` allows: m, rad, m/s */
export const REACHED = { distance: 0.01, angle: (2 * Math.PI) / 180, speed: 0.05 };

/** A placement on a bone, scaled with its body and followed from final poses. */
export function onBone(h: { readonly pose: ReadonlyPose; readonly scale: number }, bone: number, local: Placement = { position: new Vector3() }) {
  return movingPoint(h, bone, () => local, () => h.pose.rotation(bone).clone());
}

/** A placement at a joint, aligned with body facing instead of the joint's rotation. */
export function facingAt(h: { readonly pose: ReadonlyPose; readonly scale: number; readonly locomotion: { facing: number } }, bone: number, local: Placement = { position: new Vector3() }) {
  return movingPoint(h, bone, () => local, () => new Quaternion().setFromAxisAngle(UP, h.locomotion.facing));
}

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
    return { position, quaternion, velocity: velocity.clone() };
  };
}

const UP = new Vector3(0, 1, 0);
