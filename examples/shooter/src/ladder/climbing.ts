import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import { heading } from '../angles';
import { between, Frame, grasp, phase, planted, shoulders, type Beat, type Cue, type Effect, type Gaze, type Hold, type Standing } from '../choreography';
import type { Puppet, Side } from '../puppet';
import { RAIL, STILE, type Ladder } from './model';

/** Which end of the ladder the soldier gets on or off at. */
export type End = 'foot' | 'top';

/** A limb: which hand or foot, and the share of a rung by which it moves after its diagonal partner. */
type Limb = { side: Side; kind: 'hand' | 'foot'; lag: number };

/**
 * The limbs climb a rung at a time on the diagonal: the left hand with the right foot, then the right hand with the left foot half a rung
 * later. Each holds its rung until the last `SWING` of its turn, when it moves to the next, swung out by `AWAY` (m).
 */
const LIMBS: readonly Limb[] = [
  { side: 'left', kind: 'hand', lag: 0 }, { side: 'right', kind: 'foot', lag: 0 },
  { side: 'right', kind: 'hand', lag: 0.5 }, { side: 'left', kind: 'foot', lag: 0.5 },
];
const SWING = 0.4;
const AWAY = 0.08;
/** Where all four limbs hold, as a share of a rung climbed: the lagging pair just moved, the leading pair about to. */
const HELD = 0.55;
/**
 * The body on the ladder (m): its hips `back` behind the rungs; a foot's rung `feet` below them when it last moved; the hands `reach` rungs
 * above the feet; each hand and foot `apart` off the middle; an ankle above its rung and behind it.
 */
const BODY = { back: 0.42, feet: 0.65, reach: 5, apart: { hand: 0.17, foot: 0.12 }, ankle: { up: 0.07, back: 0.07 } };
/** How far below the stiles' heads the hands hold them at the most (m): about a standing body's hip height above the landing. */
const HEAD = 0.2;
/**
 * How high the hips are on the ladder at each end (m), all four limbs holding: at the foot, the feet on the first two rungs; at the top,
 * on the top two, the top one level with the landing.
 */
export function heights(ladder: Ladder): Record<End, number> {
  const at = (rung: number) => (rung + HELD) * ladder.spacing + BODY.feet;
  return { foot: at(1), top: at(ladder.rungs - 1) };
}

/**
 * When each part moves getting on at each end, as progress from standing there (0) to on the ladder (1); getting off plays them backward.
 * The left hand lets go of the rifle as the right slings it, letting go of it (or, getting off, taking it back) at `take`. At the foot the lower foot steps up
 * first; at the top the higher one steps back down onto the top rung first, before the weight goes back over the ladder.
 */
export const BEATS = {
  /** the body steps in toward the ladder, near enough to take hold of it */
  inset: [0, 0.2],
  take: 0.3,
  sling: [0.05, 0.3],
  hands: { foot: { left: [0, 0.35], right: [0.32, 0.55] }, top: { left: [0, 0.4], right: [0.35, 0.6] } },
  /** the hips over toward the ladder and down (or up) onto it: at the top over the edge first, then down */
  hips: { foot: { over: [0.32, 0.95], down: [0.32, 0.95] }, top: { over: [0.38, 0.8], down: [0.62, 0.95] } },
  feet: { foot: { right: [0.36, 0.66], left: [0.63, 0.95] }, top: { left: [0.35, 0.6], right: [0.6, 0.92] } },
  gaze: [0.2, 1],
} as const satisfies Record<string, number | Beat | Record<string, Beat | Record<string, Beat>>>;
/** A hand or foot coming onto a rung (or a stile), heard. */
export const ONTO: Record<Limb['kind'], Effect> = { hand: ['rung', 0.05, 0, 0.15], foot: ['rung', 0.1, 0, 0.5] };

