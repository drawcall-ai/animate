import { Quaternion, Vector3 } from 'three';
import type { Side } from '../../species/humanoid/bones';
import { quatYXZ } from '../../kernel/math';
import type { Proportions } from '../../species/humanoid/proportions';

/** half a foot's width at the toes (m, default body): how far past the ankle's line a foot holds the body sideways */
const FOOT_HALF_WIDTH = 0.04;

/** the heel (on the sole) in the foot bone's frame */
export const heelOf = (proportions: Proportions, out = new Vector3()) => out.copy(proportions.sole.heel);

/** the ball of the foot (the toes bone's origin) in the foot bone's frame */
export const ballOf = (proportions: Proportions, side: Side, out = new Vector3()) => out.copy(proportions.offsets[`${side}Toes`]);

/** a foot heading `yaw`, pitched by `pitch` (+ toes up, − heel up), as a world rotation */
export const footRotation = (yaw: number, pitch: number, out = new Quaternion()) => quatYXZ(yaw, -pitch, 0, out);

/**
 * The ankle of a foot standing flat with its ankle at `anchor`, heading `yaw`, rolled by `pitch`
 * about its heel (pitch > 0, toes up) or its ball (pitch < 0, heel up).
 */
export function ankleFor(proportions: Proportions, side: Side, anchor: Readonly<Vector3>, yaw: number, pitch: number, out = new Vector3()): Vector3 {
  const local = pitch >= 0 ? heelOf(proportions, _pivot) : ballOf(proportions, side, _pivot);
  const world = _world.copy(local).applyQuaternion(footRotation(yaw, 0, _q)).add(anchor);
  return out.copy(local).applyQuaternion(footRotation(yaw, pitch, _q)).negate().add(world);
}

/** the corners of a flat foot's footprint on the floor (x, z): the heel, the toe edge's two ends */
export function footprint(proportions: Proportions, ankle: Readonly<Vector3>, yaw: number): [number, number][] {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const w = FOOT_HALF_WIDTH * proportions.scale;
  return [
    [ankle.x - fx * proportions.heelBack, ankle.z - fz * proportions.heelBack],
    [ankle.x + fx * proportions.toeFront + fz * w, ankle.z + fz * proportions.toeFront - fx * w],
    [ankle.x + fx * proportions.toeFront - fz * w, ankle.z + fz * proportions.toeFront + fx * w],
  ];
}

const _pivot = new Vector3();
const _world = new Vector3();
const _q = new Quaternion();
