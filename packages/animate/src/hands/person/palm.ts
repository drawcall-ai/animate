import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../../kernel/frame';
import type { Goal, Placement } from '../../kernel/goal';
import { headingOf, smoothstep, turnOnto } from '../../kernel/math';
import { toWorld } from '../../kernel/scene';
import type { HandPart, HandPoint } from '../../fingers/point';
import { shapeOf, type Shape } from '../../fingers/shape';
import type { Grip, Thing } from '../../things/thing';
import type { Hold } from '../../things/resolve';
import { INDEX, type Side } from '../../species/humanoid/bones';
import { palmOf } from '../../species/humanoid/landmarks';
import type { Reacher } from './reacher';
import { fingersOf, handOn, pick, type HandPlacement } from './place';
import { broughtTurn, scratch } from './grasp';

/** A hand's hold to take: the hand, the thing, by which grip, the placement it takes there, the point of the hand that goes on it (the
 * hand bone's frame, scaled) and where the hand bone goes for it (its goal, the thing's frame). */
export interface Taking {
  side: Side;
  thing: Thing;
  grip: string;
  placement: HandPlacement;
  point: HandPoint;
  goal: Goal;
}

/**
 * `side`'s take of `grip` of `thing`: its placement, and where the hand bone goes for it. What the grip fixes the hand is held to exactly;
 * what it leaves free is picked as the take starts and only preferred, as far as the wrist turns it so — the point of the hand kept on
 * its target, the wrist wherever has it there as the hand is turned (`gripOf`):
 * - fixed whole (`fixes`): that placement;
 * - free in part (a handle rolling free, a facing, a ball, a slide): picked from where the body stands (`pick`) — the hand turned as near
 *   as it may be to how the arm brings it there (`broughtTurn`: the forearm and the wrist unturned), its palm clear of the thing (`SUNK`);
 *   the grip beyond its reach, as if it had stepped up to it, as it will walk up; never from where the hand is on its way;
 * - a bare empty (nothing declared): the palm's middle on it, the hand turned as the arm brings it (its placement following the hand),
 *   kept turned as it is once it holds it (`holdOn`, `Hold.turn`).
 */
export function takingOf(person: Reacher, side: Side, thing: Thing, grip: string): Taking {
  const on = thing.grip(grip), placement = bare(on) ? following(person, side, thing, on) : picked(person, side, thing, on);
  return { side, thing, grip, placement, ...gripOf(person, side, thing, on, placement) };
}

/** the placement `side` takes the free parts of `grip` by, picked from where the body stands (see `takingOf`) */
function picked(person: Reacher, side: Side, thing: Thing, on: Grip): HandPlacement {
  const placed = person.track(thing.object).current, rest = person.restOf(person.hands[side]);
  const up = new Vector3(0, 1, 0).applyQuaternion(placed.quaternion.clone().invert());
  const empty = on.at.position.clone().applyQuaternion(placed.quaternion).add(placed.position);
  const sunk = person.fingers?.sunk(side, thing.object), stood = stepped(person, side, empty);
  const natural = broughtTurn(person, person.frame.prev, side, stood({ position: empty, quaternion: placed.quaternion }).position, scratch(person).brought, new Quaternion());
  const cost = (hand: Placement) => stood(toWorld(hand, placed)).quaternion.angleTo(natural) + (sunk ? SUNK * sunk({ position: hand.position, quaternion: hand.quaternion.clone().multiply(rest) }) : 0);
  // (`natural` as it would be where the body steps to — `stepped` brings that back to where it stands — in the thing's frame)
  const back = stood.turn.clone().invert().multiply(natural).premultiply(placed.quaternion.clone().invert());
  return pick(thing.object, on, (part) => pointOf(person, side, part), up, back, cost);
}

/** the palm's middle on bare `grip`, turned as `side`'s hand is turned in `thing`'s frame (read afresh as the body was last posed) */
function following(person: Reacher, side: Side, thing: Thing, on: Grip): HandPlacement {
  const point = pointOf(person, side, 'palm'), turn = new Quaternion(), frame = new Quaternion();
  // (the palm's skin on the empty, its middle a skin's depth further in: a bare empty is where the palm's middle closes)
  const skin = person.fingers ? 0 : NOMINAL.palm * person.proportions.height;
  return {
    on: thing.object, point: 'palm', get position() { return on.at.position.clone().addScaledVector(_y.set(0, 1, 0).applyQuaternion(this.quaternion), skin); }, fingers: 'close', get digits() { return fingersOf(thing.object, on).digits; },
    get quaternion() {
      frame.copy(person.track(thing.object).at(person.frame.time).prev.quaternion).invert().multiply(person.frame.prev.rotation(person.hands[side]));
      return turn.copy(frame).multiply(turnOnto(_x.set(1, 0, 0), _y.set(0, 1, 0), point.axis, point.facing));
    },
  };
}

