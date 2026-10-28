import type { SkeletonBone } from '@drawcall/rig';
import { powerGait, species } from '../../src/index';

// A two-strut droid with no carriage (an astromech's barrel on its axle, a dome that turns on it): a creature of the library's custom
// species without the four-legged carriage's idle life. Each strut has a hidden knee bent forward at rest, for the spare reach a leg needs.
export const DROID = [
  { name: 'axle', position: [0, 0.66, 0] },
  { name: 'barrel', parent: 'axle', position: [0, 0.62, 0] },
  { name: 'domeRing', parent: 'barrel', position: [0, 0.86, 0] },
  { name: 'dome', parent: 'domeRing', position: [0, 0.9, 0] },
  { name: 'dome_end', parent: 'dome', position: [0, 1.09, 0] },
  { name: 'leftLeg', parent: 'axle', position: [0.35, 0.66, 0] },
  { name: 'leftKnee', parent: 'leftLeg', position: [0.35, 0.41, 0.15] },
  { name: 'leftFoot', parent: 'leftKnee', position: [0.35, 0.16, 0.03] },
  { name: 'leftFoot_end', parent: 'leftFoot', position: [0.35, 0, 0.24] },
  { name: 'rightLeg', parent: 'axle', position: [-0.35, 0.66, 0] },
  { name: 'rightKnee', parent: 'rightLeg', position: [-0.35, 0.41, 0.15] },
  { name: 'rightFoot', parent: 'rightKnee', position: [-0.35, 0.16, 0.03] },
  { name: 'rightFoot_end', parent: 'rightFoot', position: [-0.35, 0, 0.24] },
] as const satisfies readonly SkeletonBone[];

const strut = (side: 'left' | 'right') => ({
  joints: [
    { bone: `${side}Leg` as const, axes: 'yzx' },
    { bone: `${side}Knee` as const, axes: 'x' },
    { bone: `${side}Foot` as const, axes: 'zx' },
  ],
  heel: [0, -0.16, -0.16] as const,
  toe: [0, -0.16, 0.21] as const,
});

/** the droid's species, leaning into its root's acceleration as a person does (`inertia`) */
export const droid = () => species(DROID, {
  root: 'axle',
  legs: [strut('left'), strut('right')],
  gaze: { neck: ['domeRing', 'dome'], eyes: { bone: 'dome', at: [0, 0.08, 0.24] }, range: { down: 0.15, up: 0.15, side: 0.05 } },
}, {
  gait: powerGait({ height: 0.66, slowest: 0.2, offsets: [0, 0.5], stride: 1.2, stance: 0.93, clearance: [0.04, 0.04] }),
  masses: { axle: 2, barrel: 22, domeRing: 1, dome: 3, leftLeg: 1, rightLeg: 1, leftKnee: 0.5, rightKnee: 0.5, leftFoot: 0.5, rightFoot: 0.5 },
  centres: { barrel: [0, -0.15, 0], dome: [0, 0.06, 0] },
  inertia: { ahead: 0.5, back: 0.5, roll: 0.5, most: 0.2, frequency: 2, damping: 0.7 },
});
