import { Vector3, type Object3D } from 'three';
import { heading } from '../angles';
import { between, Frame, linear, phase, planted, shoulders, type Beat, type Cue, type Gaze, type Hold, type Standing } from '../choreography';
import type { Puppet, Side } from '../puppet';
import type { Rover } from './model';

/**
 * When each part moves, as progress from standing at the doorway (0) to seated with both hands on the wheel (1); getting out plays them
 * backward. The inboard (left) foot steps in first and the outboard (right) one follows once the hips are on the seat.
 */
export const BEATS = {
  /** the body steps up to the sill, near enough for its hands to reach the dash and the pillar's handle */
  inset: [0, 0.15],
  leftHand: { dash: [0.02, 0.22], wheel: [0.52, 0.78] },
  rightHand: { rack: [0.06, 0.24], wheel: [0.48, 0.7] },
  leftFoot: [0.22, 0.48],
  rightFoot: [0.56, 0.84],
  /** the hips over the sill and round onto the seat */
  sit: [0.28, 0.76],
  elbows: [0, 0.3],
  /** the head from where it looked to along the road, then free to look round and into turns */
  gaze: [0.15, 0.9],
  look: [0.55, 0.95],
  /** the right hand turns the key on its way to the wheel */
  key: 0.58,
  /**
   * the right hand puts the rifle in its rack (or, getting out, takes it from there), letting go of it (or closing on it) at `take`, and
   * goes on to the pillar's handle over `rack`; the body bends toward the rack for `bend` either side of `take`
   */
  take: 0.24,
  rack: [0.25, 0.37],
  bend: 0.13,
} as const satisfies Record<string, Beat | number | Record<string, Beat>>;

/** What is heard as each part's move ends: the rifle into its rack (and out), the boots on the floor plates (and back on the ground), the
 * body swinging in and its weight onto the seat (and off it). */
export const CUES: readonly Cue[] = [
  { beat: [BEATS.take, BEATS.take], on: ['clank', 0.5], off: ['clank', 0.5] },
  { beat: BEATS.leftFoot, on: ['boot', 0.2, 0, 0.26], off: ['step-a', 0.22] },
  { beat: [BEATS.sit[0], BEATS.sit[0]], on: ['cloth', 0.1] },
  { beat: [BEATS.sit[1], BEATS.sit[1]], off: ['cloth', 0.1] },
  { beat: BEATS.sit, on: ['thud', 0.16, 0.24, 0.9] },
  { beat: BEATS.rightFoot, on: ['boot', 0.1, 0, 0.25], off: ['step-b', 0.18] },
];

/** How far the body steps in toward the sill (m), feet and all. */
const INSET = 0.18;
/** For the right hand to reach down across to the rack: how far the trunk turns left (rad, spine and chest), leans in (rad, each) and
 * the hips dip (m). */
const BEND = { spine: 0.35, chest: 0.6, lean: 0.6, dip: 0.06 };
const UP = new Vector3(0, 1, 0), INBOARD = new Vector3(1, 0, 0);
const SIDES = ['left', 'right'] as const satisfies readonly Side[];

/**
 * Poses `puppet`'s body `t` of the way from `standing` at the doorway, rifle in hand, to seated, each part on its beat: stepping up to the
 * sill, the left hand onto the dash's edge, the right hand putting the rifle in its rack and taking the pillar's handle, the left foot into
 * the footwell, the hips over the sill and round onto the seat, the right foot onto the accelerator and both hands onto the wheel; seated,
 * its head and shoulders turn to `gaze`. Returns the empty each hand is on or on its way to, for its fingers: the rifle's grip it held
 * standing, then the dash's edge or the pillar's handle, then the wheel's grip.
 */
