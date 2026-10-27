import type { ReadonlyPose } from '../../kernel/pose';
import { Vector3 } from 'three';
import { INDEX, type Side } from './bones';
import type { Proportions } from './proportions';

/**
 * the palm's centre beyond the wrist, along the forearm, as a share of the standing height: ~0.4
 * of the hand's length (Drillis & Contini: 0.108), where Dempster puts the hand's centre of mass
 */
const PALM = 0.043;

/** the palm's centre in the hand bone's frame */
export function palmOf(proportions: Proportions, side: Side): Vector3 {
  return proportions.offsets[`${side}Hand`].clone().setLength(PALM * proportions.height);
}

/** The three support points of one sole, in world space: its heel (foot bone) and big and small toe tips (toes bone), the right mirroring the left's x. */
export function solePoints(proportions: Proportions, pose: ReadonlyPose, side: Side): Vector3[] {
  const { heel, bigToe, smallToe } = proportions.sole, foot = INDEX[`${side}Foot`], toes = INDEX[`${side}Toes`];
  const points: [number, Vector3][] = [[foot, heel], [toes, bigToe], [toes, smallToe]];
  return points.map(([bone, at]) => {
    const out = new Vector3(side === 'left' ? at.x : -at.x, at.y, at.z);
    return pose.point(bone, out, out);
  });
}
