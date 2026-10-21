// A person's leg, as both legs' engines read it.
import { Vector3 } from 'three';
import type { ReadonlyPose } from '../../core/pose';
import { INDEX, type Side } from '../bones';
import type { Proportions } from '../proportions';

/** a leg's chain */
export const legOf = (side: Side) => (side === 'left' ? 'leftLeg' : 'rightLeg');

/** the shank's forward tilt over a foot heading `yaw` as `pose` has the leg (rad, + the knee ahead of the ankle) */
export function shankTilt(pose: ReadonlyPose, side: Side, yaw: number): number {
  const shin = _v.subVectors(pose.position(INDEX[`${side}LowerLeg`]), pose.position(INDEX[`${side}Foot`]));
  return Math.atan2(shin.x * Math.sin(yaw) + shin.z * Math.cos(yaw), shin.y);
}

/** The shortest hip–ankle span permitted by the knee's flexion limit. */
export const foldedReach = (p: Proportions, bend: number) => Math.sqrt(p.thigh ** 2 + p.shin ** 2 + 2 * p.thigh * p.shin * Math.cos(bend));

const _v = new Vector3();
