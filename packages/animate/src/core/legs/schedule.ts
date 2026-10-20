import type { Gait } from './gait';

/**
 * A gait from a few numbers, dynamically similar across sizes (recalled: Alexander & Jayes 1983, stride
 * λ/h = c·Fr^0.3; Hodson et al., stance time = a·v^−0.7).
 */
export function powerGait({ height, slowest, offsets, stride, stance, clearance }: {
  /** hip height (m) */
  height: number;
  /** the slowest pace that still strides (m/s) */
  slowest: number;
  /** each leg's footfall in the cycle (0…1), in the legs' order */
  offsets: readonly number[];
  /** stride length over hip height at Froude number 1 (c) */
  stride: number;
  /** stance time at 1 m/s (s; a) */
  stance: number;
  /** each foot's lift over the ground swinging (m) */
  clearance: readonly number[];
}): Gait {
  const frequency = (v: number, fr: number) => v / (height * stride * Math.pow(fr, 0.3));
  // Tuned numerical cap: leave a nonzero swing interval at the slowest cadence.
  return {
    height, slowest, frequency, clearance,
    contacts: offsets.map((offset) => ({ offset, duty: (v, fr) => Math.min(0.99, stance * Math.pow(v, -0.7) * frequency(v, fr)) })),
  };
}
