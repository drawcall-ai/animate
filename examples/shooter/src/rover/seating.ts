import { MathUtils, Vector3, type Object3D } from 'three';
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
  leftHand: { dash: [0.12, 0.22], wheel: [0.52, 0.78] },
  rightHand: { wheel: [0.48, 0.7] },
  /** the rifle down from the aim turned halfway, held there as the left hand leaves it for the dash (or, getting out, comes onto it from
   * there, both feet on the ground), and on into the rack */
  rifle: { down: [0, 0.12], away: [0.14, 0.24] },
  leftFoot: [0.22, 0.76],
  rightFoot: [0.56, 0.84],
  /** the hips over the sill and round onto the seat */
  sit: [0.28, 0.76],
  /** the right elbow from where it was to down and out for the wheel (the left's follows its hand) */
  elbows: [0, 0.3],
  /** the head from where it looked to along the road, then free to look round and into turns */
  gaze: [0.15, 0.9],
  look: [0.55, 0.95],
  /** the right hand turns the key on its way to the wheel */
  key: 0.58,
  /**
   * the right hand puts the rifle in its rack (or, getting out, takes it from there), letting go of it (or closing on it) at `take`, draws
   * back out of the rack and up behind the windscreen's pillar over `rack`, and comes forward onto the pillar's handle over `handle`; the
   * body bends toward the rack for `bend` either side of `take`
   */
  take: 0.24,
  rack: [0.25, 0.33],
  handle: [0.32, 0.38],
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
/**
 * When the hips go back and when in, as shares of their way onto the seat: back first, so the chest's pouches, standing out a hand's
 * length before it, pass behind the dash's end rather than through it and the left wrist leaning there (moved in and back together, the
 * outer pouch's magazine went through the wrist).
 */
const CLEAR = { back: [0, 0.9], in: [0.2, 1] } as const satisfies Record<string, Beat>;
const UP = new Vector3(0, 1, 0), INBOARD = new Vector3(1, 0, 0);
/** Which way the left elbow points as that hand leans on the dash's end: in and up, the forearm coming onto it from inboard. */
const LEANING = new Vector3(1, 0.1, -0.3);
/** How high a foot stepping in rises above its way from the ground to its pedal (m), and which way its knee points midway: up and a
 * little out, clear of the dash above the footwell. */
const STEP = { rise: 0.1, knee: new Vector3(-1, 0.5, -0.1) };
const SIDES = ['left', 'right'] as const satisfies readonly Side[];
/** Where the right hand comes up behind the pillar before it comes forward onto the handle, off where it holds it (m; the rover's frame):
 * back and out, so the hand rising from the rack goes round the pillar rather than through it. */
const ROUND = new Vector3(-0.04, -0.02, -0.07);
/** How far a hand letting go of one hold goes toward the next with its fingers relaxed, before they open to take it. */
const LET_GO = 0.5;

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

  // Hips: up over the sill and round, backing onto the seat, back before in (`CLEAR`); the trunk leans in as they go and settles back
  // against the seat.
  const hips = standing.hips.clone().addScaledVector(INBOARD, inset(t)), seated = rover.marks.seat.position;
  hips.set(MathUtils.lerp(hips.x, seated.x, phase(sit, CLEAR.in)), MathUtils.lerp(hips.y, seated.y, sit), MathUtils.lerp(hips.z, seated.z, phase(sit, CLEAR.back)));
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
  const racked = frame.carrying(rack.matrixWorld), rifled = (at: number, side: Side) => frame.carrying(frame.rifle(rack.matrixWorld, at, BEATS.rifle), side);
  const { leftHand, rightHand } = BEATS;
  const round = { wrist: holding.wrist.clone().add(ROUND.clone().applyQuaternion(rotation)), hand: holding.hand };
  const right = () => {
    if (t >= rightHand.wheel[0]) return between(holding, onWheel('right'), phase(t, rightHand.wheel));
    if (t >= BEATS.handle[0]) return between(round, holding, phase(t, BEATS.handle));
    if (t >= BEATS.rack[0]) return between(racked, round, phase(t, BEATS.rack));
    return rifled(t, 'right');
  };
  const hands: Record<Side, Hold> = {
    left: t < leftHand.wheel[0] ? between(rifled(Math.min(t, BEATS.rifle.away[0]), 'left'), leaning, phase(t, leftHand.dash)) : between(leaning, onWheel('left'), phase(t, leftHand.wheel)),
    right: right(),
  };
  for (const side of SIDES) {
    const sign = side === 'left' ? 1 : -1, wheel = new Vector3(sign * 0.7, -1, -0.35), stood = frame.direction(standing.elbows[side]);
    const elbow = side === 'left'
      ? stood.lerp(LEANING.clone().applyQuaternion(rotation), phase(t, leftHand.dash)).lerp(wheel.applyQuaternion(rotation), phase(t, leftHand.wheel))
      : stood.lerp(wheel.applyQuaternion(rotation), phase(t, BEATS.elbows));
    puppet.arm(side, hands[side].wrist, elbow, hands[side].hand);
  }
  // (the right hand carries the rifle to its rack, letting go of it there, before it heads for the handle; a hand letting go hangs
  // relaxed until it is LET_GO of the way to its next hold)
  const onto = (beat: Beat, from: Object3D | null, to: Object3D) => t < beat[0] ? from : linear(t, beat) < LET_GO ? null : to;
  return {
    left: t < leftHand.dash[0] ? rifle.getObjectByName('foregrip') ?? null : onto(leftHand.wheel, dash, grips.left),
    right: t < BEATS.rack[0] ? rifle.getObjectByName('pistol') ?? null : t < BEATS.handle[0] ? null : onto(rightHand.wheel, handle, grips.right),
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
    // (up first, over the sill, in across the footwell and last forward under the dash, the knee out on the way rather than into the dash)
    const ankle = from.clone().lerp(to, phase(s, [0.3, 1]))
      .setY(MathUtils.lerp(from.y, to.y, phase(s, [0, 0.5])) + STEP.rise * Math.sin(Math.PI * s)).setZ(MathUtils.lerp(from.z, to.z, phase(s, [0.7, 1])));
    const sign = side === 'left' ? 1 : -1;
    const knee = frame.direction(standing.knees[side]).lerp(new Vector3(sign * 0.2, 0.5, 1).applyQuaternion(rotation), s)
      .lerp(STEP.knee.clone().applyQuaternion(rotation), Math.sin(Math.PI * s));
    const foot = frame.turn(stood.foot.slerp(heading(0, toes[side]), s));
    puppet.leg(side, frame.point(ankle), knee, foot);
  }
}

/** How far the body has stepped in toward the sill by `t` (m). */
function inset(t: number) { return INSET * phase(t, BEATS.inset); }
