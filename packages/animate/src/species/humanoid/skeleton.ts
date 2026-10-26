import { Vector3 } from 'three';
import type { BoneDef } from '../../kernel/skeleton';
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
 * The chains `solveChain` solves, each from its first joint to its tip: the arms from the
 * shoulder joint to the wrist and the legs from the hip to the ankle (limbs: two segments, bent
 * toward a pole), the spine from the lumbar joint to the base of the skull, the neck from its
 * base to the base of the skull.
 */
export const CHAINS = {
  leftArm: ['leftUpperArm', 'leftLowerArm', 'leftHand'],
  rightArm: ['rightUpperArm', 'rightLowerArm', 'rightHand'],
  leftLeg: ['leftUpperLeg', 'leftLowerLeg', 'leftFoot'],
  rightLeg: ['rightUpperLeg', 'rightLowerLeg', 'rightFoot'],
  spine: ['spine', 'chest', 'neck', 'head'],
  neck: ['neck', 'head'],
} satisfies Record<string, readonly BoneName[]>;


/**
 * The body's skeleton: a bone per BONES entry (in its order, so `INDEX` finds them), each at its
 * rest offset from its parent; the hips' from the root, the ground point under them. `mass`
 * defaults to `massFor` the body's height.
 */
export function skeletonOf(p: Proportions, mass = massFor(p.height)): BoneDef[] {
  return BONES.map((name) => {
    const segment = SEGMENT[name];
    const speed = snapSpeed(name);
    return {
      name,
      snap: { speed, accel: speed / 0.03 },
      parent: name === 'hips' ? -1 : INDEX[PARENT[name]],
      offset: name === 'hips' ? p.hips.clone() : p.offsets[name].clone(),
      mass: segment ? segment.mass * mass : 0,
      com: segment ? segment.com(p) : new Vector3(),
    };
  });
}

/**
 * A snap heuristic: elite joint speeds divided by 30 ms, slightly shorter than a throw's
 * ~50 ms acceleration phase (Fleisig 1999). Reuses the former run judge's ceilings;
 * these are generous fault detectors, not clinical limits. Speeds below are in °/s.
 */
function snapSpeed(name: BoneName): number {
  if (/UpperArm/.test(name)) return 7500;
  if (/LowerArm/.test(name)) return 2900;
  if (/Hand/.test(name)) return 3000;
  if (/UpperLeg/.test(name)) return 2000;
  if (/LowerLeg|Foot|Toes/.test(name)) return 2500;
  if (/Shoulder/.test(name)) return 1000;
  if (/neck|head/.test(name)) return 700;
  return 1200;
}
