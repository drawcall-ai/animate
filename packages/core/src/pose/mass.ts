import type { Vector3 } from 'three';
import type { Joints } from './pose';

/**
 * Segment mass fractions (Dempster) of the centre-of-mass estimates: head, abdomen and
 * thorax, each arm and leg, and the pelvis with the thighs' share the trunk carries.
 */
export const MASS = { head: 0.081, spine: 0.25, chest: 0.247, arm: 0.05, leg: 0.161, pelvis: 0.2 };

/** where a limb's mass sits, from its root joint toward its end (Dempster) */
const LIMB_CENTRE = 0.4;

/** The posed body's centre of mass: head (between the ears), trunk, arms and legs, into `out`. */
export function centreOfMass(j: Joints, out: Vector3): Vector3 {
  out.set(0, 0, 0);
  out.addScaledVector(j.leftEar, 0.5 * MASS.head).addScaledVector(j.rightEar, 0.5 * MASS.head);
  out.addScaledVector(j.spine, MASS.spine).addScaledVector(j.chest, MASS.chest);
  limb(out, j.leftUpperArm, j.leftHand, MASS.arm);
  limb(out, j.rightUpperArm, j.rightHand, MASS.arm);
  limb(out, j.leftUpperLeg, j.leftFoot, MASS.leg);
  return limb(out, j.rightUpperLeg, j.rightFoot, MASS.leg);
}

function limb(out: Vector3, root: Vector3, end: Vector3, mass: number): Vector3 {
  const k = mass * LIMB_CENTRE;
  out.x += root.x * (mass - k) + end.x * k;
  out.y += root.y * (mass - k) + end.y * k;
  out.z += root.z * (mass - k) + end.z * k;
  return out;
}
