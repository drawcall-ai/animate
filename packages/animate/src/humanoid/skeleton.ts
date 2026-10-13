import { Vector3 } from 'three';
import type { BoneDef } from '../core/types';
import { BONES, INDEX, PARENT, type BoneName } from './bones';
import { palmOf } from './landmarks';
import type { Proportions } from './proportions';

/** body mass for a standing height (kg): a body mass index of 22, mid normal weight */
export const massFor = (height: number) => 22 * height * height;

/**
 * Each bone's segment (Dempster, as tabled by Winter 2009): its share of the body's mass, and
 * where its centre of mass sits as a share of the way from the bone's origin to its child's (or a
 * point of its own). Bones of no segment of their own (the neck: the head's segment is head and
 * neck; the clavicles: in the thorax; the toes: in the foot) carry none.
 * - pelvis (hips): 0.142, near the lumbosacral end of its span down to the hip joints
 * - abdomen (spine, up to the chest): 0.139 at 0.56 of its way up
 * - thorax (chest, up to the neck): 0.216 at 0.18 of its way up
 * - head and neck: 0.081 at the skull's centre
 * - upper arm 0.028 at 0.436, forearm 0.016 at 0.430, hand 0.006 at the palm's centre
 * - thigh 0.100 at 0.433, shank 0.0465 at 0.433, foot 0.0145 halfway from the ankle to the ball
 */
const SEGMENT: Partial<Record<BoneName, { mass: number; com: (p: Proportions) => Vector3 }>> = {
  hips: { mass: 0.142, com: (p) => p.offsets.spine.clone().multiplyScalar(0.895) },
  spine: { mass: 0.139, com: (p) => p.offsets.chest.clone().multiplyScalar(0.56) },
  chest: { mass: 0.216, com: (p) => p.offsets.neck.clone().multiplyScalar(0.18) },
  head: { mass: 0.081, com: (p) => p.headCenter.clone() },
};
for (const s of ['left', 'right'] as const) {
  SEGMENT[`${s}UpperArm`] = { mass: 0.028, com: (p) => p.offsets[`${s}LowerArm`].clone().multiplyScalar(0.436) };
  SEGMENT[`${s}LowerArm`] = { mass: 0.016, com: (p) => p.offsets[`${s}Hand`].clone().multiplyScalar(0.43) };
  SEGMENT[`${s}Hand`] = { mass: 0.006, com: (p) => palmOf(p, s) };
  SEGMENT[`${s}UpperLeg`] = { mass: 0.1, com: (p) => p.offsets[`${s}LowerLeg`].clone().multiplyScalar(0.433) };
  SEGMENT[`${s}LowerLeg`] = { mass: 0.0465, com: (p) => p.offsets[`${s}Foot`].clone().multiplyScalar(0.433) };
  SEGMENT[`${s}Foot`] = { mass: 0.0145, com: (p) => p.offsets[`${s}Toes`].clone().multiplyScalar(0.5) };
}

/**
 * The body's skeleton: a bone per BONES entry (in its order, so `INDEX` finds them), each at its
 * rest offset from its parent; the hips' from the root, the ground point under them. `mass`
 * defaults to `massFor` the body's height.
 */
export function skeletonOf(p: Proportions, mass = massFor(p.height)): BoneDef[] {
  return BONES.map((name) => {
    const segment = SEGMENT[name];
    return {
      name,
      parent: name === 'hips' ? -1 : INDEX[PARENT[name]],
      offset: name === 'hips' ? p.hips.clone() : p.offsets[name].clone(),
      mass: segment ? segment.mass * mass : 0,
      com: segment ? segment.com(p) : new Vector3(),
    };
  });
}
