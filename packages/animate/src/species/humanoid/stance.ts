import { Vector3 } from 'three';
import { leftOf } from '../../kernel/math';
import type { Proportions } from './proportions';
import type { Stance } from '../../kernel/go';

/** feet about hip-width apart, turned out a little (heels 0.10–0.15 of the height apart, 0–12°) */
export const defaultStance = (proportions: Proportions): Stance => ({ width: 0.065 * proportions.height, stagger: 0, crouch: 0, blade: 0, toeOut: 0.12 });

/** where the centre of mass stands at rest: this far ahead of the ankles (m, default body), over the feet's rear half */
export const OVER_ANKLES = 0.03;

/** where a person standing in its default stance at the ground point (x, z) facing `yaw` has its flat feet: each ankle and heading, left first */
export function standingFeet(proportions: Proportions, x: number, z: number, yaw: number): { position: Vector3; yaw: number }[] {
  const { width, toeOut } = defaultStance(proportions), left = leftOf(yaw);
  return [1, -1].map((side) => ({
    position: new Vector3(x + left.x * side * width, proportions.ankleHeight, z + left.z * side * width),
    yaw: yaw + side * toeOut,
  }));
}
