// Copied from @prohuman/core (packages/core/src/proportions.ts), without proportionsFor.
import { Vector3 } from 'three';
import { SIDES, type Rest } from './bones';

/** the standing height (m) the default proportions and every tuned distance are given for */
export const DEFAULT_HEIGHT = 1.75;

/**
 * A body's measures: its T-pose skeleton (bone offsets in VRM normalized axes: +Y up,
 * facing +Z, left +X; metres), the landmarks that are not bones, and the measures derived
 * from both, given for the left side (the right mirrors x). Measured from a character
 * model's rest pose; the derived measures are computed once, from the rest.
 */
export interface Proportions extends Rest {
  /** floor to the top of the head, standing */
  readonly height: number;
  /** `height / DEFAULT_HEIGHT`: scales distances tuned for the default body */
  readonly scale: number;
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
 * Proportions for a measured rest skeleton (derives the measures and landmarks). The landmarks are placed by the standing height,
 * estimated from the head bone's height unless given. A skeleton without toes (zero
 * offsets) gets them at the ball of the foot, on the floor.
 */
export function derive(rest: Rest, height = headHeight(rest) / HEAD_HEIGHT): Proportions {
  const H = height;
  const o = rest.offsets;
  const ankle = ankleHeight(rest);
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
  const thigh = o.leftLowerLeg.length();
  const shin = o.leftFoot.length();
  const upperArm = o.leftLowerArm.length();
  const forearm = o.leftHand.length();
  return {
    ...rest,
    height: H,
    scale: H / DEFAULT_HEIGHT,
    head,
    sole,
    hipHeight: rest.hips.y,
    hipHalfWidth: Math.abs(o.leftUpperLeg.x),
    thigh,
    shin,
    legLength: thigh + shin,
    ankleHeight: ankle,
    heelBack: -sole.heel.z,
    toeFront: toes.z + sole.bigToe.z,
    upperArm,
    forearm,
    armLength: upperArm + forearm,
    shoulderHalfWidth: Math.abs(o.leftShoulder.x + o.leftUpperArm.x),
    headCenter: new Vector3(0, 0.05 * H, 0.015 * H),
    eyes: new Vector3(0, head.eye.y, head.eye.z),
    eyeHeight: headHeight(rest) + head.eye.y,
  };
}

/** head bone origin above the floor, T-pose */
const headHeight = (r: Rest) => r.hips.y + r.offsets.spine.y + r.offsets.chest.y + r.offsets.neck.y + r.offsets.head.y;

/** ankle (foot bone origin) above the floor, T-pose */
const ankleHeight = (r: Rest) => r.hips.y + r.offsets.leftUpperLeg.y + r.offsets.leftLowerLeg.y + r.offsets.leftFoot.y;
