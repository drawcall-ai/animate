import type { Cap } from '../../core/types';
import { BONES, INDEX, type BoneName } from '../bones';

const DEG = Math.PI / 180;

// Copied from the old core (a801be4:packages/core/src/pose/dynamics.ts: JOINT's accelerations, JOINT_OF).
/**
 * Each joint as a torque-limited servo: the most it speeds up or slows down (°/s²). Heavier,
 * proximal segments are slower than distal ones; nothing human reaches its top speed (an elite
 * throw's ~2000–7000°/s) in much less than the ~50 ms around a release.
 */
const ACCELERATION = {
  trunk: 10e3,
  neck: 15e3,
  clavicle: 15e3,
  shoulder: 20e3,
  elbow: 30e3,
  wrist: 40e3,
  hip: 20e3,
  knee: 30e3,
  ankle: 30e3,
};

const JOINT_OF: Record<BoneName, keyof typeof ACCELERATION> = {
  hips: 'trunk',
  spine: 'trunk',
  chest: 'trunk',
  neck: 'neck',
  head: 'neck',
  leftShoulder: 'clavicle',
  rightShoulder: 'clavicle',
  leftUpperArm: 'shoulder',
  rightUpperArm: 'shoulder',
  leftLowerArm: 'elbow',
  rightLowerArm: 'elbow',
  leftHand: 'wrist',
  rightHand: 'wrist',
  leftUpperLeg: 'hip',
  rightUpperLeg: 'hip',
  leftLowerLeg: 'knee',
  rightLowerLeg: 'knee',
  leftFoot: 'ankle',
  rightFoot: 'ankle',
  leftToes: 'ankle',
  rightToes: 'ankle',
};

/**
 * The calm default's share of those: everyday motion. Reaching and handling peak at ~150–300°/s
 * at the shoulder, elbow and wrist (Herneth 2024), walking's knee at ~350–450°/s, getting there
 * in ~0.1–0.2 s: some 2–5k°/s², a quarter of the elite values. A fast behaviour (a strike, a
 * throw) proposes the full ones, which the caps' max merge lets through.
 */
export const CALM = 0.25;

/**
 * Stepping's share for the legs: walking's knee and hip peak at ~100–250 rad/s² as the swing
 * leg is braked before the heel strike (some 6–14k°/s², half the elite values).
 */
export const STEPPING = 0.5;

/**
 * Running's share for the legs: the swing leg is braked before each touchdown harder than any
 * throw's arm (the knee at roughly 800–1000 rad/s² at 3–3.5 m/s, twice the elite value)
 */
export const RUNNING = 2;

/**
 * How fast the body as a whole speeds up or slows down (m/s², the root's translation): calmly,
 * about 3 g (a standing body's sway and steps need well under 1 g; the cap keeps a strained
 * contact from flinging it); a walk, carried by its legs, lets it go further (`GAIT_ROOT`)
 */
export const CALM_ROOT = 30;
export const GAIT_ROOT = 100;

/** the root's translation cap at `acceleration` (m/s²) */
export const rootCap = (acceleration: number): Cap => ({ bone: INDEX.hips, acceleration, kind: 'translation' });

/** the legs' caps at `share` of the elite ones */
export const legCaps = (share: number): Cap[] => caps(share).filter((c) => /Leg|Foot/.test(BONES[c.bone]));

/**
 * Every joint's acceleration cap (rad/s²), the root's (the hips) too: how fast people turn it,
 * as `share` of an elite throw's (1; `CALM` for everyday motion).
 */
export function caps(share = 1): Cap[] {
  return BONES.map((b) => ({ bone: INDEX[b], acceleration: ACCELERATION[JOINT_OF[b]] * DEG * share }));
}
