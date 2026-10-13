import { Vector3 } from 'three';
import { Skeleton, type BoneDef, type BonePoint } from '../src/index.js';

const bone = (name: string, parent: number, offset: [number, number, number], mass: number, com: [number, number, number]): BoneDef => ({
  name,
  parent,
  offset: new Vector3(...offset),
  mass,
  com: new Vector3(...com),
});

/** a free root at (0, 1, 0) with a three-segment arm along +x */
export const arm = () =>
  new Skeleton([
    bone('root', -1, [0, 1, 0], 10, [0, 0, 0]),
    bone('upper', 0, [0.2, 0, 0], 2, [0.15, 0, 0]),
    bone('lower', 1, [0.3, 0, 0], 1.5, [0.12, 0, 0]),
    bone('hand', 2, [0.25, 0, 0], 0.5, [0.05, 0, 0]),
  ]);

/** the arm's fingertip */
export const tip = (): BonePoint => ({ bone: 3, at: new Vector3(0.1, 0, 0) });

/** a pelvis at (0, 1, 0) with a trunk and two slightly bent legs of thigh, shin and foot */
export const biped = () =>
  new Skeleton([
    bone('pelvis', -1, [0, 1, 0], 15, [0, 0, 0]),
    bone('trunk', 0, [0, 0.1, 0], 30, [0, 0.3, 0]),
    bone('leftThigh', 0, [0.1, 0, 0], 8, [0, -0.2, 0]),
    bone('leftShin', 2, [0, -0.45, 0.08], 4, [0, -0.2, 0]),
    bone('leftFoot', 3, [0, -0.45, -0.08], 1, [0, -0.05, 0.05]),
    bone('rightThigh', 0, [-0.1, 0, 0], 8, [0, -0.2, 0]),
    bone('rightShin', 5, [0, -0.45, 0.08], 4, [0, -0.2, 0]),
    bone('rightFoot', 6, [0, -0.45, -0.08], 1, [0, -0.05, 0.05]),
  ]);

/** `arm`, `scale` times as large (and as heavy, by volume) */
export const scaledArm = (scale: number, stiffness?: number[]) =>
  new Skeleton(
    arm().bones.map((b, i) => ({
      ...b,
      offset: b.offset.clone().multiplyScalar(scale),
      com: b.com.clone().multiplyScalar(scale),
      mass: b.mass * scale ** 3,
      stiffness: stiffness?.[i],
    })),
  );

/** a free root with a light, short clavicle ahead of a three-segment arm along +x */
export const shoulder = () =>
  new Skeleton([
    bone('root', -1, [0, 1, 0], 10, [0, 0, 0]),
    bone('clavicle', 0, [0.05, 0.1, 0], 0.2, [0.05, 0, 0]),
    bone('upper', 1, [0.12, 0, 0], 2, [0.15, 0, 0]),
    bone('lower', 2, [0.3, 0, 0], 1.5, [0.12, 0, 0]),
    bone('hand', 3, [0.25, 0, 0], 0.5, [0.05, 0, 0]),
  ]);
