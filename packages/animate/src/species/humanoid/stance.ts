import type { Vector3 } from 'three';
import type { Proportions } from './proportions';
import type { Stance } from '../../kernel/go';

/** feet about hip-width apart, turned out a little (heels 0.10–0.15 of the height apart, 0–12°) */
export const defaultStance = (p: Proportions): Stance => ({ width: 0.065 * p.height, stagger: 0, crouch: 0, blade: 0, toeOut: 0.12 });

/** the stance's flat-foot ankles [left, right] around the ground point (x, z) for a body facing `forward` (its `left`), `width` either side */
export function stanceFeet(x: number, z: number, forward: Vector3, left: Vector3, p: Proportions, stance: Stance, out: [Vector3, Vector3], width = stance.width) {
  for (let s = 0; s < 2; s++) {
    const side = s === 0 ? 1 : -1;
    const across = side * width;
    const along = side * stance.stagger * 0.5;
    out[s].set(x + left.x * across + forward.x * along, p.ankleHeight, z + left.z * across + forward.z * along);
  }
}

/** where the centre of mass stands at rest: this far ahead of the ankles (m, default body), over the feet's rear half */
export const OVER_ANKLES = 0.03;

/** the heading of a planted foot of `side` (1 left, −1 right) when the body faces `yaw` */
export const footYaw = (yaw: number, side: 1 | -1, stance: Stance) => yaw + stance.blade + side * stance.toeOut;

