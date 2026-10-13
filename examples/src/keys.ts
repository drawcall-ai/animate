import { Vector3 } from 'three';
import type { Frame, World } from '@drawcall/animate';

/** Flash & Hogan's minimum-jerk profile, `t` in [0, 1] */
export function minimumJerk(t: number): number {
  const s = Math.min(1, Math.max(0, t));
  return s * s * s * (10 - 15 * s + 6 * s * s);
}

/**
 * A point going from `from` through `via` to `to` in `duration` s from when it is first read: one
 * smooth curve (a quadratic Bézier through `via` halfway), at rest at its ends (minimum jerk); it
 * stays at `to`. Into `out`.
 */
export function path(from: Vector3, via: Vector3, to: Vector3, duration: number, out = new Vector3()): (f: Frame<World>) => Vector3 {
  let start = -1;
  // (the control point that puts the curve's middle on `via`)
  const control = via.clone().multiplyScalar(2).addScaledVector(from, -0.5).addScaledVector(to, -0.5);
  return (f) => {
    if (start < 0) start = f.time;
    const s = minimumJerk((f.time - start) / duration);
    return out
      .copy(from)
      .multiplyScalar((1 - s) * (1 - s))
      .addScaledVector(control, 2 * s * (1 - s))
      .addScaledVector(to, s * s);
  };
}
