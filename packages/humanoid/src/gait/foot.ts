import { Quaternion, Vector3 } from 'three';
import type { Side } from '../bones';
import { quatYXZ } from '../math';
import type { Proportions } from '../proportions';

/** half a foot's width at the toes (m, default body): how far past the ankle's line a foot holds the body sideways */
export const FOOT_HALF_WIDTH = 0.04;

const _pivot = new Vector3();
const _q = new Quaternion();

/** the heel (on the sole) in the foot bone's frame */
export const heelOf = (p: Proportions, out = new Vector3()) => out.copy(p.sole.heel);

/** the ball of the foot (the toes bone's origin, on the sole) in the foot bone's frame */
export const ballOf = (p: Proportions, side: Side, out = new Vector3()) => out.copy(p.offsets[`${side}Toes`]);

/** the toe tip, about where the big toe ends, in the foot bone's frame (the toes in line with the foot) */
export const toeTipOf = (p: Proportions, out = new Vector3()) => out.set(0, -0.85 * p.ankleHeight, p.toeFront);

/** a foot heading `yaw`, pitched by `pitch` (+ toes up, − heel up) */
export const footRotation = (yaw: number, pitch: number, out = new Quaternion()) => quatYXZ(yaw, -pitch, 0, out);

// Copied from @prohuman/core (packages/core/src/gait/foot.ts: GaitFoot.ankleFor).
/**
 * The ankle of a foot standing flat with its ankle at `anchor`, heading `yaw`, rolled by `pitch`
 * about its heel (pitch > 0, toes up) or its ball (pitch < 0, heel up).
 */
export function ankleFor(p: Proportions, side: Side, anchor: Vector3, yaw: number, pitch: number, out = new Vector3()): Vector3 {
  const local = pitch >= 0 ? heelOf(p, _pivot) : ballOf(p, side, _pivot);
  const world = local.clone().applyQuaternion(footRotation(yaw, 0, _q)).add(anchor);
  return out.copy(local).applyQuaternion(footRotation(yaw, pitch, _q)).negate().add(world);
}

/** the corners of a flat foot's footprint (x, z on the floor): the heel, the toe edge's two ends */
export function footprint(p: Proportions, ankle: Vector3, yaw: number): [number, number][] {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const w = FOOT_HALF_WIDTH * p.scale;
  return [
    [ankle.x - fx * p.heelBack, ankle.z - fz * p.heelBack],
    [ankle.x + fx * p.toeFront + fz * w, ankle.z + fz * p.toeFront - fx * w],
    [ankle.x + fx * p.toeFront - fz * w, ankle.z + fz * p.toeFront + fx * w],
  ];
}
