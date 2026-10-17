import type { Quaternion } from 'three';
import { minimumJerk } from '../math';

/** The horizontal root-frame path and world sole height (m, m/s, m/s²), plus its joint references. */
export interface Swing {
  /** the plan's state: lift-off to landing, minimum jerk, re-planned each tick toward the landing as it is seen then */
  x: Float64Array;
  v: Float64Array;
  a: Float64Array;
  /** lift-off and landing joint coordinates (rad) */
  land: Float64Array;
  from: Float64Array;
  fold: Float64Array;
  turn: Quaternion;
  toes: Quaternion;
}

/** the minimum-jerk quintic from `x` (`v`, `a`) to `x1` at rate `v1` and zero acceleration in `T` s, `t` s on: its value, rate and acceleration (at or past its end: its end) */
export function quintic(x: number, v: number, a: number, x1: number, v1: number, T: number, t: number): [number, number, number] {
  if (T <= t) return [x1, v1, 0];
  const d = x1 - x;
  const c = [x, v, a / 2, (20 * d - (12 * v + 8 * v1) * T - 3 * a * T * T) / (2 * T ** 3), (-30 * d + (16 * v + 14 * v1) * T + 3 * a * T * T) / (2 * T ** 4), (12 * d - (6 * v + 6 * v1) * T - a * T * T) / (2 * T ** 5)];
  return [
    c[0] + t * (c[1] + t * (c[2] + t * (c[3] + t * (c[4] + t * c[5])))),
    c[1] + t * (2 * c[2] + t * (3 * c[3] + t * (4 * c[4] + t * 5 * c[5]))),
    2 * c[2] + t * (6 * c[3] + t * (12 * c[4] + t * 20 * c[5])),
  ];
}

/** C² lift, peaking at 30% of swing with a longer terminal descent. */
export const loft = (s: number) => s < 0.3 ? minimumJerk(s / 0.3) : 1 - minimumJerk((s - 0.3) / 0.7);
