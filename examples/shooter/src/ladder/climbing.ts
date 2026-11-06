import { MathUtils, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { heading } from '../angles';
import { between, Frame, phase, planted, shoulders, type Beat, type Cue, type Effect, type Gaze, type Hold, type Standing } from '../choreography';
import type { Puppet, Side } from '../puppet';
import { RAIL, RUNG_RADIUS, STILE, STILE_BAR, type Ladder } from './model';

/** Which end of the ladder the soldier gets on or off at. */
export type End = 'foot' | 'top';

/** A limb: which hand or foot, and whether it takes the odd rungs (1) or the even ones (0). */
type Limb = { side: Side; kind: 'hand' | 'foot'; odd: 0 | 1 };

/**
 * The limbs climb two rungs at a time on the diagonal, as a person's do: the left hand with the right foot, then, a rung climbed later,
 * the right hand with the left foot, each hand past the other's rung. Each takes every other rung — the hands, and the feet, never on one
 * together (the hands `BODY.reach` rungs above the feet, an odd count, so the left hand takes the odd ones and the right foot the even) —
 * holding it until the last `SWING` of its two rungs' climb, when it moves on to the next but one, swung out by `AWAY` (m).
 */
const LIMBS: readonly Limb[] = [
  { side: 'left', kind: 'hand', odd: 1 }, { side: 'right', kind: 'foot', odd: 0 },
  { side: 'right', kind: 'hand', odd: 0 }, { side: 'left', kind: 'foot', odd: 1 },
];
const SWING = 0.36;
const AWAY = 0.08;
/**
 * The share of its two rungs' climb before its swing at which a hand lets go of its rung: it opens there on the rung, its fingers off it
 * before it moves (let go of only as it moved, it would travel with its fingers still closed).
 */
const LETTING = 0.08;
/**
 * Where all four limbs hold, as a share of a rung climbed past one: midway between the pair that moved just landing there and the other's
 * hand letting go.
 */
const HELD = (1 - 2 * SWING - 2 * LETTING) / 2;
/**
 * The body on the ladder (m): its hips `back` behind the rungs, far enough that a hand held at the shoulder's height is reached by an arm
 * not folded, the trunk upright and clear of the rungs; a foot's rung `feet` below them as it lands on it (it then sinks `SWING` of two rungs
 * further below as the body climbs, its leg straightening just short of locked before it steps up); the hands `reach` rungs above the
 * feet (from the shoulder's height to above the head, the arm nearly straight, over a hand's two-rung climb); each hand and foot `apart`
 * off the middle; an ankle above its rung and behind it.
 */
const BODY = { back: 0.36, feet: 0.6, reach: 5, apart: { hand: 0.13, foot: 0.12 }, ankle: { up: 0.07, back: 0.07 } };
/**
 * How far below the stiles' heads the hands hold them at the most (m): just under their bends over toward the landing, a little above a
 * standing body's hanging wrists there, so that arms bent a little reach them from the landing as from the top rungs.
 */
const HEAD = 0.1;
/**
 * How high the hips are on the ladder at each end (m), all four limbs holding: at the foot, one foot on the first rung and the other on the
 * ground at the ladder's foot (rung 0), the hands on rungs a standing body reaches; at the top, the feet on the top two rungs, the top one
 * level with the landing.
 */
export function heights(ladder: Ladder): Record<End, number> {
  // (the feet on rungs `rung` and the one below)
  const at = (rung: number) => (rung + HELD) * ladder.spacing + BODY.feet;
  return { foot: at(1), top: at(ladder.rungs) };
}

/**
 * The next height (m) at or past the hips' `height` up `ladder`, climbing up (`going` > 0) or down, at which all four limbs hold, as
 * `heights`' are: where a climb let go of on the way is carried on to, so that no hand or foot is left in the air between rungs.
 */
export function rest(ladder: Ladder, height: number, going: number) {
  const rungs = (height - BODY.feet) / ladder.spacing - HELD, ends = heights(ladder);
  // (a hair's tolerance, so that a height already there stays)
  const rung = going > 0 ? Math.ceil(rungs - 1e-6) : Math.floor(rungs + 1e-6);
  return MathUtils.clamp((rung + HELD) * ladder.spacing + BODY.feet, ends.foot, ends.top);
}

/**
 * When each part moves getting on at each end, as progress from standing there (0) to on the ladder (1); getting off plays them backward.
 * The left hand lets go of the rifle as the right slings it, letting go of it (or, getting off, taking it back) at `take`. At the foot the right
 * foot steps in to the ladder's foot, then the left up onto the first rung; at the top the left steps back down onto the top rung first, the
 * weight already going back over the ladder, the left hand on its stile before either foot moves.
 */
export const BEATS = {
  /** the body steps in toward the ladder, near enough to take hold of it */
  inset: [0, 0.3],
  take: 0.3,
  sling: [0.05, 0.3],
  hands: { foot: { left: [0, 0.35], right: [0.32, 0.55] }, top: { left: [0, 0.4], right: [0.3, 0.55] } },
  /** the hips over toward the ladder and down (or up) onto it: at the top over the edge first, then down */
  hips: { foot: { over: [0.32, 0.95], down: [0.32, 0.95] }, top: { over: [0.25, 0.8], down: [0.62, 0.95] } },
  feet: { foot: { right: [0.3, 0.55], left: [0.55, 0.92] }, top: { left: [0.4, 0.62], right: [0.6, 0.92] } },
  gaze: [0.2, 1],
} as const satisfies Record<string, number | Beat | Record<string, Beat | Record<string, Beat>>>;
/** A hand or foot coming onto `rung` (or a stile), heard: a foot onto the ground at the ladder's foot (rung 0) as a step. */
export function onto(kind: Limb['kind'], rung: number): Effect {
  if (kind === 'hand') return ['rung', 0.05, 0, 0.15];
  return rung === 0 ? ['step-b', 0.2] : ['rung', 0.1, 0, 0.5];
}

/**
 * What is heard getting on and off `ladder` at `end`: the rifle slung (and taken back), each hand and foot onto the ladder, the feet back
 * down.
 */
export function cues(ladder: Ladder, end: End): Cue[] {
  const on = gripping(ladder, heights(ladder)[end]);
  return [
    { beat: [BEATS.take, BEATS.take], on: ['cloth', 0.12], off: ['cloth', 0.12] },
    ...on.map(({ side, kind, rung }): Cue => kind === 'hand'
      ? { beat: BEATS.hands[end][side], on: onto(kind, rung) }
      : { beat: BEATS.feet[end][side], on: onto(kind, rung), off: [side === 'left' ? 'step-a' : 'step-b', 0.2] }),
  ];
}

/** How far the body steps in toward the ladder at each end (m), feet and all: standing clear of it, its rifle too, it then reaches it. */
const INSET: Record<End, number> = { foot: 0.75, top: 0.42 };

const UP = new Vector3(0, 1, 0), BACK = new Vector3(0, 0, -1);
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
 * to `gaze`. Returns the empty each hand is on or on its way to, for its fingers: the rifle's grip it held standing (the right hand's
 * until it lets go of the rifle on its sling), then the rung or stile it holds or moves to.
 */
