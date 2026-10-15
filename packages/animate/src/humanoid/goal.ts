import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../core/body';
import type { Placement } from '../core/goal';
import type { Humanoid } from './humanoid';
import type { ReadonlyPose } from '../core/pose';

/** A placement on a bone, scaled with its body and followed from final poses. */
export function onBone<W>(h: { readonly pose: ReadonlyPose; readonly scale: number }, bone: number, local: Placement) {
  return movingPoint<W>(h, bone, local, () => h.pose.rotation(bone).clone());
}

/** A placement at a joint, aligned with body facing instead of the joint's rotation. */
export function facingAt<W>(h: { readonly pose: ReadonlyPose; readonly scale: number; readonly gait: { facing: number } }, bone: number, local: Placement) {
  return movingPoint<W>(h, bone, local, () => new Quaternion().setFromAxisAngle(UP, h.gait.facing));
}

function movingPoint<W>(h: { readonly pose: ReadonlyPose; readonly scale: number }, bone: number, local: Placement, turn: () => Quaternion) {
  let last: { time: number; position: Vector3 } | null = null;
  const velocity = new Vector3();
  return (f: Frame<W>) => {
    const pose = h.pose;
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

/** A comfortable carry in front of the hips, or beside one hip for a single hand; follows the body. */
export function carried<W>(h: Humanoid<W>, side?: 'left' | 'right') {
  const at = facingAt<W>(h, 0, { position: new Vector3(side ? (side === 'left' ? CARRY_ASIDE : -CARRY_ASIDE) : 0, 0, side ? CARRY_BESIDE : CARRY_AHEAD) });
  return (f: Frame<W>) => {
    const goal = at(f);
    // A lift rises out of its squat: its resting height follows the feet, not the lowered pelvis.
    goal.position.y = (h.feet[0].position.y + h.feet[1].position.y) / 2 + h.proportions.hipHeight + CARRY_HEIGHT * h.scale;
    goal.velocity.y = 0;
    return goal;
  };
}

// Tuned carry staging (metres at default stature): clear the thighs, and leave room for a two-hand load.
const CARRY_ASIDE = 0.24;
const CARRY_BESIDE = 0.22;
const CARRY_AHEAD = 0.35;
// Tuned lift staging: carry 12 cm above standing hip height, independent of the pelvis's squat.
const CARRY_HEIGHT = 0.12;
