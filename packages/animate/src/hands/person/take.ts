import { Quaternion, Vector3, type Object3D } from 'three';
import type { Frame } from '../../kernel/frame';
import type { Goal, Placement } from '../../kernel/goal';
import { headingOf, smoothstep, turnOnto } from '../../kernel/math';
import { toWorld } from '../../kernel/scene';
import { digitsOf, handOn, type HandPart, type HandPlacement, type HandPoint } from '../../fingers/placement';
import { POINT, shapeOf, type Shape } from '../../fingers/shape';
import type { Grip, Thing } from '../../things/thing';
import type { Hold } from '../../things/resolve';
import { INDEX, type Side } from '../../species/humanoid/bones';
import { palmOf } from '../../species/humanoid/landmarks';
import type { Reacher } from './reacher';
import { broughtTurn, scratch } from './arms';

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
 * what it leaves free is picked as the take starts (`picked`) and only preferred, as far as the wrist turns it so — the point of the hand
 * kept on its target, the wrist wherever has it there as the hand is turned (`gripOf`).
 */
export function takingOf(person: Reacher, side: Side, thing: Thing, grip: string): Taking {
  const on = thing.grip(grip), placement = picked(person, side, thing, on);
  return { side, thing, grip, placement, ...gripOf(person, side, thing, on, placement) };
}

/**
 * the placement `side` takes `grip` by: what it fixes as it fixes it; what it leaves free (a handle rolling free, a facing, a ball, a
 * slide, or a bare empty's whole turn) picked from where the body stands (`pick`) — the hand turned as near as it may be to how the arm
 * brings it there (`broughtTurn`: the forearm and the wrist unturned), its palm clear of the thing (`SUNK`); the grip beyond its reach, as
 * if it had stepped up to it, as it will walk up; never from where the hand is on its way
 */
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

/** how `side`'s hand bone is turned in `thing`'s frame as the body was last posed (into `out`) */
function turnIn(person: Reacher, side: Side, thing: Thing, out: Quaternion): Quaternion {
  return out.copy(person.track(thing.object).at(person.frame.time).prev.quaternion).invert().multiply(person.frame.prev.rotation(person.hands[side]));
}

/**
 * the point of `side`'s hand `placement` puts on its target (the hand bone's frame, scaled), and the hand bone's goal there (the thing's
 * frame): on a grip that fixes the hand, turned as it asks; else turned so only as preferred, the wrist wherever has the point on its
 * target as the hand is turned now (read afresh: a hand short of its turn still puts its point there)
 */
function gripOf(person: Reacher, side: Side, thing: Thing, grip: Grip, placement: HandPlacement): { point: HandPoint; goal: Goal } {
  const point = pointOf(person, side, placement.point, placement.fingers === 'close' ? undefined : shapeOf(placement.fingers));
  const { position, quaternion } = handOn(point, placement), turn = new Quaternion(), wrist = new Vector3();
  if (fixes(grip)) return { point, goal: { position, quaternion, preferred: true } };
  // (a bare grip, which declares nothing of the hand, asks no turn of it — its turn follows the hand — and takes the palm's middle, a
  // nominal palm's skin's depth in from its skin)
  const free = bare(grip);
  if (free && !person.fingers) point.at.addScaledVector(point.facing, -NOMINAL.palm * person.proportions.height);
  return { point, goal: { get position() { turnIn(person, side, thing, turn); return wrist.copy(point.at).applyQuaternion(turn).negate().add(placement.position); }, ...(!free && { quaternion, preferred: true }) } };
}

/** whether `grip` declares nothing of the hand: the palm's middle on it, turned as the arm brings it */
function bare(grip: Grip): boolean {
  return !grip.handle && !grip.facing && !grip.ball && grip.point === 'palm';
}

/** whether `grip` fixes the hand on it whole — a handle with a facing, a pad with a facing — leaving the library none of its turn to pick */
export function fixes(grip: Grip): boolean {
  return grip.facing !== null && (grip.point !== 'palm' || (grip.handle !== null && grip.handle.length === 0));
}

