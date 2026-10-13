import { Quaternion, Vector3 } from 'three';
import { BodyState } from '../core/state';
import { INDEX, SIDES } from './bones';
import { footRotation } from './gait/foot';
import { forwardOf, leftOf } from './math';
import { createLegPose, legPose } from './procedures/legs';
import { relaxedPose } from './profile/relaxed';
import type { Proportions } from './proportions';
import type { Rig } from './rig';
import { footYaw, stanceFeet, type Stance } from './stance';

/** how far the legs reach standing (× their length): the stand's own */
export const STANDING_REACH = 0.995;

/** A body standing: its state, and each foot's ankle and heading. */
export interface Start {
  state: BodyState;
  feet: [{ position: Vector3; yaw: number }, { position: Vector3; yaw: number }];
}

/**
 * The body standing relaxed in `stance` at `floor`, facing `yaw`, as the stand holds it: the
 * feet flat where the stance puts them, the pelvis as high as they reach, the legs posed down to
 * them, the rest in the relaxed pose.
 */
export function standing(rig: Rig, p: Proportions, stance: Stance, floor: Vector3, yaw: number): Start {
  const state = new BodyState(rig.skeleton);
  for (const { bone, rotation } of relaxedPose()) state.local[bone].copy(rotation);
  const pelvis = state.local[0].setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  state.position.set(0, p.hipHeight - stance.crouch, 0).add(floor);
  state.derive();
  const ankles: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  stanceFeet(floor.x, floor.z, forwardOf(yaw), leftOf(yaw), p, stance, ankles);
  // (no higher than the legs reach)
  const reach = STANDING_REACH * p.legLength;
  for (const [s, side] of SIDES.entries()) {
    const hip = state.positions[INDEX[`${side}UpperLeg`]];
    const across = (hip.x - ankles[s].x) ** 2 + (hip.z - ankles[s].z) ** 2;
    state.position.y = Math.min(state.position.y, ankles[s].y + Math.sqrt(reach * reach - across) + state.position.y - hip.y);
  }
  state.derive();
  const pose = createLegPose();
  const feet = SIDES.map((side, s) => {
    const heading = footYaw(yaw, s === 0 ? 1 : -1, stance);
    const foot = footRotation(heading, 0, new Quaternion());
    legPose(p, side, pelvis, state.positions[INDEX[`${side}UpperLeg`]], ankles[s], foot, foot, yaw, pose);
    state.local[INDEX[`${side}UpperLeg`]].copy(pose.upper);
    state.local[INDEX[`${side}LowerLeg`]].copy(pose.lower);
    state.local[INDEX[`${side}Foot`]].copy(pose.foot);
    state.local[INDEX[`${side}Toes`]].copy(pose.toes);
    return { position: ankles[s], yaw: heading };
  });
  state.derive();
  return { state, feet: [feet[0], feet[1]] };
}