/** What is heard getting on and off at `end`: the rifle slung (and taken back), each hand and foot onto the ladder, the feet back down. */
export function cues(end: End): Cue[] {
  return [
    { beat: [BEATS.take, BEATS.take], on: ['cloth', 0.12], off: ['cloth', 0.12] },
    ...(['left', 'right'] as const).flatMap((side): Cue[] => [
      { beat: BEATS.hands[end][side], on: ONTO.hand },
      { beat: BEATS.feet[end][side], on: ONTO.foot, off: [side === 'left' ? 'step-a' : 'step-b', 0.2] },
    ]),
  ];
}

/** How far the body steps in toward the ladder at each end (m), feet and all: standing clear of it, its rifle too, it then reaches it. */
const INSET: Record<End, number> = { foot: 0.3, top: 0.3 };

const UP = new Vector3(0, 1, 0), BACK = new Vector3(0, 0, -1), TOWARD = new Vector3(0, 0, 1);
/**
 * The rifle slung against the right hip, muzzle down and a little back, its top to the rear, in the chest's frame (+X left, +Y up, +Z
 * forward).
 */
const SLUNG = new Matrix4().makeRotationX(0.3).multiply(new Matrix4().makeBasis(new Vector3(-1, 0, 0), new Vector3(0, 0, -1), new Vector3(0, -1, 0)))
  .setPosition(-0.16, -0.28, -0.12);

/** Where the rifle hangs slung on `puppet`'s body (a world matrix). */
export function slung(puppet: Puppet) {
  return new Matrix4().compose(puppet.position('chest'), puppet.rotation('chest'), new Vector3(1, 1, 1)).multiply(SLUNG);
}

/**
 * Poses `puppet`'s body on `ladder`, its hips `height` (m) up it, `t` of the way from `standing` at `end` (0) to on it (1), its head turned
 * to `gaze`.
 */
export function hang(puppet: Puppet, standing: Standing, ladder: Ladder, end: End, t: number, height: number, gaze: Gaze) {
  // Standing where it got on, stepped in toward the ladder.
  const inset = new Vector3(0, 0, -Math.sign(standing.hips.z) * INSET[end] * phase(t, BEATS.inset));
  const frame = new Frame(ladder.body, standing), on = phase(t, BEATS.hips[end].over);
  // Swaying a little with each rung, the hips hang behind the ladder; the trunk leans in toward it.
  const sway = Math.sin(2 * Math.PI * ((height - BODY.feet) / ladder.spacing));
  const hips = standing.hips.clone().add(inset);
  puppet.place('hips', frame.point(hips.set(MathUtils.lerp(hips.x, 0, on), MathUtils.lerp(hips.y, height, phase(t, BEATS.hips[end].down)),
    MathUtils.lerp(hips.z, -BODY.back, on))));
  puppet.turn('hips', frame.turn(frame.was('hips').slerp(heading(0.06 * sway, 0.05), on)));
  puppet.turn('spine', frame.turn(frame.was('spine').slerp(heading(0.1 * gaze.yaw, 0.12), on)));
  puppet.turn('chest', frame.turn(frame.was('chest').slerp(heading(0.2 * gaze.yaw, 0.15), on)));
  shoulders(puppet, frame);
  const look = phase(t, BEATS.gaze);
  puppet.turn('neck', frame.turn(frame.was('neck').slerp(heading(0.5 * gaze.yaw, -0.4 * gaze.pitch), look)));
  puppet.turn('head', frame.turn(frame.was('head').slerp(heading(gaze.yaw, -gaze.pitch), look)));

  for (const limb of LIMBS) {
    if (limb.kind === 'hand') {
      arm(puppet, frame, ladder, limb, height, t, phase(t, BEATS.hands[end][limb.side]));
      continue;
    }
    const stood = planted(standing, limb.side, phase(t, BEATS.inset));
    stood.ankle.add(inset);
    leg(puppet, frame, ladder, limb, height, stood, phase(t, BEATS.feet[end][limb.side]));
  }
}

/** Each limb with the hips `height` up `ladder`: which it is, and whether it grips its rung rather than moving to the next. */
export function gripping(ladder: Ladder, height: number) {
  return LIMBS.map((limb) => ({ kind: limb.kind, grips: rungs(ladder, limb, height).swing === 0 }));
}