export function hang(puppet: Puppet, standing: Standing, ladder: Ladder, rifle: Object3D, end: End, t: number, height: number, gaze: Gaze): Record<Side, Object3D | null> {
  // Standing where it got on, stepped in toward the ladder.
  const inset = new Vector3(0, 0, -Math.sign(standing.hips.z) * INSET[end] * phase(t, BEATS.inset));
  const frame = new Frame(ladder.body, standing), on = phase(t, BEATS.hips[end].over);
  // Swaying a little toward the foot that pushes up each rung, the hips hang behind the ladder, the trunk upright over them, clear of the rungs.
  const sway = Math.sin(Math.PI * ((height - BODY.feet) / ladder.spacing));
  const hips = standing.hips.clone().add(inset);
  puppet.place('hips', frame.point(hips.set(MathUtils.lerp(hips.x, 0, on), MathUtils.lerp(hips.y, height, phase(t, BEATS.hips[end].down)),
    MathUtils.lerp(hips.z, -BODY.back, on))));
  puppet.turn('hips', frame.turn(frame.was('hips').slerp(heading(0.06 * sway, 0), on)));
  puppet.turn('spine', frame.turn(frame.was('spine').slerp(heading(0.1 * gaze.yaw, 0.03), on)));
  puppet.turn('chest', frame.turn(frame.was('chest').slerp(heading(0.2 * gaze.yaw, 0.03), on)));
  shoulders(puppet, frame);
  // (squared on the chest as at rest once on the ladder, from however the rifle held them: else one arm reaches a hand further)
  for (const side of ['left', 'right'] as const) puppet.turn(`${side}Shoulder`, puppet.rotation(`${side}Shoulder`).slerp(puppet.rotation('chest'), on));
  const look = phase(t, BEATS.gaze);
  puppet.turn('neck', frame.turn(frame.was('neck').slerp(heading(0.5 * gaze.yaw, -0.4 * gaze.pitch), look)));
  puppet.turn('head', frame.turn(frame.was('head').slerp(heading(gaze.yaw, -gaze.pitch), look)));

  const onto: Record<Side, Object3D | null> = { left: null, right: null };
  for (const limb of LIMBS) {
    if (limb.kind === 'hand') {
      const s = phase(t, BEATS.hands[end][limb.side]);
      arm(puppet, frame, ladder, limb, height, t, s);
      const { from, to, leaving } = rungs(ladder, limb, height), standing = limb.side === 'left' ? 'foregrip' : t <= BEATS.take ? 'pistol' : null;
      onto[limb.side] = s > 0 ? rungHold(ladder, limb.side, leaving ? to : from) : standing && (rifle.getObjectByName(standing) ?? null);
      continue;
    }
    const stood = planted(standing, limb.side, phase(t, BEATS.inset));
    stood.ankle.add(inset);
    leg(puppet, frame, ladder, limb, height, stood, phase(t, BEATS.feet[end][limb.side]));
  }
  return onto;
}

