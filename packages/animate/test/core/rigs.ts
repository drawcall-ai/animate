import { Quaternion, Vector3 } from 'three';
import { Skeleton, type BoneDef, type Limit } from '../../src/core/skeleton';

const bone = (name: string, parent: number, offset: [number, number, number]): BoneDef => ({
  name,
  parent,
  offset: new Vector3(...offset),
  mass: 1,
  com: new Vector3(),
});

/** a hinge about x (0 at the rest pose, `lo`…`hi` rad), twist and the other swing held near 0 */
export const hinge = (bone: number, lo: number, hi: number): Limit => ({ bone, axis: 1, twist: [-0.05, 0.05], swing: [[-0.05, 0.05], [lo, hi]] });

/** a free root at (0, 1, 0) with a leg hanging down −y: a ball-jointed thigh, a knee bending back (+x), a foot */
export const leg = (limits: Limit[] = []) =>
  new Skeleton([bone('pelvis', -1, [0, 1, 0]), bone('thigh', 0, [0.1, 0, 0]), bone('shin', 1, [0, -0.45, 0]), bone('foot', 2, [0, -0.4, 0])], {
    limits,
    chains: { leg: ['thigh', 'shin', 'foot'] },
  });

/** a horse's hind leg: four segments from the hip down to the hoof, each joint a hinge */
export const horseLeg = () =>
  new Skeleton(
    [bone('pelvis', -1, [0, 1.4, 0]), bone('femur', 0, [0.2, 0, 0]), bone('tibia', 1, [0, -0.45, 0]), bone('cannon', 2, [0, -0.45, 0]), bone('pastern', 3, [0, -0.35, 0]), bone('hoof', 4, [0, -0.15, 0])],
    { limits: [hinge(1, -1.2, 0.6), hinge(2, -0.2, 1.6), hinge(3, -1.6, 0.2), hinge(4, -0.4, 1.4)], chains: { leg: ['femur', 'tibia', 'cannon', 'pastern', 'hoof'] } },
  );

export const turn = (x: number, y: number, z: number, angle: number) => new Quaternion().setFromAxisAngle(new Vector3(x, y, z).normalize(), angle);
