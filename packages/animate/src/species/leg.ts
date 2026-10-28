// What a leg is: data the stepper and the posers share.
import type { Vector3 } from 'three';
import type { JointCycle } from './cycle';

/** A leg: a connected chain of joints from its top (a hip, a shoulder) to its foot, and the foot's geometry. Ranges come from the pose's skeleton. */
export interface LegChain<Bone = number, Point = Vector3> {
  /**
   * each joint, top first, the last the foot: the axes it turns about, of `y` (twist), `z` (sideways), `x` (fore and aft), in
   * that order (`'yzx'` a ball joint, `'x'` a hinge, `'zx'` a foot that also tilts sideways); `cycle` the reference its `x`
   * angle follows over a stride (omitted: its rest)
   */
  joints: readonly { bone: Bone; axes: string; cycle?: JointCycle }[];
  /** the sole's back and front, where they touch the floor, in the foot bone's frame (m) */
  heel: Point;
  toe: Point;
  /** a toes bone after the foot, and its tip in that bone's frame */
  toes?: { bone: Bone; tip: Point };
  /** how far the foot turns out from the facing (rad) */
  toeOut: number;
  /** Terminal pitch through stance, degrees, positive toes up. */
  rocker: readonly (readonly [number, number])[];
}
