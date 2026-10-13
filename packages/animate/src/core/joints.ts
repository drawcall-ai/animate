/**
 * A joint of the solve: three coordinates from `d` (a bone's rotation, or the root's position
 * when it has no `bone`) and the most they may accelerate (rad/s² or m/s²).
 */
export interface Joint {
  d: number;
  cap: number;
  bone?: number;
}

/** `joint`'s acceleration from `from` to `rates` */
export const accelerationOf = ({ d }: Joint, rates: Float64Array, from: Float64Array, dt: number) =>
  Math.hypot(rates[d] - from[d], rates[d + 1] - from[d + 1], rates[d + 2] - from[d + 2]) / dt;

/** clamps `joint`'s acceleration from `from` to `rates` to its cap */
export function capJoint(joint: Joint, rates: Float64Array, from: Float64Array, dt: number): void {
  if (joint.cap === Infinity) return;
  const d = joint.d;
  const a = accelerationOf(joint, rates, from, dt);
  if (a <= joint.cap) return;
  const s = joint.cap / a;
  for (let k = d; k < d + 3; k++) rates[k] = from[k] + (rates[k] - from[k]) * s;
}

