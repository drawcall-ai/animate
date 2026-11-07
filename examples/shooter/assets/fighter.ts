import type { SkeletonBone } from '@drawcall/rig';

/** Measured on fighter-source.glb after fighter.glts normalizes it and attaches the upward braid. */
export const FIGHTER = [
  { name: 'hips', position: [0, 0.98, 0.045] },
  { name: 'spine', parent: 'hips', position: [0, 1.1, 0.05] },
  { name: 'chest', parent: 'spine', position: [0, 1.3, 0.035] },
  { name: 'neck', parent: 'chest', position: [0, 1.52, 0.025] },
  { name: 'head', parent: 'neck', position: [0, 1.64, 0.055] },
  { name: 'head_end', parent: 'head', position: [0, 1.82, 0.055] },
  { name: 'braid', parent: 'head', position: [0, 1.79, -0.075] },
  { name: 'braid1', parent: 'braid', position: [0, 1.91, -0.10] },
  { name: 'braid2', parent: 'braid1', position: [0, 2.04, -0.132] },
  { name: 'braid3', parent: 'braid2', position: [0, 2.17, -0.15] },
  { name: 'braid4', parent: 'braid3', position: [0, 2.30, -0.172] },
  { name: 'braid5', parent: 'braid4', position: [0, 2.43, -0.198] },
  { name: 'braid6', parent: 'braid5', position: [0, 2.56, -0.224] },
  { name: 'braidTip', parent: 'braid6', position: [0, 2.65, -0.245] },
  ...(['left', 'right'] as const).flatMap(side => {
    const sign = side === 'left' ? 1 : -1;
    const point = (x: number, y: number, z: number) => [sign * x, y, z] as const;
    return [
      { name: `${side}Shoulder`, parent: 'chest', position: point(0.055, 1.46, 0.005) },
      { name: `${side}UpperArm`, parent: `${side}Shoulder`, position: point(0.22, 1.45, 0.005) },
      { name: `${side}LowerArm`, parent: `${side}UpperArm`, position: point(0.48, 1.442, 0.04) },
      { name: `${side}Hand`, parent: `${side}LowerArm`, position: point(0.68, 1.461, 0.108) },
      // The middle knuckle first: its segment gives the palm its length for the animation's grips.
      { name: `${side}MiddleProximal`, parent: `${side}Hand`, position: point(0.803, 1.472, 0.167) },
      { name: `${side}MiddleIntermediate`, parent: `${side}MiddleProximal`, position: point(0.853, 1.477, 0.177) },
      { name: `${side}MiddleDistal`, parent: `${side}MiddleIntermediate`, position: point(0.891, 1.47, 0.187) },
      { name: `${side}MiddleDistal_end`, parent: `${side}MiddleDistal`, position: point(0.919, 1.461, 0.192) },
      { name: `${side}IndexProximal`, parent: `${side}Hand`, position: point(0.791, 1.466, 0.197) },
      { name: `${side}IndexIntermediate`, parent: `${side}IndexProximal`, position: point(0.838, 1.477, 0.209) },
      { name: `${side}IndexDistal`, parent: `${side}IndexIntermediate`, position: point(0.868, 1.474, 0.22) },
      { name: `${side}IndexDistal_end`, parent: `${side}IndexDistal`, position: point(0.891, 1.468, 0.226) },
      { name: `${side}RingProximal`, parent: `${side}Hand`, position: point(0.802, 1.467, 0.14) },
      { name: `${side}RingIntermediate`, parent: `${side}RingProximal`, position: point(0.846, 1.472, 0.147) },
      { name: `${side}RingDistal`, parent: `${side}RingIntermediate`, position: point(0.882, 1.465, 0.155) },
      { name: `${side}RingDistal_end`, parent: `${side}RingDistal`, position: point(0.91, 1.457, 0.158) },
      { name: `${side}LittleProximal`, parent: `${side}Hand`, position: point(0.785, 1.465, 0.113) },
      { name: `${side}LittleIntermediate`, parent: `${side}LittleProximal`, position: point(0.83, 1.466, 0.116) },
      { name: `${side}LittleDistal`, parent: `${side}LittleIntermediate`, position: point(0.872, 1.46, 0.123) },
      { name: `${side}LittleDistal_end`, parent: `${side}LittleDistal`, position: point(0.905, 1.455, 0.129) },
      { name: `${side}ThumbMetacarpal`, parent: `${side}Hand`, position: point(0.713, 1.45, 0.163) },
      { name: `${side}ThumbProximal`, parent: `${side}ThumbMetacarpal`, position: point(0.744, 1.448, 0.213) },
      { name: `${side}ThumbDistal`, parent: `${side}ThumbProximal`, position: point(0.778, 1.448, 0.24) },
      { name: `${side}ThumbDistal_end`, parent: `${side}ThumbDistal`, position: point(0.797, 1.442, 0.252) },
      { name: `${side}UpperLeg`, parent: 'hips', position: point(0.105, 0.94, 0.035) },
      { name: `${side}LowerLeg`, parent: `${side}UpperLeg`, position: point(0.15, 0.51, 0.03) },
      { name: `${side}Foot`, parent: `${side}LowerLeg`, position: point(0.22, 0.10, 0.015) },
      { name: `${side}Toes`, parent: `${side}Foot`, position: point(0.22, 0.035, 0.175) },
      { name: `${side}Toes_end`, parent: `${side}Toes`, position: point(0.22, 0.025, 0.25) },
    ] as const;
  }),
] as const satisfies readonly SkeletonBone[];

/** The turn the braid hangs from: the skin binds it upright, clear of the torso, and from this turn it falls behind the head. */
export const BRAID_HANG = [-2.2, 0, 0] as const;
