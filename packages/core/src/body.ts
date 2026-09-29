/**
 * Body proportions as fractions of standing height (Drillis & Contini 1966),
 * segment masses after Dempster (1955).
 */
export interface BodyDimensions {
  height: number;
  hipHeight: number;
  hipHalfWidth: number;
  thigh: number;
  shin: number;
  legLength: number;
  ankleHeight: number;
  heelBack: number;
  ballFront: number;
  toeFront: number;
  pelvisToSpine: number;
  spineToChest: number;
  chestToNeck: number;
  shoulderHalfWidth: number;
  shoulderDrop: number;
  upperArm: number;
  forearm: number;
  armLength: number;
  neckToHeadBase: number;
  /** head-frame offsets from the skull base (atlanto-occipital joint) */
  head: {
    center: [number, number, number];
    nose: [number, number, number];
    eye: [number, number, number];
    ear: [number, number, number];
    top: [number, number, number];
  };
}

export function createBodyDimensions(height = 1.75): BodyDimensions {
  const H = height;
  const thigh = 0.245 * H;
  const shin = 0.246 * H;
  const upperArm = 0.186 * H;
  const forearm = 0.146 * H;
  return {
    height: H,
    hipHeight: 0.53 * H,
    hipHalfWidth: 0.05 * H,
    thigh,
    shin,
    legLength: thigh + shin,
    ankleHeight: 0.039 * H,
    heelBack: 0.04 * H,
    ballFront: 0.08 * H,
    toeFront: 0.11 * H,
    pelvisToSpine: 0.07 * H,
    spineToChest: 0.1 * H,
    chestToNeck: 0.118 * H,
    shoulderHalfWidth: 0.1 * H,
    shoulderDrop: 0.012 * H,
    upperArm,
    forearm,
    armLength: upperArm + forearm,
    neckToHeadBase: 0.06 * H,
    head: {
      center: [0, 0.05 * H, 0.015 * H],
      nose: [0, 0.045 * H, 0.062 * H],
      eye: [0.018 * H, 0.06 * H, 0.05 * H],
      ear: [0.043 * H, 0.052 * H, 0.0],
      top: [0, 0.125 * H, 0.01 * H],
    },
  };
}
