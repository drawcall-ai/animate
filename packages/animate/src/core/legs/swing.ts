import type { Quaternion } from 'three';

/** a swing's plan, per coordinate (rad, rad/s, rad/s²) */
export interface Swing {
  /** the plan's state: lift-off to landing, minimum jerk, re-planned each tick toward the landing as it is seen then */
  x: Float64Array;
  v: Float64Array;
  a: Float64Array;
  /**
   * the landing's coordinates (the next tick's solve's warm start). The plan ends there at rest:
   * ending on the stance's own rate (C¹) was tried, and its rate at a heel strike or a breakover,
   * near a straight leg, is too steep and too noisy to aim at
   */
  land: Float64Array;
  stepping: number;
  toes: Quaternion;
}

/** the minimum-jerk quintic from `x` (`v`, `a`) to rest at `x1` in `T` s, `t` s on: its value, rate and acceleration (at or past its end: its end) */
export function quintic(x: number, v: number, a: number, x1: number, T: number, t: number): [number, number, number] {
  if (T <= t) return [x1, 0, 0];
  const d = x1 - x;
  const c = [x, v, a / 2, (20 * d - 12 * v * T - 3 * a * T * T) / (2 * T ** 3), (-30 * d + 16 * v * T + 3 * a * T * T) / (2 * T ** 4), (12 * d - 6 * v * T - a * T * T) / (2 * T ** 5)];
  return [
    c[0] + t * (c[1] + t * (c[2] + t * (c[3] + t * (c[4] + t * c[5])))),
    c[1] + t * (2 * c[2] + t * (3 * c[3] + t * (4 * c[4] + t * 5 * c[5]))),
    2 * c[2] + t * (6 * c[3] + t * (12 * c[4] + t * 20 * c[5])),
  ];
}

/** Replanning keeps the quintic's Bezier hull inside the coordinate range. */
export function boundSwing(s: Swing, j: number, T: number, lo: number, hi: number): void {
  const x = s.x[j];
  s.v[j] = Math.min(5 * (hi - x) / T, Math.max(5 * (lo - x) / T, s.v[j]));
  const p2 = x + 2 * s.v[j] * T / 5;
  s.a[j] = Math.min(20 * (hi - p2) / (T * T), Math.max(20 * (lo - p2) / (T * T), s.a[j]));
}

