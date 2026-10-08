import type { Vector3 } from 'three';
import { DEFAULT_HEIGHT, type Proportions } from '../proportions';
import { clamp, hypot, lerp, smoothstep } from '../math';

export interface Timing {
  /** time per step (s) */
  stepT: number;
  swing: number;
  doubleSupport: number;
  stance: number;
  /** 0 = walking, 1 = running */
  run: number;
}

/** 0 = walking, 1 = running (by speed: people switch at ~2 m/s, Froude number ≈ 0.5; the flight phase sets in by 2.1) */
export const runAmount = (d: Proportions, speed: number) => smoothstep(1.7, 2.1, speed * Math.sqrt(DEFAULT_HEIGHT / d.height));

/** Step timing for a body moving at `velocity` while facing `yaw`, into `out`. */
export function stepTiming(d: Proportions, velocity: Vector3, yaw: number, out: Timing): Timing {
  const H = d.height;
  const speed = hypot(velocity.x, velocity.z);
  // walk ratio (step length / cadence): 0.0056 m·min/step for a DEFAULT_HEIGHT adult, the
  // low end of the adult range (~0.0055–0.0075; Sekiya's mean is ~0.0065) — shorter steps
  // at a quicker cadence
  const walkRatio = 0.0056 * d.scale;
  let cadence = Math.max(1.15, Math.sqrt((60 * speed) / walkRatio) / 60); // steps / s
  let lateral = 0;
  if (speed > 0.05) {
    // sideways / backward steps are short, so the same speed needs a quicker rhythm
    const along = (velocity.x * Math.sin(yaw) + velocity.z * Math.cos(yaw)) / speed;
    const stepMax = (along > 0 ? lerp(0.32, 0.75, along) : lerp(0.32, 0.4, -along)) * d.scale;
    cadence = Math.max(cadence, speed / stepMax);
    lateral = Math.abs(velocity.x * Math.cos(yaw) - velocity.z * Math.sin(yaw)) / speed;
  }
  cadence = Math.min(cadence, 2.6);
  const stepT = 1 / cadence;
  const swing = clamp(0.8 * stepT, 0.3, 0.5);
  // ~10% of the stride per double-support phase; never a long pause between steps
  // (side-shuffles barely pause at all)
  const doubleSupport = clamp(0.2 * stepT, 0.06, 0.14) * (1 - 0.6 * smoothstep(0.5, 0.9, lateral));
  // running: short ground contacts and a flight phase; the swing is longer than a step
  const run = runAmount(d, speed);
  if (run <= 0) return setTiming(out, stepT, swing, doubleSupport, stepT + doubleSupport, run);
  const runCadence = clamp(2.6 + 0.15 * (speed - 2.5), 2.5, 3.2) * Math.sqrt(DEFAULT_HEIGHT / H);
  const runStep = 1 / runCadence;
  const runStance = clamp(0.75 / speed + 0.02, 0.18, 0.32);
  const runSwing = 2 * runStep - runStance;
  return setTiming(out, lerp(stepT, runStep, run), lerp(swing, runSwing, run), doubleSupport, lerp(stepT + doubleSupport, runStance, run), run);
}

function setTiming(out: Timing, stepT: number, swing: number, doubleSupport: number, stance: number, run: number): Timing {
  out.stepT = stepT;
  out.swing = swing;
  out.doubleSupport = doubleSupport;
  out.stance = stance;
  out.run = run;
  return out;
}

/**
 * how far ahead (s) a new step's landing is predicted, given the swing time left (a runner's
 * foot lands a little ahead of the body — about a third of the stance's travel — and leaves
 * well behind it, Novacheck 1998)
 */
export const leadTime = (t: Timing, swingLeft: number) => lerp(swingLeft + 0.5 * t.swing * 1.5 * 0.9, swingLeft + 0.35 * t.stance, t.run);
