// From the old core (a801be4:packages/core/src/gait/timing.ts).
import { DEFAULT_HEIGHT, type Proportions } from '../proportions';
import { clamp, lerp, smoothstep } from '../../core/math';

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

/** 0 walking … 1 running, by speed (m/s): people switch at ~2 m/s (Froude number ≈ 0.5) */
export const runAmount = (p: Proportions, speed: number) => smoothstep(1.7, 2.1, speed * Math.sqrt(DEFAULT_HEIGHT / p.height));

/**
 * Step timing at ground speed `speed` (m/s), `along` of it along the facing (−1 … 1) and
 * `lateral` of it across (0 … 1): the walk ratio (step length / cadence) 0.0056 m·min/step for a
 * DEFAULT_HEIGHT adult (Sekiya); sideways and backward steps are short, a quicker rhythm; running,
 * short contacts and a flight phase.
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
  return { step: lerp(step, runStep, run), swing: lerp(swing, 2 * runStep - runStance, run), doubleSupport, stance: lerp(step + doubleSupport, runStance, run), run };
}

/** how far ahead (s) a step's landing is predicted, `left` s of swing to go: a walker's under where the body will be by mid-stance, a runner's a little ahead of it (Novacheck 1998) */
export const leadTime = (t: Timing, left: number) => lerp(left + 0.6 * t.swing, left + 0.35 * t.stance, t.run);
