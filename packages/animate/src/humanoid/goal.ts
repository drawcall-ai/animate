import { clearBody } from './hands/clearance';
import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../core/body';
import type { Placement } from '../core/goal';
import { loadFactor } from '../core/load';
import { heldMass, gripOf } from './hands/grips';
import type { Humanoid } from './humanoid';
import { INDEX, SIDES } from './bones';
import { forwardOf } from '../core/math';
import type { ReadonlyPose } from '../core/pose';

/** A placement on a bone, scaled with its body and followed from final poses. */
export function onBone<W>(h: { readonly pose: ReadonlyPose; readonly scale: number }, bone: number, local: Placement = { position: new Vector3() }) {
  return movingPoint<W>(h, bone, () => local, () => h.pose.rotation(bone).clone());
}

/** A placement at a joint, aligned with body facing instead of the joint's rotation. */
export function facingAt<W>(h: { readonly pose: ReadonlyPose; readonly scale: number; readonly gait: { facing: number } }, bone: number, local: Placement = { position: new Vector3() }) {
  return movingPoint<W>(h, bone, () => local, () => new Quaternion().setFromAxisAngle(UP, h.gait.facing));
}

function movingPoint<W>(h: { readonly pose: ReadonlyPose; readonly scale: number }, bone: number, offset: () => Placement, turn: () => Quaternion) {
  let last: { time: number; position: Vector3 } | null = null;
  const velocity = new Vector3();
  return (f: Frame<W>) => {
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

/** A comfortable carry in front of the hips, or beside one hip for a single hand; follows the body. */
export function carried<W>(h: Humanoid<W>, side?: 'left' | 'right') {
  const at = movingPoint<W>(h, 0, () => {
    // Recalled load law: shorten the lever arm with squared pace effort (35 → 19 cm at 8 kg).
    const effort = loadFactor(heldMass(h));
    return { position: new Vector3(side ? (side === 'left' ? CARRY_ASIDE : -CARRY_ASIDE) : 0, 0,
      side ? CARRY_BESIDE : CARRY_AHEAD / effort ** 2) };
  }, () => new Quaternion().setFromAxisAngle(UP, h.gait.facing));
  return (f: Frame<W>) => {
    const goal = at(f);
    // A lift rises out of its squat: its resting height follows the feet, not the lowered pelvis.
    goal.position.y = (h.feet[0].position.y + h.feet[1].position.y) / 2 + h.proportions.hipHeight + CARRY_HEIGHT * h.scale;
    if (!side) {
      // The pelvis moves behind a hinged trunk. Keep the grip envelope beyond the
      // trunk at the load's height, rather than pulling a rising load through it.
      let extent = 0;
      for (const hand of SIDES) {
        const held = h.holding[hand];
        if (held) extent = Math.max(extent, gripOf(held.item, held.grip).position.length());
      }
      const hips = h.pose.position(0), neck = h.pose.position(INDEX.neck);
      const u = Math.max(0, Math.min(1, (goal.position.y - hips.y) / Math.max(Number.EPSILON, neck.y - hips.y)));
      const trunk = hips.clone().lerp(neck, u);
      const forward = forwardOf(h.gait.facing);
      const distance = goal.position.clone().sub(trunk).dot(forward);
      goal.position.addScaledVector(forward, Math.max(0, extent + h.proportions.shoulderHalfWidth - distance));
    }
    for (const hand of SIDES) {
      const item = h.holding[hand]?.item;
      if (item && (hand === 'left' || item !== h.holding.left?.item)) clearBody(h, h.pose, item, goal.position, goal.quaternion);
    }
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
