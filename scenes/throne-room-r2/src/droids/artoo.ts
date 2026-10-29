import type { Object3D } from 'three';
import type { SkeletonBone } from '@drawcall/rig';
import { Body, powerGait, species, type Range } from '@drawcall/animate';
import type { Dress } from '../cast';
import { floorAt } from '../hall';

// R2-D2, an astromech droid of 1.09 m: a cylindrical body, a dome that turns on it, and two outer legs, each hung from a shoulder hub on
// the body's side with a broad foot under it. (The film's droid also has a centre foot it lowers to roll; the mesh has none, so neither
// does the skeleton: a species stands on two legs or four.)

/**
 * Measured on public/models/artoo.glb (facing +Z, standing at the origin, its dome's crown 1.09 m up) with @drawcall/rig's `section`:
 * absolute model-space positions in metres, +Y up, +Z forward, +X its left. Each leg's strut is rigid on the real droid; it is given a
 * hinge halfway down (the `knee`) because a leg must be able to bend to step and to let its body down.
 */
export const ARTOO = [
  { name: 'body', position: [0, 0.27, 0] },
  { name: 'dome', parent: 'body', position: [0, 0.75, 0] },
  { name: 'dome_end', parent: 'dome', position: [0, 1.09, 0] },
  { name: 'leftShoulder', parent: 'body', position: [0.35, 0.6, 0.02] },
  { name: 'leftKnee', parent: 'leftShoulder', position: [0.35, 0.36, 0.1] },
  { name: 'leftFoot', parent: 'leftKnee', position: [0.35, 0.1, 0.03] },
  { name: 'leftFoot_end', parent: 'leftFoot', position: [0.35, 0.05, 0.22] },
  { name: 'rightShoulder', parent: 'body', position: [-0.35, 0.6, 0.02] },
  { name: 'rightKnee', parent: 'rightShoulder', position: [-0.35, 0.36, 0.1] },
  { name: 'rightFoot', parent: 'rightKnee', position: [-0.35, 0.1, 0.03] },
  { name: 'rightFoot_end', parent: 'rightFoot', position: [-0.35, 0.05, 0.22] },
] as const satisfies readonly SkeletonBone[];

type ArtooBone = (typeof ARTOO)[number]['name'];
const DEG = Math.PI / 180;
/** a joint's range: sideways and fore-and-aft swing and twist about the bone (°), measured from its rest */
const range = (sideways: number, back: number, forth: number, twist: number): Range =>
  ({ axis: 1, swing: [[-sideways * DEG, sideways * DEG], [back * DEG, forth * DEG]], twist: [-twist * DEG, twist * DEG] });

/**
 * R2-D2 as a species: it stands and steps on its two legs, its dome turns all the way round to look (the dome is its whole neck: a
 * one-bone gaze that only turns, its eye the dome's front lens), and it has no hands. Without a carriage it has no idle life of its
 * own; `artooLives` (droids/act.ts) gives it its rocking and dome turns.
 */
export const ARTOO_SPECIES = species(ARTOO, {
  gaze: {
    neck: ['dome'],
    // the radar eye, on the dome's front a little to its right, 0.94 m up
    eyes: { bone: 'dome', at: [-0.07, 0.19, 0.24] },
    // a lens does not turn in the dome: the dome turns for it
    range: { down: 0.35, up: 0.35, side: 0.05 },
  },
  legs: (['left', 'right'] as const).map((side) => ({
    joints: [
      { bone: `${side}Shoulder` as const, axes: 'yzx' },
      { bone: `${side}Knee` as const, axes: 'x' },
      { bone: `${side}Foot` as const, axes: 'zx' },
    ],
    // the foot's sole, 0.1 m under its ankle, from its back edge to its toe
    heel: [0, -0.1, -0.21],
    toe: [0, -0.1, 0.2],
  })),
}, {
  // shoulder height 0.62 m; it shuffles rather than strides
  gait: powerGait({ height: 0.62, slowest: 0.2, offsets: [0, 0.5], stride: 1.2, stance: 0.9, clearance: [0.03, 0.03] }),
  // about 32 kg: the body and its works most of it, the dome, the legs
  masses: { body: 22, dome: 4, leftShoulder: 1.5, leftKnee: 1.5, leftFoot: 1.5, rightShoulder: 1.5, rightKnee: 1.5, rightFoot: 1.5 },
  limits: {
    // the dome turns about its upright axis only
    dome: { axis: 1, swing: [[-0.01, 0.01], [-0.01, 0.01]], twist: [-170 * DEG, 170 * DEG] },
    leftShoulder: range(25, -60, 60, 25), rightShoulder: range(25, -60, 60, 25),
    leftKnee: range(3, -60, 60, 3), rightKnee: range(3, -60, 60, 3),
    leftFoot: range(25, -50, 50, 10), rightFoot: range(25, -50, 50, 10),
  } satisfies Partial<Record<ArtooBone, Range>>,
});

/** R2-D2 standing at `mark` on the hall's floor, wearing its rigged model when the viewer dresses it */
export function createArtoo(mark: Object3D, dress: Dress, dev: boolean): Body<typeof ARTOO_SPECIES> {
  return new Body(ARTOO_SPECIES, { at: mark.position.clone(), face: mark.rotation.y, floor: floorAt, model: dress(ARTOO), dev });
}
