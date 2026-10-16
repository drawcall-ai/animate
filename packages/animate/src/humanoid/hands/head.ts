import { Quaternion, Vector3 } from 'three';
import type { ReadonlyPose } from '../../core/pose';
import { clampRotation } from '../../core/limits';
import { NECK_EXTENSION } from '../profile/limits';
import { INDEX } from '../bones';
import type { Humanoid } from '../humanoid';
import { gripOf, heldItems } from './grips';

// Recalled conservative head radius (share of stature); tuned 4 cm reserve for gaze-following lag.
const HEAD_RADIUS = 0.06;
const RESERVE = 0.04;
const BONES = [INDEX.neck, INDEX.head];

/** Keep the gaze goal behind held loads' grip envelopes as they rise past the face.
 * The held grips bound loads below the neck; headwear raised above it can pass over the crown.
 * The gaze follower owns the actual head motion, so entering and leaving clearance cannot snap the cervical chain.
 */
export function clearHead<W>(h: Humanoid<W>, pose: ReadonlyPose, goal: Quaternion): void {
  const loads = heldItems(h).filter((item) => !item.wornBy).map((item) => {
    const grips = Object.values(h.holding).flatMap((held) => held?.item === item
      ? [gripOf(item, held.grip).position.clone().applyQuaternion(item.current.quaternion).add(item.current.position)] : []);
    const at = grips.reduce((sum, grip) => sum.add(grip), new Vector3()).divideScalar(grips.length);
    return { at, radius: Math.max(...grips.map((grip) => grip.distanceTo(at))) };
  }).filter(({ at }) => at.y < pose.position(INDEX.neck).y);
  if (!loads.length) return;
  const parent = pose.rotation(INDEX.chest);
  const local = parent.clone().invert().multiply(goal);
  const back = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -NECK_EXTENSION * Math.PI / 180);
  const clear = (rotation: Quaternion) => {
    const share = new Quaternion().identity().slerp(rotation, 1 / BONES.length);
    const turn = parent.clone();
    const head = pose.position(INDEX.neck).clone();
    for (const [i, bone] of BONES.entries()) {
      if (i > 0) head.add(pose.skeleton.bones[bone].offset.clone().applyQuaternion(turn));
      const joint = share.clone();
      const limit = pose.skeleton.limits[bone];
      if (limit) clampRotation(joint, limit);
      turn.multiply(joint);
    }
    head.add(h.proportions.headCenter.clone().applyQuaternion(turn));
    return loads.every(({ at, radius }) => head.distanceTo(at) >= radius + HEAD_RADIUS * h.proportions.height + RESERVE * h.scale);
  };
  if (clear(local)) return;
  let lo = 0, hi = 1;
  if (clear(back)) {
    // Numerical angular search to a fraction of a degree.
    for (let pass = 0; pass < 10; pass++) {
      const middle = (lo + hi) / 2;
      if (clear(local.clone().slerp(back, middle))) hi = middle;
      else lo = middle;
    }
  }
  goal.copy(parent).multiply(local.slerp(back, hi));
}