export function seat(puppet: Puppet, standing: Standing, rover: Rover, rifle: Object3D, t: number, gaze: Gaze): Record<Side, Object3D | null> {
  const frame = new Frame(rover.body, standing);
  const sit = phase(t, BEATS.sit), swing = Math.sin(Math.PI * sit);
  const bend = Math.sin(Math.PI * linear(t, [BEATS.take - BEATS.bend, BEATS.take + BEATS.bend]));

  // Hips: up over the sill and round, backing onto the seat; the trunk leans in as they go and settles back against the seat.
  const hips = standing.hips.clone().addScaledVector(INBOARD, inset(t)).lerp(rover.marks.seat.position, sit);
  puppet.place('hips', frame.point(hips.addScaledVector(UP, 0.06 * swing - BEND.dip * bend)));
  puppet.turn('hips', frame.turn(frame.was('hips').slerp(heading(0, -0.18), sit).premultiply(heading(-0.75 * swing))));
  const look = gaze.yaw * phase(t, BEATS.look);
  puppet.turn('spine', frame.turn(frame.was('spine').slerp(heading(0.05 * look, 0.05), sit)
    .premultiply(heading(-0.75 * swing + BEND.spine * bend, 0.2 * swing + BEND.lean * bend))));
  puppet.turn('chest', frame.turn(frame.was('chest').slerp(heading(0.1 * look, 0.1), sit)
    .premultiply(heading(-0.6 * swing + BEND.chest * bend, 0.3 * swing + BEND.lean * bend))));
  shoulders(puppet, frame);
  const toRoad = phase(t, BEATS.gaze);
  puppet.turn('neck', frame.turn(frame.was('neck').slerp(heading(0.6 * look, 0), toRoad)));
  puppet.turn('head', frame.turn(frame.was('head').slerp(heading(look, -gaze.pitch * toRoad + 0.25 * swing), toRoad)));

  legs(puppet, frame, rover, t);
  return arms(puppet, frame, rover, rifle, t);
}

function arms(puppet: Puppet, frame: Frame, rover: Rover, rifle: Object3D, t: number): Record<Side, Object3D | null> {
  const { standing, rotation } = frame, { grips, handle, dash, rack } = rover.marks;
  const onWheel = (side: Side): Hold => puppet.hold(side, grips[side]);
  // The left hand leans on the dash's edge, fingers over it; the right takes the pillar's upright handle.
  const leaning = puppet.hold('left', dash), holding = puppet.hold('right', handle);
  const racked = frame.carrying(rack.matrixWorld);
  const { leftHand, rightHand } = BEATS;
  const right = () => {
    if (t >= rightHand.wheel[0]) return between(holding, onWheel('right'), phase(t, rightHand.wheel));
    if (t >= BEATS.rack[0]) return between(racked, holding, phase(t, BEATS.rack));
    return between(frame.hand('right'), racked, phase(t, rightHand.rack));
  };
  const hands: Record<Side, Hold> = {
    left: t < leftHand.wheel[0] ? between(frame.hand('left'), leaning, phase(t, leftHand.dash)) : between(leaning, onWheel('left'), phase(t, leftHand.wheel)),
    right: right(),
  };
  for (const side of SIDES) {
    const sign = side === 'left' ? 1 : -1;
    const elbow = frame.direction(standing.elbows[side]).lerp(new Vector3(sign * 0.7, -1, -0.35).applyQuaternion(rotation), phase(t, BEATS.elbows));
    puppet.arm(side, hands[side].wrist, elbow, hands[side].hand);
  }
  // (the right hand carries the rifle to its rack, letting go of it there, before it heads for the handle)
  return {
    left: t < leftHand.dash[0] ? rifle.getObjectByName('foregrip') ?? null : t < leftHand.wheel[0] ? dash : grips.left,
    right: t < BEATS.rack[0] ? rifle.getObjectByName('pistol') ?? null : t < rightHand.wheel[0] ? handle : grips.right,
  };
}

function legs(puppet: Puppet, frame: Frame, rover: Rover, t: number) {
  const { standing, rotation } = frame, { pedals } = rover.marks;
  const beats: Record<Side, Beat> = { left: BEATS.leftFoot, right: BEATS.rightFoot };
  const toes: Record<Side, number> = { left: -0.3, right: -0.65 };
  for (const side of SIDES) {
    const s = phase(t, beats[side]), stood = planted(standing, side, phase(t, BEATS.inset));
    const from = stood.ankle.addScaledVector(INBOARD, inset(t));
    const to = pedals[side].position;
    // (lifted clear of the sill on the way)
    const lift = Math.max(0.12, 0.9 - (from.y + to.y) / 2) * Math.sin(Math.PI * s);
    const ankle = from.clone().lerp(to, s).addScaledVector(UP, lift);
    const sign = side === 'left' ? 1 : -1;
    const knee = frame.direction(standing.knees[side]).lerp(new Vector3(sign * 0.2, 0.5, 1).applyQuaternion(rotation), s);
    const foot = frame.turn(stood.foot.slerp(heading(0, toes[side]), s));
    puppet.leg(side, frame.point(ankle), knee, foot);
  }
}

/** How far the body has stepped in toward the sill by `t` (m). */
function inset(t: number) { return INSET * phase(t, BEATS.inset); }