/**
 * the point of `side`'s hand `placement` puts on its target (the hand bone's frame, scaled), and the hand bone's goal there (the thing's
 * frame): on a grip that fixes the hand, turned as it asks; else turned so only as preferred, and on a bare grip not at all, the wrist
 * wherever has the point on its target as the hand is turned now (read afresh: a hand short of its turn still puts its point there)
 */
function gripOf(person: Reacher, side: Side, thing: Thing, grip: Grip, placement: HandPlacement): { point: HandPoint; goal: Goal } {
  const point = pointOf(person, side, placement.point, placement.fingers === 'close' ? undefined : shapeOf(placement.fingers));
  const { position, quaternion } = handOn(point, placement), bone = person.hands[side], turn = new Quaternion(), wrist = new Vector3();
  if (fixes(grip)) return { point, goal: { position, quaternion, preferred: true } };
  const now = () => turn.copy(person.track(thing.object).at(person.frame.time).prev.quaternion).invert().multiply(person.frame.prev.rotation(bone));
  return { point, goal: { get position() { return wrist.copy(point.at).applyQuaternion(now()).negate().add(placement.position); }, ...(!bare(grip) && { quaternion, preferred: true }) } };
}

/** whether `grip` fixes the hand on it whole — a handle with a facing, a pad with a facing — leaving the library none of its turn to pick */
export function fixes(grip: Grip): boolean {
  return grip.facing !== null && (grip.pad !== null || (grip.handle !== null && grip.handle.length === 0));
}

/** `placement` as it stands now, kept so (a bare grip's, which follows the hand until it takes hold) */
export function frozen(placement: HandPlacement): HandPlacement {
  const { on, point, position, fingers } = placement;
  return { on, point, position: position.clone(), quaternion: placement.quaternion.clone(), fingers, get digits() { return placement.digits; } };
}

/** whether `grip` declares nothing of the hand: the palm's middle on it, turned as the arm brings it */
export function bare(grip: Grip): boolean {
  return !grip.handle && !grip.facing && !grip.ball && !grip.pad;
}

/**
 * where `part` of `side`'s hand is (`HandPoint`, the hand bone's frame, scaled): measured off its finger bones, as `shape` has them, or
 * for a hand without them a nominal one (its palm's centre beyond the wrist on its skin, the palm facing down and the grasp line ahead,
 * as the T-pose has a hand; a pad, or the pinch, at the fingertips)
 */
function pointOf(person: Reacher, side: Side, part: HandPart, shape?: Shape): HandPoint {
  const bone = person.hands[side], rest = person.restOf(bone), scale = person.scaleOf(bone);
  if (person.fingers) {
    const { at, axis, facing, palmFacing } = person.fingers.point(side, part, shape);
    return { at: at.applyQuaternion(rest).multiplyScalar(scale), facing: facing.applyQuaternion(rest), axis: axis.applyQuaternion(rest), palmFacing: palmFacing.applyQuaternion(rest) };
  }
  const height = person.proportions.height, centre = palmOf(person.proportions, side), along = centre.clone().normalize();
  const palm = new Vector3(0, -1, 0).addScaledVector(along, along.y).normalize();
  const axis = side === 'left' ? palm.clone().cross(along) : along.clone().cross(palm);
  if (part !== 'palm') return { at: along.clone().multiplyScalar(NOMINAL.tips * height), facing: along.clone(), axis, palmFacing: palm.clone() };
  return { at: centre.addScaledVector(palm, NOMINAL.palm * height), facing: palm.clone(), axis, palmFacing: palm };
}

/** how far a hand without finger bones holds a pad out from its wrist, and its palm's skin from its bones (× the body's height) */
const NOMINAL = { tips: 0.1, palm: 0.01 } as const;
/** how far out of its arm's length a grip is still taken from where the body stands, and how far out of it a step toward one beyond
 * that brings the shoulder (shares) */
