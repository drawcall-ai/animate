// Copied from the old core (a801be4:packages/core/src/stance.ts).
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
