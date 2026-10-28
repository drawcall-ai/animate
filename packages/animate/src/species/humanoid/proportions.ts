import { Vector3 } from 'three';
import { SIDES, createRest, type Rest } from './bones';

/** the standing height (m) the default proportions and every tuned distance are given for */
export const DEFAULT_HEIGHT = 1.75;

/** Measures derived once from the rest skeleton (VRM normalized axes: +Y up, +Z forward, left +X; metres), with left-side landmarks mirrored on the right. */
export type Proportions = Rest & Readonly<Omit<ReturnType<typeof derive>, keyof Rest>>;

/** head bone origin above the floor, as a fraction of standing height */
const HEAD_HEIGHT = 0.878;

/**
 * Proportions for a standing height, as fractions of it (Drillis & Contini 1966, as reproduced in Winter's Biomechanics and Motor Control
 * of Human Movement, Fig. 4.1): upper arm 0.186, forearm 0.146, thigh 0.245, shank 0.246; the hip joint centres ~0.10 apart and the
 * shoulder joints ~0.20 (not the full hip width 0.191 and biacromial width 0.259).
 */
export function proportionsFor(height: number): Proportions {
  const H = height, r = createRest(), o = r.offsets;
  r.hips.set(0, 0.53 * H, 0);
  o.spine.set(0, 0.07 * H, -0.005 * H);
  o.chest.set(0, 0.1 * H, 0);
  o.neck.set(0, 0.118 * H, 0.004 * H);
  o.head.set(0, 0.06 * H, 0);
  for (const n of SIDES) {
    const s = n === 'left' ? 1 : -1;
    o[`${n}Shoulder`].set(s * 0.02 * H, 0.106 * H, -0.004 * H);
    o[`${n}UpperArm`].set(s * 0.08 * H, 0, 0);
    o[`${n}LowerArm`].set(s * 0.186 * H, 0, 0);
    o[`${n}Hand`].set(s * 0.146 * H, 0, 0);
    o[`${n}UpperLeg`].set(s * 0.05 * H, 0, 0);
    o[`${n}LowerLeg`].set(0, -0.245 * H, 0);
    o[`${n}Foot`].set(0, -0.246 * H, 0);
    o[`${n}Toes`].set(0, -0.039 * H, 0.08 * H);
  }
  return derive(r, H);
}

/** Derive measures from rest geometry; estimate height from the head unless given, and place missing toes (zero offsets) at the ball of the foot on the floor; landmarks scale with standing height. */
export function derive(rest: Rest, height = headHeight(rest) / HEAD_HEIGHT) {
  const H = height, o = rest.offsets, ankle = ankleHeight(rest);
  for (const n of SIDES) {
    const toes = o[`${n}Toes`];
    if (toes.lengthSq() === 0) toes.set(0, -ankle, 0.08 * H);
  }
  const toes = o.leftToes;
  /** in the head bone's frame */
  const head = {
    eye: new Vector3(0.018 * H, 0.06 * H, 0.05 * H),
    ear: new Vector3(0.043 * H, 0.052 * H, 0),
    nose: new Vector3(0, 0.045 * H, 0.062 * H),
    top: new Vector3(0, 0.125 * H, 0.01 * H),
  };
  /** the heel in the foot bone's frame, the toe tips in the toes bone's frame */
  const sole = {
    heel: new Vector3(0, -ankle, -0.04 * H),
    bigToe: new Vector3(-0.012 * H, -0.85 * ankle - toes.y, 0.11 * H - toes.z),
    smallToe: new Vector3(0.022 * H, -0.88 * ankle - toes.y, 0.78 * 0.11 * H - toes.z),
  };
  const thigh = o.leftLowerLeg.length(), shin = o.leftFoot.length(), upperArm = o.leftLowerArm.length(), forearm = o.leftHand.length();
  return {
    ...rest,
    /** floor to the top of the head, standing */
    height: H,
    /** `height` over the default body's: scales distances tuned for the default body that its whole height sets */
    scale: H / DEFAULT_HEIGHT,
    /** `legLength` over the default body's: scales the distances its legs set (steps, stance, clearance, how low it goes) */
    legs: (thigh + shin) / DEFAULT_LEG,
    /** `armLength` over the default body's: scales the distances its arms set (reach, where it holds things, how near it stands) */
    arms: (upperArm + forearm) / DEFAULT_ARM,
    head,
    sole,
    /** hip joints' midpoint above the floor, standing */
    hipHeight: rest.hips.y,
    /** hip joint sideways from the midline */
    hipHalfWidth: Math.abs(o.leftUpperLeg.x),
    thigh,
    shin,
    /** hip joint to ankle */
    legLength: thigh + shin,
    /** ankle above the floor, standing flat */
    ankleHeight: ankle,
    /** heel behind / toe tip ahead of the ankle, along the foot */
    heelBack: -sole.heel.z,
    toeFront: toes.z + sole.bigToe.z,
    upperArm,
    forearm,
    /** upper-arm joint to wrist. A hand reaches 0.95 of it from its shoulder (the trunk turning that shoulder up to `shoulderHalfWidth`
     * further toward it), so a reach within that goes from where the body stands; one beyond walks up to stand about 0.8 of it from its
     * targets (bowing and crouching for low ones), unless its verb's `step` is false */
    armLength: upperArm + forearm,
    /** upper-arm joint above the floor, standing */
    shoulderHeight: rest.hips.y + o.spine.y + o.chest.y + o.leftShoulder.y + o.leftUpperArm.y,
    /** upper-arm joint sideways from the midline, at rest */
    shoulderHalfWidth: Math.abs(o.leftShoulder.x + o.leftUpperArm.x),
    /** skull centre in the head bone's frame (balance, self-collision) */
    headCenter: new Vector3(0, 0.05 * H, 0.015 * H),
    /** eye midpoint in the head bone's frame: where a head target puts the head */
    eyes: new Vector3(0, head.eye.y, head.eye.z),
    /** eye midpoint above the floor, standing */
    eyeHeight: headHeight(rest) + head.eye.y,
  };
}

/** the default body's hip joint to ankle and upper-arm joint to wrist (m): its thigh and shank, its upper arm and forearm */
const DEFAULT_LEG = (0.245 + 0.246) * DEFAULT_HEIGHT, DEFAULT_ARM = (0.186 + 0.146) * DEFAULT_HEIGHT;

/** head bone origin above the floor, T-pose */
const headHeight = (r: Rest) => r.hips.y + r.offsets.spine.y + r.offsets.chest.y + r.offsets.neck.y + r.offsets.head.y;

/** ankle (foot bone origin) above the floor, T-pose */
const ankleHeight = (r: Rest) => r.hips.y + r.offsets.leftUpperLeg.y + r.offsets.leftLowerLeg.y + r.offsets.leftFoot.y;
