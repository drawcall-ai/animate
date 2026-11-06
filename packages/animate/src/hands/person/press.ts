import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../../kernel/frame';
import type { Goal } from '../../kernel/goal';
import { minimumJerk } from '../../kernel/math';
import { course } from '../../kernel/course';
import { SHAPING } from '../../fingers/shape';
import type { HandPoint } from '../../fingers/point';
import type { Grip } from '../../things/thing';
import { worn } from '../../things/hold';
import { INDEX, type Side } from '../../species/humanoid/bones';
import type { Reacher } from './reacher';
import { HOLD, reaching } from './arms';
import { emptyAt, type Taking } from './palm';

/*
 * A fingertip's press (a grip with `userData.pad`): the hand turned to point into the face, its way in ending in a short run along the
 * face's normal over which the digit points, the touch that ends the reach, and the way back off it as it lets go.
 */

/** how a fingertip's way to its button runs in at its end (m, default body): `out` along the face's normal and `down` onto it from
 * above, its index pointing over that run alone */
const RUN = { out: 0.045, down: 0.01 };
/** how much of the way is left as its index sets off pointing, and as it points (m, default body, along the way) */
const POINTS = { from: 0.08, to: 0.035 };
/** how near its button a fingertip's pad comes to touch it (m, default body) */
const TOUCH = 0.012;
/** how far a pointing hand is rolled thumb up off palm down (rad), as a forearm rests between its turns */
const ROLL = 0.5;
/** how far below level a hand pressing into an upright face points (rad): its wrist a little above the button, the curled fingers kept
 * off the face and the finger coming onto the button a little from above */
const LEAN = 0.2;
/** how far off the face's normal a fingertip draws back along the line from the eyes at most (rad) */
const SIGHTED = 0.9;
/** how far a fingertip draws back off its button as it lets go (m, default body) and in how long (s) */
export const BACK = { distance: 0.07, seconds: 0.15 } as const;

/** until when each person's hands draw back off a button (s, the body's time) */
const drawing = new WeakMap<Reacher, Partial<Record<Side, number>>>();

/** `side` of `person` draws back off a button until `until` (s) */
export function drawBack(person: Reacher, side: Side, until: number): void {
  drawing.set(person, { ...drawing.get(person), [side]: until });
}

/** whether `side` of `person` is clear of a button it drew back off, at `time` (s): a hand verb for it waits until it is */
export function drawnBack(person: Reacher, side: Side, time: number): boolean {
  return time >= (drawing.get(person)?.[side] ?? -Infinity);
}

/** where a fingertip's way to `grip` turns in for its run (`RUN`, the thing's frame), its goal `goal`, `up` the world's up there; none:
 * no fingertip's grip */
export function runOf(person: Reacher, grip: Grip, goal: Goal, up: Vector3): Vector3 | null {
  if (!grip.pad || !grip.facing) return null;
  return goal.position.clone().addScaledVector(grip.facing, -RUN.out * person.scale).addScaledVector(up.clone().projectOnPlane(grip.facing).normalize(), RUN.down * person.scale);
}

/**
 * a fingertip's way to its button (the thing's frame), as one motion: a smooth curve from where its hand sets off through `run` and on
 * in to its grip, timed by one minimum-jerk profile over its length (it passes `run` without stopping and comes to rest only on the
 * button), set off `after` s on; its index points as the way nears its end (`FingerState.point`, `POINTS`)
 */
export function pressingIn(person: Reacher, hand: Taking & { from: Vector3; seconds: number; lengths: number[] }, run: Vector3, after: number) {
  const [sweep, push] = hand.lengths, total = sweep + push;
  const path = course({ current: { position: hand.from, quaternion: IDENTITY } }, [[hand.seconds * sweep / total, { position: run }], [hand.seconds * push / total, { position: hand.goal.position }]], { delay: after });
  let began = NaN;
  const goal = (f: Frame): Goal => {
    if (Number.isNaN(began)) began = f.time;
    // (its pointing asked as far ahead as the fingers take to ease into a shape)
    const gone = minimumJerk(Math.min(1, Math.max(0, (f.time + SHAPING - began - after) / hand.seconds)));
    const left = (1 - gone) * total / person.scale;
    person.fingers?.point(hand.side, Math.min(1, Math.max(0, (POINTS.from - left) / (POINTS.from - POINTS.to))));
    return { ...hand.goal, position: path.to(f).position };
  };
  return reaching(person, hand.side, goal, { on: person.track(hand.thing.object), thing: hand.thing, lead: !worn(hand.thing), accel: HOLD.accel, speed: HOLD.speed });
}

/** whether `take`'s grip is a fingertip's, and its pad, where the hand last stood, is on its empty (`TOUCH`): a press ends there */
export function touching(person: Reacher, take: Taking, f: Frame): boolean {
  if (!take.thing.grip(take.grip).pad) return false;
  const bone = person.hands[take.side], pad = _pad.copy(take.palm.point.at).applyQuaternion(f.prev.rotation(bone)).add(f.prev.position(bone));
  return pad.distanceTo(emptyAt(person, take, f, _empty)) < TOUCH * person.scale;
}

/**
 * the way (world, unit) a fingertip on `grip` of a thing placed so draws back off its button as it lets go: back along the line from
 * the button to the eyes that watch it, as far as `SIGHTED` off the face's normal (straight out along the normal, seen from above it came
 * over the button below and drew back down over it); none: no fingertip's grip
 */
export function backOff(person: Reacher, grip: Grip, placed: { position: Vector3; quaternion: Quaternion }): Vector3 | null {
  if (!grip.pad || !grip.facing) return null;
  const empty = grip.at.position.clone().applyQuaternion(placed.quaternion).add(placed.position);
  const out = grip.facing.clone().applyQuaternion(placed.quaternion).negate(), way = person.pose.position(INDEX.head).clone().sub(empty).normalize();
  const along = way.dot(out);
  if (along >= Math.cos(SIGHTED)) return way;
  const aside = way.addScaledVector(out, -along);
  if (aside.lengthSq() < 1e-8) return out;
  return aside.normalize().multiplyScalar(Math.sin(SIGHTED)).addScaledVector(out, Math.cos(SIGHTED));
}

/** the line a hand pressing a fingertip in along `push` points along: level into the face, `LEAN` down; into a level face, along `push` */
export function pressLine(push: Vector3, up: Vector3): Vector3 {
  const level = push.clone().addScaledVector(up, -push.dot(up));
  if (level.lengthSq() < 0.25) return push.clone();
  return level.normalize().multiplyScalar(Math.cos(LEAN)).addScaledVector(up, -Math.sin(LEAN));
}

/**
 * `turn` (a hand's, its pad `point` pushing along `push`) rolled about `push`, in place, as a hand points to press with a fingertip: its
 * palm as far down as the roll turns it, then `ROLL` thumb up off that. A push straight up or down leaves it as it is (false).
 */
export function rollToPoint(turn: Quaternion, point: HandPoint, push: Vector3, up: Vector3): boolean {
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

/** a hand's own line from its wrist out along its fingers (its frame), square to its grasp line and palm */
export function handLine(hand: HandPoint): Vector3 {
  const line = new Vector3().crossVectors(hand.axis, hand.palmFacing).normalize();
  return line.dot(hand.at) < 0 ? line.negate() : line;
}

const IDENTITY = new Quaternion(), _q = new Quaternion(), _q2 = new Quaternion(), _cross = new Vector3(), _pad = new Vector3(), _empty = new Vector3();