/**
 * How a hand takes a rung over the top from behind: its palm facing the wall and a little down (the wrist below the rung, as a hand
 * reaching up to it has it), the rung on a handle's grasp line — further out, the index's knuckle, nearest it on the palm's slanted crease,
 * sits in the rung and the finger folds round through it into the palm — so the fingers hook over its top and down its far side and the
 * thumb, out in front of the palm, swings round under it (its pad put on an empty under the rung, it was pulled across the palm into the
 * skin's crease at its base).
 */
const RUNG = { palm: new Vector3(0, -0.4, 0.92).normalize() } as const;
/**
 * How a hand takes a stile by its front edge: its palm `proud` (m) off the bar's outer face where a handle lies across it and turned
 * `turn` (the tangent) a little back toward the climber, nearly flat on the face; its thumb's pad on the outer face `thumb.up` (m) above
 * the grasp and `thumb.back` behind the edge, where the thumb reaches lying straight along the face (turned 0.6 back, the palm's heel
 * stood 4 cm off the face with the thumb's base, and the pad 4 cm up, the thumb stood up at the edge, its tip bone 50° into the face)
 */
const STILE_HOLD = { proud: 0.003, turn: 0.1, thumb: { up: 0.075, back: 0.015 } } as const;
/**
 * The empty hand `side` holds rung `rung` of `ladder` by, as a handle (made the first time it is asked for): above the landing the stile,
 * upright, its thumb up, taken from outside by its front edge (the palm against its outer face, facing in, the fingers round the edge onto
 * its inner face and the thumb along the outer face, as `STILE_HOLD`); below, the rung, as `RUNG`.
 */
