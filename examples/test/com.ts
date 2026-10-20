import { Vector3 } from 'three';
import { massFor } from '../../packages/animate/src/humanoid/skeleton';
import { jointOf } from '../src/joints';
import type { Actor } from './frame';

/** the body's joints by name */
type Joints = (name: string) => Vector3;

/** a limb's mass centre: 40 % of the way from its root joint to its end (Dempster) */
const along = (j: Joints, a: string, b: string) => j(a).lerp(j(b), 0.4);

/**
 * Segment mass fractions after Dempster (they sum to 1): head, abdomen, thorax, each arm and leg.
 * Deliberately independent of the body's own estimate (the humanoid's `skeletonOf` masses): the
 * head sits at the skull centre from the head bone's rotation rather than between the ears,
 * so a mistake in either shows up as disagreement instead of agreeing with itself.
 */
const SEGMENTS: [mass: number, at: (j: Joints, skull: Vector3) => Vector3][] = [
  [0.081, (_, skull) => skull],
  [0.25, (j) => j('spine')],
  [0.247, (j) => j('chest')],
  [0.05, (j) => along(j, 'leftUpperArm', 'leftHand')],
  [0.05, (j) => along(j, 'rightUpperArm', 'rightHand')],
  [0.161, (j) => along(j, 'leftUpperLeg', 'leftFoot')],
  [0.161, (j) => along(j, 'rightUpperLeg', 'rightFoot')],
];

/**
 * the body's centre of mass: the mass-weighted mean of its segments (Dempster's, from the posed
 * joints, its mass a body mass index of 22's) and of what it bears of the items it holds and wears
 * (each where its centre is). Summed relative to the hips, so the result does not depend on where in the world the
 * body stands.
 */
export function comOf(h: Actor): Vector3 {
  const j: Joints = (name) => jointOf(h, name);
  const hips = j('hips');
  // (the OpenPose skeleton's bone frames are the normalized ones the proportions are given in)
  const head = h.model.scene.getObjectByName('head');
  if (!head) throw new Error('no head');
  const skull = head.localToWorld(h.proportions.headCenter.clone());
  const sum = new Vector3();
  const offset = new Vector3();
  let total = 0;
  const body = massFor(h.proportions.height);
  for (const [share, at] of SEGMENTS) {
    sum.addScaledVector(offset.subVectors(at(j, skull), hips), share * body);
    total += share * body;
  }
  for (const [item, { kg }] of h.borne) {
    const centre = item.centre.clone().applyQuaternion(item.current.quaternion).add(item.current.position);
    sum.addScaledVector(offset.subVectors(centre, hips), kg);
    total += kg;
  }
  return sum.divideScalar(total).add(hips);
}

