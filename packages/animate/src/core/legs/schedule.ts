import { GRAVITY } from '../math';
import type { Gait } from './gait';

/**
 * A gait from a few numbers, dynamically similar across sizes (recalled: Alexander & Jayes 1983, stride
 * λ/h = c·Fr^0.3; Hodson et al., stance time ∝ v^−0.7). Only `height`, `slowest` and `clearance` carry units: a body
 * scaled by hand keeps `stride` and `stance` as they are (or use `scaled`).
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
  /** stance time at Froude number 1, in units of √(height / g): the same for a body of any size (a dog's 0.93) */
  stance: number;
  /** each foot's lift over the ground swinging (m) */
  clearance: readonly number[];
}): Gait {
  const frequency = (v: number, fr: number) => v / (height * stride * Math.pow(fr, 0.3));
  const unit = Math.sqrt(height / GRAVITY);
  // Tuned numerical cap: leave a nonzero swing interval at the slowest cadence.
  return {
    height, slowest, frequency, clearance,
    contacts: offsets.map((offset) => ({ offset, duty: (v, fr) => Math.min(0.99, stance * unit * Math.pow(fr, -0.35) * frequency(v, fr)) })),
  };
}

/** a stance of `seconds` measured at `speed` (m/s) on a body of hip `height` (m), as `powerGait` takes it */
export const stanceOf = (seconds: number, speed: number, height: number) => seconds * Math.pow(speed, 0.7) / (Math.pow(height, 0.85) * Math.pow(GRAVITY, -0.15));
