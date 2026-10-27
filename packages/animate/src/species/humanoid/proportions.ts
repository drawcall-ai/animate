import { Vector3 } from 'three';
import { SIDES, createRest, type Rest } from './bones';

/** the standing height (m) the default proportions and every tuned distance are given for */
export const DEFAULT_HEIGHT = 1.75;

/**
 * A body's measures: its T-pose skeleton (bone offsets in VRM normalized axes: +Y up, facing +Z, left +X; metres), the landmarks that are
 * not bones, and the measures derived from both, given for the left side (the right mirrors x). Measured from a character model's rest
 * pose; the derived measures are computed once, from the rest.
 */
export interface Proportions extends Rest {
  /** floor to the top of the head, standing */
  readonly height: number;
  /** `height` over the default body's: scales distances tuned for the default body that its whole height sets */
  readonly scale: number;
  /** `legLength` over the default body's: scales the distances its legs set (steps, stance, clearance, how low it goes) */
  readonly legs: number;
  /** `armLength` over the default body's: scales the distances its arms set (reach, where it holds things, how near it stands) */
  readonly arms: number;
  /** in the head bone's frame */
  readonly head: { eye: Vector3; ear: Vector3; nose: Vector3; top: Vector3 };
  /** the heel in the foot bone's frame, the toe tips in the toes bone's frame */
  readonly sole: { heel: Vector3; bigToe: Vector3; smallToe: Vector3 };
  /** hip joints' midpoint above the floor, standing */
  readonly hipHeight: number;
  /** hip joint sideways from the midline */
  readonly hipHalfWidth: number;
  readonly thigh: number;
  readonly shin: number;
  /** hip joint to ankle */
  readonly legLength: number;
  /** ankle above the floor, standing flat */
  readonly ankleHeight: number;
  /** heel behind / toe tip ahead of the ankle, along the foot */
  readonly heelBack: number;
  readonly toeFront: number;
  readonly upperArm: number;
  readonly forearm: number;
  /** upper-arm joint to wrist */
  readonly armLength: number;
  /** upper-arm joint sideways from the midline, at rest */
  readonly shoulderHalfWidth: number;
  /** upper-arm joint above the floor, standing */
  readonly shoulderHeight: number;
  /** skull centre in the head bone's frame (balance, self-collision) */
  readonly headCenter: Vector3;
  /** eye midpoint in the head bone's frame: where a head target puts the head */
  readonly eyes: Vector3;
  /** eye midpoint above the floor, standing */
  readonly eyeHeight: number;
}

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

/**
 * Proportions for a measured rest skeleton (derives the measures and landmarks). The landmarks are placed by the standing height, estimated
 * from the head bone's height unless given. A skeleton without toes (zero offsets) gets them at the ball of the foot, on the floor.
 */
export function derive(rest: Rest, height = headHeight(rest) / HEAD_HEIGHT): Proportions {
  const H = height, o = rest.offsets, ankle = ankleHeight(rest);
  for (const n of SIDES) {
    const toes = o[`${n}Toes`];
    if (toes.lengthSq() === 0) toes.set(0, -ankle, 0.08 * H);
  }
  const toes = o.leftToes;
  const head = {
    eye: new Vector3(0.018 * H, 0.06 * H, 0.05 * H),
    ear: new Vector3(0.043 * H, 0.052 * H, 0),
    nose: new Vector3(0, 0.045 * H, 0.062 * H),
    top: new Vector3(0, 0.125 * H, 0.01 * H),
  };
  const sole = {
    heel: new Vector3(0, -ankle, -0.04 * H),
    bigToe: new Vector3(-0.012 * H, -0.85 * ankle - toes.y, 0.11 * H - toes.z),
    smallToe: new Vector3(0.022 * H, -0.88 * ankle - toes.y, 0.78 * 0.11 * H - toes.z),
  };
  const thigh = o.leftLowerLeg.length(), shin = o.leftFoot.length(), upperArm = o.leftLowerArm.length(), forearm = o.leftHand.length();
  return {
    ...rest,
    height: H,
    scale: H / DEFAULT_HEIGHT,
    legs: (thigh + shin) / DEFAULT_LEG,
    arms: (upperArm + forearm) / DEFAULT_ARM,
    head,
    sole,
    hipHeight: rest.hips.y,
    hipHalfWidth: Math.abs(o.leftUpperLeg.x),
    thigh, shin, legLength: thigh + shin,
    ankleHeight: ankle,
    heelBack: -sole.heel.z,
    toeFront: toes.z + sole.bigToe.z,
    upperArm, forearm, armLength: upperArm + forearm,
    shoulderHeight: rest.hips.y + o.spine.y + o.chest.y + o.leftShoulder.y + o.leftUpperArm.y,
    shoulderHalfWidth: Math.abs(o.leftShoulder.x + o.leftUpperArm.x),
    headCenter: new Vector3(0, 0.05 * H, 0.015 * H),
    eyes: new Vector3(0, head.eye.y, head.eye.z),
    eyeHeight: headHeight(rest) + head.eye.y,
  };
}

/** the default body's hip joint to ankle and upper-arm joint to wrist (m): its thigh and shank, its upper arm and forearm */
const DEFAULT_LEG = (0.245 + 0.246) * DEFAULT_HEIGHT, DEFAULT_ARM = (0.186 + 0.146) * DEFAULT_HEIGHT;

/** head bone origin above the floor, T-pose */
const headHeight = (r: Rest) => r.hips.y + r.offsets.spine.y + r.offsets.chest.y + r.offsets.neck.y + r.offsets.head.y;

/** ankle (foot bone origin) above the floor, T-pose */
const ankleHeight = (r: Rest) => r.hips.y + r.offsets.leftUpperLeg.y + r.offsets.leftLowerLeg.y + r.offsets.leftFoot.y;
