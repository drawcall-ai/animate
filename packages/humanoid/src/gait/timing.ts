// Copied from @prohuman/core (packages/core/src/gait/timing.ts), the velocity given as speeds.
import { DEFAULT_HEIGHT, type Proportions } from '../proportions';
import { clamp, lerp, smoothstep } from '../math';

/** A step's timing at some speed (s). */
export interface Timing {
  /** time per step */
  step: number;
  swing: number;
  doubleSupport: number;
  stance: number;
  /** 0 walking … 1 running */
  run: number;
}

/** 0 walking … 1 running, by speed (m/s): people switch at ~2 m/s (Froude number ≈ 0.5), the flight phase sets in by 2.1 */
export const runAmount = (p: Proportions, speed: number) => smoothstep(1.7, 2.1, speed * Math.sqrt(DEFAULT_HEIGHT / p.height));

/**
 * Step timing at ground speed `speed` (m/s), `along` of it along the facing (−1 … 1) and
 * `lateral` of it across (0 … 1). Walk ratio (step length / cadence) 0.0056 m·min/step for a
 * DEFAULT_HEIGHT adult, the low end of the adult range (Sekiya); sideways and backward steps
 * are short, a quicker rhythm; running: short contacts and a flight phase.
 */
export function stepTiming(p: Proportions, speed: number, along: number, lateral: number): Timing {
  const walkRatio = 0.0056 * p.scale;
  let cadence = Math.max(1.15, Math.sqrt((60 * speed) / walkRatio) / 60);
  if (speed > 0.05) {
    const stepMax = (along > 0 ? lerp(0.32, 0.75, along) : lerp(0.32, 0.4, -along)) * p.scale;
    cadence = Math.max(cadence, speed / stepMax);
  }
  cadence = Math.min(cadence, 2.6);
  const step = 1 / cadence;
  const swing = clamp(0.8 * step, 0.3, 0.5);
  const doubleSupport = clamp(0.2 * step, 0.06, 0.14) * (1 - 0.6 * smoothstep(0.5, 0.9, lateral));
  const run = runAmount(p, speed);
  if (run <= 0) return { step, swing, doubleSupport, stance: step + doubleSupport, run };
  const runCadence = clamp(2.6 + 0.15 * (speed - 2.5), 2.5, 3.2) * Math.sqrt(DEFAULT_HEIGHT / p.height);
  const runStep = 1 / runCadence;
  const runStance = clamp(0.75 / speed + 0.02, 0.18, 0.32);
  const runSwing = 2 * runStep - runStance;
  return { step: lerp(step, runStep, run), swing: lerp(swing, runSwing, run), doubleSupport, stance: lerp(step + doubleSupport, runStance, run), run };
}

/**
 * how far ahead (s) a step's landing is predicted, `left` s of swing to go: a walker's under
 * where the body will be by mid-stance, a runner's a little ahead of the body (about a third of
 * the stance's travel; Novacheck 1998)
 */
export const leadTime = (t: Timing, left: number) => lerp(left + 0.5 * t.swing * 1.5 * 0.9, left + 0.35 * t.stance, t.run);
