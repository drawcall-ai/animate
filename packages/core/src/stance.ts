import type { Vector3 } from 'three';
import type { Proportions } from './proportions';

/** How the body stands when nothing else asks for more: foot placement and readiness. */
export interface Stance {
  /** half distance between the ankles, sideways (m) */
  width: number;
  /** left foot forward (+) / back (−) relative to the right foot (m) */
  stagger: number;
  /** preferred pelvis drop (m) — bent-knee ready stance */
  crouch: number;
  /** pelvis/feet yaw relative to the facing (rad), e.g. a bladed fighting stance */
  blade: number;
  /** toe-out per foot (rad) */
  toeOut: number;
  /** keep idle hands up in a guard near the chin */
  guard: boolean;
}

export const defaultStance = (d: Proportions): Stance => ({
  width: 0.065 * d.height,
  stagger: 0,
  crouch: 0,
  blade: 0,
  toeOut: 0.12,
  guard: false,
});

/** Home ankle positions (flat foot) for a support centre and its facing (`forward`, `left`), the ankles `width` apart. */
export function stanceFeet(x: number, z: number, forward: Vector3, left: Vector3, d: Proportions, stance: Stance, out: [Vector3, Vector3], width = stance.width) {
  for (let s = 0; s < 2; s++) {
    const side = s === 0 ? 1 : -1;
    const across = side * width;
    const along = side * stance.stagger * 0.5;
    out[s].set(x + left.x * across + forward.x * along, d.ankleHeight + left.y * across + forward.y * along, z + left.z * across + forward.z * along);
  }
}

/** Yaw a planted foot of `side` has when the body faces `yaw`. */
export const footYaw = (yaw: number, side: 1 | -1, stance: Stance) => yaw + stance.blade + side * stance.toeOut;

/** The body facing a planted foot of `side` with yaw `foot` stands for (inverse of `footYaw`). */
export const bodyYaw = (foot: number, side: 1 | -1, stance: Stance) => foot - stance.blade - side * stance.toeOut;
