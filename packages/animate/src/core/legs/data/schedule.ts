import type { LegGait } from '../gait';

/** Recalled: Alexander & Jayes (1983) λ/h=c·Fr^0.3; Hodson et al. stance=a·v^−0.7. */
export function powerGait(height: number, slowest: number, offsets: readonly number[], stride: number, stance: number, clearance: readonly number[]): LegGait {
  const frequency = (v: number, fr: number) => v / (height * stride * Math.pow(fr, 0.3));
  // Tuned numerical cap: leave a nonzero swing interval at the slowest cadence.
  return {
    height, slowest, frequency, clearance,
    contacts: offsets.map((offset) => ({ offset, duty: (v, fr) => Math.min(0.99, stance * Math.pow(v, -0.7) * frequency(v, fr)) })),
  };
}
