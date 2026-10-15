import { Quaternion, Vector3 } from 'three';
import type { Side } from '../bones';
import { clamp, lerp, quatYXZ } from '../../core/math';
import type { Proportions } from '../proportions';

/** planted: bearing weight on the floor; swing: stepping */
export type FootPhase = 'planted' | 'swing';

/** Where a foot stands or, swinging, lands: its flat-foot ankle and heading. */
export interface Foot {
  position: Vector3;
  yaw: number;
  phase: FootPhase;
}

/** half a foot's width at the toes (m, default body): how far past the ankle's line a foot holds the body sideways */
export const FOOT_HALF_WIDTH = 0.04;

/** the heel (on the sole) in the foot bone's frame */
export const heelOf = (p: Proportions, out = new Vector3()) => out.copy(p.sole.heel);

/** the ball of the foot (the toes bone's origin) in the foot bone's frame */
export const ballOf = (p: Proportions, side: Side, out = new Vector3()) => out.copy(p.offsets[`${side}Toes`]);

/** the toe tip in the foot bone's frame (the toes in line with the foot) */
export const toeTipOf = (p: Proportions, out = new Vector3()) => out.set(0, -0.85 * p.ankleHeight, p.toeFront);

/** a foot heading `yaw`, pitched by `pitch` (+ toes up, − heel up), as a world rotation */
export const footRotation = (yaw: number, pitch: number, out = new Quaternion()) => quatYXZ(yaw, -pitch, 0, out);

/**
 * The ankle of a foot standing flat with its ankle at `anchor`, heading `yaw`, rolled by `pitch`
 * about its heel (pitch > 0, toes up) or its ball (pitch < 0, heel up). (From the old core's
 * GaitFoot.ankleFor.)
 */
export function ankleFor(p: Proportions, side: Side, anchor: Readonly<Vector3>, yaw: number, pitch: number, out = new Vector3()): Vector3 {
  const local = pitch >= 0 ? heelOf(p, _pivot) : ballOf(p, side, _pivot);
  const world = _world.copy(local).applyQuaternion(footRotation(yaw, 0, _q)).add(anchor);
  return out.copy(local).applyQuaternion(footRotation(yaw, pitch, _q)).negate().add(world);
}

/** the corners of a flat foot's footprint on the floor (x, z): the heel, the toe edge's two ends */
export function footprint(p: Proportions, ankle: Readonly<Vector3>, yaw: number): [number, number][] {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const w = FOOT_HALF_WIDTH * p.scale;
  return [
    [ankle.x - fx * p.heelBack, ankle.z - fz * p.heelBack],
    [ankle.x + fx * p.toeFront + fz * w, ankle.z + fz * p.toeFront - fx * w],
    [ankle.x + fx * p.toeFront - fz * w, ankle.z + fz * p.toeFront + fx * w],
  ];
}

/**
 * How far along its path (0 → 1) a swinging foot is at swing progress `s`: slow off the floor,
 * fastest late, slowing into the heel strike (CMU mocap: 0.18 at s = 0.3, 0.39 at 0.5, 0.8 at 0.8).
 */
export const swingProgress = (s: number) => s + s * (1 - s) * (-0.66 - 0.78 * s + 2.44 * s * s);

/** the ankle's rise above its straight path at swing progress `s`, peak 1, as the knee flexes (CMU mocap: walking peaks at s ≈ 0.38, running at 0.47) */
export function swingHump(s: number, run: number): number {
  const t = clamp(s, 0, 1);
  const a = lerp(1.5, 1.7, run);
  const b = lerp(2.5, 1.9, run);
  const top = a / (a + b);
  return (Math.pow(t, a) * Math.pow(1 - t, b)) / (Math.pow(top, a) * Math.pow(1 - top, b));
}


const _pivot = new Vector3();
const _world = new Vector3();
const _q = new Quaternion();