const STANDING = { within: 0.9, stepped: 0.75 } as const;
/** how much a metre of the palm sunk into what it takes weighs against a radian of the hand turned off its most comfortable */
const SUNK = 100;

/**
 * a hand placed at a world placement as if `person` had stepped up to take with `side` what is at `empty` (the world), brought back to
 * the body as it stands: where it stands, as it is; the empty beyond its reach, moved and turned as a step toward it, square to it, would
 * bring the shoulder within `STANDING.stepped` of it
 */
function stepped(person: Reacher, side: Side, empty: Vector3): ((hand: Placement) => Placement) & { turn: Quaternion } {
  const shoulder = person.pose.position(INDEX[`${side}UpperArm`]), toward = empty.clone().sub(shoulder), flat = Math.hypot(toward.x, toward.z);
  if (toward.length() <= STANDING.within * person.proportions.armLength || flat < 1e-6) return Object.assign((hand: Placement) => hand, { turn: new Quaternion() });
  const short = Math.sqrt(Math.max(0, (STANDING.stepped * person.proportions.armLength) ** 2 - toward.y ** 2));
  const stood = shoulder.clone().addScaledVector(toward.clone().setY(0).normalize(), flat - short);
  const turn = new Quaternion().setFromAxisAngle(UP, person.locomotion.facing - headingOf(toward.x, toward.z));
  return Object.assign((hand: Placement) => ({ position: hand.position.clone().sub(stood).applyQuaternion(turn).add(shoulder), quaternion: turn.clone().multiply(hand.quaternion) }), { turn });
}

/**
 * the hold `person`'s hand takes by `take`: on a grip that fixes the hand (a handle with a facing, a pad with a facing), the arm bringing
 * the hand to its placement exactly, turned as it asks — the turn its reach left it short of (only preferred on its way, as far as the
 * wrist turned it so) made up over `SETTLING` s, not at the wrist's top speed in a few sub-steps; on one that left the library some of
 * the turn to pick, its point kept on its target and its turn only preferred, as on its way (a box carried by its sides, the palms
 * keeping on them as the box turns through what the wrists allow)
 */
export function holdOn(person: Reacher, take: Taking): Hold {
  const grip = take.thing.grip(take.grip);
  if (bare(grip)) {
    // (the palm kept on it, the hand turned as the arm turns it — kept as it is where nothing else moves it (`Hold.turn`) — its fingers
    // closed round the thing as it took hold)
    const bone = person.hands[take.side], turn = new Quaternion();
    const now = () => turn.copy(person.track(take.thing.object).at(person.frame.time).prev.quaternion).invert().multiply(person.frame.prev.rotation(bone));
    return { thing: take.thing, grip: take.grip, goal: take.goal, placement: frozen(take.placement), turn: now };
  }
  if (!fixes(grip)) return { thing: take.thing, grip: take.grip, goal: take.goal, placement: take.placement };
  const { position, quaternion } = handOn(take.point, take.placement), began = person.frame.time;
  const frame = person.track(take.thing.object).at(began).prev.quaternion, from = frame.clone().invert().multiply(person.frame.prev.rotation(person.hands[take.side]));
  const turn = new Quaternion();
  const goal = { position, get quaternion() { return turn.slerpQuaternions(from, quaternion, smoothstep(0, SETTLING, person.frame.time - began)); } };
  return { thing: take.thing, grip: take.grip, goal, placement: take.placement };
}

/** how long a hand that has taken hold makes up the turn its reach left it short of (s) */
const SETTLING = 0.4;

/** where the hand bone goes on a grip in the world this sub-step (its goal), as the person tracks its thing */
export function gripAt(person: Reacher, take: Pick<Taking, 'thing' | 'goal'>, f: Frame, out = new Vector3()): Vector3 {
  const frame = person.track(take.thing.object).at(f.time).current;
  return out.copy(take.goal.position).applyQuaternion(frame.quaternion).add(frame.position);
}

/** where a grip's empty is in the world this sub-step, as the person tracks its thing */
export function emptyAt(person: Reacher, take: Pick<Taking, 'thing' | 'grip'>, f: Frame, out = new Vector3()): Vector3 {
  const frame = person.track(take.thing.object).at(f.time).current;
  return out.copy(take.thing.grip(take.grip).at.position).applyQuaternion(frame.quaternion).add(frame.position);
}

const UP = new Vector3(0, 1, 0), _x = new Vector3(), _y = new Vector3();

