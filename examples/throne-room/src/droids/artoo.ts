import { Vector3, type Object3D } from 'three';
import type { SkeletonBone } from '@drawcall/rig';
import { Body, powerGait, species, type Range } from '@drawcall/animate';
import type { Dress } from '../cast';
import { floorAt } from '../hall';

// Measured on public/models/artoo.glb (1.09 m to the dome's top, facing +Z): absolute model-space positions in metres, +Y up, +Z forward,
// +X left. The barrel hangs between its two struts on the shoulder axle; the dome spins on the barrel's top. The model has no centre foot.
//
// What the library asks of a creature, and how R2 meets it:
// - its legs must be able to step with the sole flat, so each strut has a hidden knee halfway down, bent 15 cm forward at rest for spare
//   reach (a straight two-joint strut is rejected); the knee hardly moves while R2 stands, so the rigid strut does not visibly bend;
// - a creature stands with each foot under its leg's top joint, so each strut's joints stand in one vertical line (x = ±0.35);
// - the gaze shares a look evenly over its neck chain, so the dome is two bones spinning about the same axis (`domeRing`, `dome`).

/** R2-D2: the axle through both shoulders, the barrel and dome on it, a strut and a foot each side. */
export const ARTOO = [
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

/** a joint that only spins about its own up axis, as the dome on its ring */
const SPIN: Range = { axis: 1, twist: [-Math.PI, Math.PI], swing: [[0, 0], [0, 0]] };

const strut = (side: 'left' | 'right') => ({
  // the shoulder turns every way (without its twist the sole cannot keep flat), the hidden knee only fore and aft, the ankle tilts
  joints: [
    { bone: `${side}Leg` as const, axes: 'yzx' },
    { bone: `${side}Knee` as const, axes: 'x' },
    { bone: `${side}Foot` as const, axes: 'zx' },
  ],
  // the sole under the ankle, in the foot's frame: from its back edge to its front
  heel: [0, -0.16, -0.16] as const,
  toe: [0, -0.16, 0.21] as const,
});

/** R2-D2's species: two struts it stands on, a dome that spins and looks through its eye, 32 kg in all. */
export const artooSpecies = species(
  ARTOO,
  {
    root: 'axle',
    legs: [strut('left'), strut('right')],
    gaze: { neck: ['domeRing', 'dome'], eyes: { bone: 'dome', at: [0, 0.08, 0.24] }, range: { down: 0.15, up: 0.15, side: 0.05 } },
  },
  {
    gait: powerGait({ height: 0.66, slowest: 0.1, offsets: [0, 0.5], stride: 0.8, stance: 1, clearance: [0.03, 0.03] }),
    masses: { axle: 2, barrel: 22, domeRing: 1, dome: 3, leftLeg: 1, rightLeg: 1, leftKnee: 0.5, rightKnee: 0.5, leftFoot: 0.5, rightFoot: 0.5 },
    centres: { barrel: [0, -0.15, 0], dome: [0, 0.06, 0] },
    limits: { domeRing: SPIN, dome: SPIN },
  },
);

export type Artoo = Body<typeof artooSpecies>;

/**
 * How R2 rocks on its feet: its root sways side to side by `sway` (m) and turns to and fro by `turn` (rad), `rate` times a second.
 * Within about ±1 cm and ±0.1 rad its feet stay planted; past that they step to keep up.
 */
export interface Rocking {
  sway: number;
  turn: number;
  rate: number;
}

/** standing about, freshly repaired: a slow, small rock */
export const IDLE: Rocking = { sway: 0.004, turn: 0.03, rate: 0.5 };

const rockings = new WeakMap<Body, Rocking>();

/** what R2's rocking aims at now: stories change it, and the body eases into it */
export function rockingOf(artoo: Body): Rocking {
  const rocking = rockings.get(artoo);
  if (!rocking) throw new Error('rockingOf: not a body made by createArtoo');
  return rocking;
}

/** how fast the rocking eases into a new aim (1/s) */
const EASE = 2.5;

/**
 * R2-D2 standing at `mark`, wearing its model when the viewer dresses it. Its root is driven: it rocks in place as `rockingOf(artoo)`
 * says (no verb poses a creature's root, and a two-legged creature's gait carries no life), so it cannot walk.
 */
export function createArtoo(mark: Object3D, dress: Dress, dev: boolean): Artoo {
  const aim: Rocking = { ...IDLE };
  const now: Rocking = { ...IDLE };
  const home = mark.position.clone();
  const face = mark.rotation.y;
  const left = new Vector3(Math.cos(face), 0, -Math.sin(face));
  let phase = 0;
  let last = 0;
  const drive = (time: number) => {
    const dt = Math.max(0, time - last);
    last = time;
    const k = 1 - Math.exp(-EASE * dt);
    now.sway += (aim.sway - now.sway) * k;
    now.turn += (aim.turn - now.turn) * k;
    now.rate += (aim.rate - now.rate) * k;
    phase += 2 * Math.PI * now.rate * dt;
    return { position: home.clone().addScaledVector(left, now.sway * Math.sin(phase)), yaw: face + now.turn * Math.sin(phase + 1) };
  };
  const artoo = new Body(artooSpecies, { at: home.clone(), face, drive, floor: floorAt, model: dress(ARTOO), dev });
  rockings.set(artoo, aim);
  return artoo;
}