/**
 * where `part` of `side`'s hand is (`HandPoint`, the hand bone's frame, scaled): measured off its finger bones, as `shape` has them, or
 * for a hand without them a nominal one (its palm's centre beyond the wrist on its skin, the palm facing down and the grasp line ahead,
 * as the T-pose has a hand; a pad at the fingertips)
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
  const held = { thing: take.thing, grip: take.grip, placement: take.placement };
  if (!fixes(take.thing.grip(take.grip))) return { ...held, goal: take.goal };
  const { position, quaternion } = handOn(take.point, take.placement), began = person.frame.time, from = turnIn(person, take.side, take.thing, new Quaternion());
  const turn = new Quaternion();
  const goal = { position, get quaternion() { return turn.slerpQuaternions(from, quaternion, smoothstep(0, SETTLING, person.frame.time - began)); } };
  return { ...held, goal };
}

/** where `side`'s hand holding `hold` goes on its thing while the thing is held by more than the hand (worn, on another body, resting):
 * its goal, turned as the hand holds it when the grip asks no turn — the palm stays on the empty as the thing turns */
export function steadied(person: Reacher, side: Side, hold: Hold): Goal {
  return hold.goal.quaternion ? hold.goal : { position: hold.goal.position, quaternion: turnIn(person, side, hold.thing, new Quaternion()) };
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

/**
 * The placement a hand takes `grip` of `thing` by: of the placements the grip leaves free — a spread of them, and the one nearest the
 * hand bone turned as `natural` has it (the thing's frame) — the one that `cost`s least — how uncomfortably the body holds its hand bone
 * so, from where it stands — and on a handle free to roll, with its palm on an end of the narrowest chord, the thumb opposing across it.
 * A fingertip's pad pressed into a face points along its pressing line, rolled as a pointing hand is. `point`: where each point of the
 * hand is (the hand bone's frame, scaled); `up`: the world's up in the thing's frame.
 */
function pick(thing: Object3D, grip: Grip, point: (part: HandPart) => HandPoint, up: Vector3, natural: Quaternion, cost: (hand: Placement) => number): HandPlacement {
  const at = point(grip.point), centre = grip.at.position;
  const placement = (position: Vector3, quaternion: Quaternion): HandPlacement => ({
    on: thing, point: grip.point, position, quaternion, fingers: grip.point === 'palm' ? 'close' : structuredClone(POINT), digits: digitsOf(thing, grip),
  });
  // (a fingertip pressing into a face: its pad facing straight in, so it meets the face square rather than glancing off it, the hand
  // rolled about that as a pointing hand is)
  if (grip.point !== 'palm' && grip.facing) {
    const turn = new Quaternion().setFromUnitVectors(at.facing, grip.facing);
    if (rollToPoint(turn, at, grip.facing, up)) return placement(centre.clone(), turn.multiply(framed(at.axis, at.facing)));
  }
  // (each placement the grip leaves free, as its target's place, the way the point faces and its grasp line)
  const tried: { position: Vector3; facing: Vector3; axis: Vector3 }[] = [];
  const handle = grip.handle;
  if (handle) {
    const facings = grip.facing ? [grip.facing.clone().projectOnPlane(handle.axis).normalize()] : around(handle.axis, ROLLS);
    const slides = handle.length > 0 ? Array.from({ length: SLIDES }, (_, k) => (k / (SLIDES - 1) - 0.5) * handle.length) : [0];
    for (const facing of facings) for (const slide of slides) {
      tried.push({ position: centre.clone().addScaledVector(handle.axis, slide).addScaledVector(facing, -handle.radius), facing, axis: handle.axis });
    }
  }
  // (and the one nearest the hand turned as `natural` has it: its grasp line onto a handle's axis, its facing onto a facing asked; on
  // what leaves the palm free over a ball, or to roll about its facing, that one alone)
  const turn = natural.clone().multiply(framed(at.axis, at.facing)), axis = new Vector3(1, 0, 0).applyQuaternion(turn), facing = new Vector3(0, 1, 0).applyQuaternion(turn);
  if (handle && !grip.facing) {
    const onto = facing.projectOnPlane(handle.axis).normalize();
    tried.push({ position: centre.clone().addScaledVector(onto, -handle.radius), facing: onto, axis: handle.axis });
  } else if (!handle && grip.facing) tried.push({ position: centre.clone(), facing: grip.facing, axis: axis.projectOnPlane(grip.facing).normalize() });
  else if (!handle) tried.push({ position: centre.clone().addScaledVector(facing, -(grip.ball?.radius ?? 0)), facing, axis });
  if (tried.length === 1) return placement(tried[0].position, framed(tried[0].axis, tried[0].facing));
  // (on a handle free to roll: how much wider than its narrowest the chord the palm would lie on is, a share of the narrowest)
  const widths = handle ? tried.map(({ facing }) => handle.width(facing)) : [];
  const narrowest = Math.min(...widths.flatMap((width) => width === null ? [] : [width]));
  let best = { cost: Infinity, at: 0 };
  tried.forEach((target, k) => {
    const width = widths[k], chord = width === undefined || !Number.isFinite(narrowest) ? 0 : width === null ? CHORD : CHORD * (width - narrowest) / narrowest;
    const total = cost(handOn(at, { position: target.position, quaternion: framed(target.axis, target.facing) })) + chord;
    if (total < best.cost) best = { cost: total, at: k };
  });
  const chosen = tried[best.at];
  return placement(chosen.position, framed(chosen.axis, chosen.facing));
}

/** the turn of a point's frame that has its grasp line along `axis` and faces `facing` */
function framed(axis: Vector3, facing: Vector3): Quaternion {
  return turnOnto(_x.set(1, 0, 0), _y.set(0, 1, 0), axis, facing);
}

/** how many rolls about a handle's axis, and slides along its length, a pick weighs */
const ROLLS = 36, SLIDES = 5;
/** what the palm on a handle's chord wider than its narrowest costs a placement, per share of the narrowest it is wider (as a radian
 * of an arm's joints out of comfort; on no chord at all, the whole) */
const CHORD = 1;

/** `count` unit vectors square to `axis`, evenly round it */
function around(axis: Vector3, count: number): Vector3[] {
  const square = new Vector3(1, 0, 0).cross(axis);
  if (square.lengthSq() < 1e-6) square.set(0, 1, 0).cross(axis);
  square.normalize();
  return Array.from({ length: count }, (_, k) => square.clone().applyAxisAngle(axis, (2 * Math.PI * k) / count));
}

/**
 * `turn` (a hand's, its pad `point` pushing along `push`) rolled about `push`, in place, as a hand points to press with a fingertip: its
 * palm as far down as the roll turns it, then `ROLL` thumb up off that. A push straight up or down leaves it as it is (false).
 */
function rollToPoint(turn: Quaternion, point: HandPoint, push: Vector3, up: Vector3): boolean {
  const level = (v: Vector3) => v.addScaledVector(push, -v.dot(push));
  const down = level(up.clone().negate());
  if (down.lengthSq() < 1e-6) return false;
  const palm = level(point.palmFacing.clone().applyQuaternion(turn));
  turn.premultiply(_q.setFromAxisAngle(push, Math.atan2(_cross.crossVectors(palm, down).dot(push), palm.dot(down))));
  // (thumb up: the roll that lifts the line across the knuckles toward the thumb)
  const thumb = _cross.copy(point.axis).applyQuaternion(turn);
  const roll = _q.setFromAxisAngle(push, ROLL), lifted = thumb.clone().applyQuaternion(roll).dot(up);
  turn.premultiply(lifted >= thumb.clone().applyQuaternion(_q2.copy(roll).invert()).dot(up) ? roll : _q2);
  return true;
}

/** how far a pointing hand is rolled thumb up off palm down (rad), as a forearm rests between its turns */
const ROLL = 0.5;

const UP = new Vector3(0, 1, 0), _x = new Vector3(), _y = new Vector3(), _q = new Quaternion(), _q2 = new Quaternion(), _cross = new Vector3();
