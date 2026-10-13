// Copied from @prohuman/core (packages/core/src/gait/foot.ts: swingProgress, swingHump).
import { clamp, lerp, minimumJerk } from '../math';

/**
 * How far along its path (0 → 1) a swinging foot is at swing progress `s`: slow as it leaves
 * the floor, fastest late, slowing into the heel strike (CMU mocap from the toes leaving the
 * floor, walking and running alike: 0.18 at s = 0.3, 0.39 at 0.5, 0.8 at 0.8). Stepping
 * `over` something, the foot is carried over it early, then set down.
 */
export const swingProgress = (s: number, over: boolean) => (over ? minimumJerk(Math.pow(s, 0.8)) : s + s * (1 - s) * (-0.66 - 0.78 * s + 2.44 * s * s));

/**
 * The ankle's rise above its straight path at swing progress `s`, peak 1: s^a (1 − s)^b, as the
 * knee flexes (CMU mocap: walking peaks at s ≈ 0.38, running — the heel toward the buttock — at 0.47).
 */
export function swingHump(s: number, run: number): number {
  const t = clamp(s, 0, 1);
  const a = lerp(1.5, 1.7, run);
  const b = lerp(2.5, 1.9, run);
  const top = a / (a + b);
  return (Math.pow(t, a) * Math.pow(1 - t, b)) / (Math.pow(top, a) * Math.pow(1 - top, b));
}