function arm(puppet: Puppet, frame: Frame, ladder: Ladder, limb: Limb, height: number, t: number, s: number) {
  const { side } = limb, sign = side === 'left' ? 1 : -1;
  const climbing = (rung: number): Hold => {
    const y = Math.min(rung * ladder.spacing, ladder.height + RAIL - HEAD);
    // Above the landing it holds the stile, fingers round it, no higher than its head; below, a rung, over the top of it, its thumb toward
    // the middle.
    if (y > ladder.height) return grasp(side, frame.point(new Vector3(sign * STILE, y, 0)), frame.direction(TOWARD), frame.direction(UP));
    return grasp(side, frame.point(new Vector3(sign * BODY.apart.hand, y, 0)), frame.direction(new Vector3(0, -0.6, 1)),
      frame.direction(new Vector3(-sign, 0, 0)));
  };
  const { from, to, swing } = rungs(ladder, limb, height);
  const held = between(climbing(from), climbing(to), swing);
  held.wrist.add(frame.direction(BACK).multiplyScalar(AWAY * Math.sin(Math.PI * swing)));
  // The right hand slings the rifle on its way to the ladder.
  const start = side === 'right' ? slinging(puppet, frame, t) : frame.hand(side);
  const hand = between(start, held, s);
  const elbow = frame.direction(frame.standing.elbows[side]).lerp(frame.direction(new Vector3(sign * 0.35, -1, -0.5)), s);
  puppet.arm(side, hand.wrist, elbow, hand.hand);
}

/** The right hand taking the rifle from where it held it standing to its sling (or, getting off, back), until it lets go at `take`. */
function slinging(puppet: Puppet, frame: Frame, t: number) {
  const s = phase(t, BEATS.sling);
  return between(frame.hand('right'), frame.carrying(slung(puppet)), s);
}

/** `limb`'s leg from as it stood (`stood`: its ankle stepped in, and its foot's turn, in the ladder's frame) onto the ladder, `s` of the way. */
function leg(puppet: Puppet, frame: Frame, ladder: Ladder, limb: Limb, height: number, stood: { ankle: Vector3; foot: Quaternion }, s: number) {
  const { side } = limb, sign = side === 'left' ? 1 : -1, { up, back } = BODY.ankle;
  const climbing = (rung: number) => new Vector3(sign * BODY.apart.foot, rung * ladder.spacing + up, -back);
  const { from, to, swing } = rungs(ladder, limb, height);
  const onLadder = climbing(from).lerp(climbing(to), swing).addScaledVector(BACK, AWAY * Math.sin(Math.PI * swing));
  // (lifted clear of the rungs and the landing's edge on the way, out from the ladder and in toward its middle, the thigh clear of the stile)
  const arc = Math.sin(Math.PI * s);
  const ankle = stood.ankle.clone().lerp(onLadder, s).addScaledVector(UP, 0.2 * arc).addScaledVector(BACK, 0.2 * arc);
  ankle.x -= sign * 0.1 * arc;
  // (the knees splayed, to stay this side of the rungs)
  const knee = frame.direction(frame.standing.knees[side]).lerp(frame.direction(new Vector3(sign * 0.6, 0.4, 0.6)), s);
  const foot = frame.turn(stood.foot.clone().slerp(new Quaternion(), s));
  puppet.leg(side, frame.point(ankle), knee, foot);
}

/** The rungs a limb moves between with the hips `height` up the ladder, and how far it has moved (0 holding `from` … 1 at `to`). */
function rungs(ladder: Ladder, limb: Limb, height: number) {
  const lead = limb.kind === 'foot' ? -BODY.feet : BODY.reach * ladder.spacing - BODY.feet;
  const climbed = (height + lead) / ladder.spacing + limb.lag, from = Math.floor(climbed);
  return { from, to: from + 1, swing: phase(climbed - from, [1 - SWING, 1]) };
}
