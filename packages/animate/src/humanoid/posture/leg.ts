// A person's leg, as the legs read it.
import { Quaternion, Vector3 } from 'three';
import { forwardOf, wrapAngle } from '../../core/math';
import type { ReadonlyPose } from '../../core/pose';
import { INDEX, type Side } from '../bones';

/** a leg's chain */
export const legOf = (side: Side) => (side === 'left' ? 'leftLeg' : 'rightLeg');

/** the shank's forward tilt over a foot heading `yaw` as `pose` has the leg (rad, + the knee ahead of the ankle) */
export function shankTilt(pose: ReadonlyPose, side: Side, yaw: number): number {
  const shin = _v.subVectors(pose.position(INDEX[`${side}LowerLeg`]), pose.position(INDEX[`${side}Foot`]));
  return Math.atan2(shin.x * Math.sin(yaw) + shin.z * Math.cos(yaw), shin.y);
}

/**
 * Where a leg's knee bends (a direction, into `out`): over the toes (the foot's heading `yaw`
 * blended with the body's `facing`); a leg raised forward bends with the knee up, one raised out
 * sideways carries it along.
 */
export function kneePole(side: Side, yaw: number, facing: number, hip: Vector3, ankle: Vector3, out: Vector3): Vector3 {
  // (halfway round from the facing to the foot's heading: a sum of the two would vanish for a foot turned far round)
  forwardOf(facing + 0.5 * wrapAngle(yaw - facing), out);
  const leg = _leg.subVectors(ankle, hip).normalize();
  const outward = _out.crossVectors(UP, out).multiplyScalar(side === 'left' ? 1 : -1);
  const abducted = Math.max(0, leg.dot(outward));
  out.y = 0.15 + 2.5 * Math.max(0, leg.dot(out) + 0.2);
  return out.applyQuaternion(_arc.setFromUnitVectors(DOWN, _v.set(0, -Math.sqrt(1 - abducted * abducted), 0).addScaledVector(outward, abducted))).normalize();
}

const UP = new Vector3(0, 1, 0);
const DOWN = new Vector3(0, -1, 0);
const _leg = new Vector3();
const _out = new Vector3();
const _arc = new Quaternion();
const _v = new Vector3();