function rungHold(ladder: Ladder, side: Side, rung: number): Object3D {
  const name = `${side} hand on rung ${rung}`, found = ladder.body.getObjectByName(name);
  if (found) return found;
  const empty = new Object3D(), sign = side === 'left' ? 1 : -1;
  const y = Math.min(rung * ladder.spacing, ladder.height + RAIL - HEAD);
  empty.name = name;
  if (y > ladder.height) {
    // (a flat bar is as thick about its edge as half the bar)
    const radius = STILE_BAR.thick / 2, edge = STILE_BAR.deep / 2 - radius, thumb = new Object3D();
    empty.position.set(sign * STILE, y, edge);
    thumb.name = `${name}: thumb`;
    thumb.position.set(sign * (STILE + radius), y + STILE_HOLD.thumb.up, edge - STILE_HOLD.thumb.back);
    ladder.body.add(thumb);
    Object.assign(empty.userData, {
      handle: [0, 1, 0], facing: [-sign, 0, -STILE_HOLD.turn], radius: radius + STILE_HOLD.proud, fingers: { thumb: thumb.name },
    });
  } else {
    empty.position.set(sign * BODY.apart.hand, y, 0);
    Object.assign(empty.userData, { handle: [-sign, 0, 0], facing: RUNG.palm.toArray(), radius: RUNG_RADIUS });
  }
  ladder.body.add(empty);
  return empty;
}

/**
 * Each limb with the hips `height` up `ladder`: which it is, the rung it holds or last held (the one it moves to once it lets go) and
 * whether it grips it rather than moving to the next.
 */
export function gripping(ladder: Ladder, height: number) {
  return LIMBS.map((limb) => {
    const { from, to, swing, leaving } = rungs(ladder, limb, height);
    return { side: limb.side, kind: limb.kind, rung: leaving ? to : from, grips: swing === 0 };
  });
}

function arm(puppet: Puppet, frame: Frame, ladder: Ladder, limb: Limb, height: number, t: number, s: number) {
  const { side } = limb, sign = side === 'left' ? 1 : -1;
  const climbing = (rung: number): Hold => puppet.hold(side, rungHold(ladder, side, rung));
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
  // (lifted clear of the rungs and the landing's edge on the way, the knee raised rather than the foot kicked back, and in toward the ladder's
  // middle, the thigh clear of the stile)
  const arc = Math.sin(Math.PI * s);
  const ankle = stood.ankle.clone().lerp(onLadder, s).addScaledVector(UP, 0.2 * arc).addScaledVector(BACK, 0.04 * arc);
  ankle.x -= sign * 0.1 * arc;
  // (the knees a little out and forward, between the stiles this side of the rungs)
  const knee = frame.direction(frame.standing.knees[side]).lerp(frame.direction(new Vector3(sign * 0.45, 0.3, 0.7)), s);
  const foot = frame.turn(stood.foot.clone().slerp(new Quaternion(), s));
  puppet.leg(side, frame.point(ankle), knee, foot);
}

/**
 * The rungs a limb moves between with the hips `height` up the ladder — two apart, of its own parity — how far it has moved (0 holding
 * `from` … 1 at `to`) and whether it has let go of `from` (`LETTING` before it moves).
 */
function rungs(ladder: Ladder, limb: Limb, height: number) {
  const lead = limb.kind === 'foot' ? -BODY.feet : BODY.reach * ladder.spacing - BODY.feet;
  // (its climb in pairs of rungs: the pair it is on, and how far through it)
  const pairs = ((height + lead) / ladder.spacing + limb.odd) / 2, pair = Math.floor(pairs), through = pairs - pair;
  const from = 2 * pair - limb.odd;
  // (a hand goes no higher than the stiles' highest hold: the rungs it would climb on to above that are all held there)
  const last = limb.kind === 'hand' ? Math.ceil((ladder.height + RAIL - HEAD) / ladder.spacing) : Infinity;
  if (from >= last) return { from: last, to: last, swing: 0, leaving: false };
  return { from, to: Math.min(from + 2, last), swing: phase(through, [1 - SWING, 1]), leaving: through > 1 - SWING - LETTING };
}
