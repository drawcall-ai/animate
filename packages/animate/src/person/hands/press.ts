import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../../kernel/frame';
import type { Goal } from '../../kernel/goal';
import { timedPath } from '../../kernel/timed-path';
import type { GripOn } from '../../things/thing';
import { worn } from '../../things/hold';
import { INDEX } from '../anatomy/bones';
import { HOLD, reaching } from './arms';
import type { HandPlan } from './plan';
import type { Person } from '../person';

/*
 * A fingertip's press (a grip with `userData.point`): the hand turned to point into the face, pointed before its way's last run in along
 * the face's normal and frozen so — the arm brings the pad, its finger still — the touch that ends the reach, and the way back off it as
 * it lets go.
 */

/** how far out along the face's normal a fingertip's way to its button runs straight in at its end (m, default body) */
const RUN = 0.045;
/** how near its button a fingertip's pad comes to touch it (m, default body) */
export const TOUCH = 0.001;
/** how far off the face's normal a fingertip draws back along the line from the eyes at most (rad) */
const SIGHTED = 0.9;
/** how far a fingertip draws back off its button as it lets go (m, default body) and in how long (s) */
export const BACK = { distance: 0.07, seconds: 0.15 } as const;

/** where a fingertip's way to its button turns in for its run (`RUN`, the thing's frame): out from its goal along the face's normal;
 * none: no fingertip's grip */
export function runOf(person: Person, take: HandPlan): Vector3 | null {
  const grip = take.thing.grip(take.grip);
  if (grip.point === 'palm' || !grip.facing) return null;
  return take.goal.position.clone().addScaledVector(grip.facing, -RUN * person.scale);
}

/**
 * a fingertip's way to its button (the thing's frame), as one motion: a smooth curve from where its hand sets off through its run and on
 * in to its grip (`points`), timed by one minimum-jerk profile over its length (it passes the run without stopping and comes to rest
 * only on the button), set off `after` s on; its index points before the way's run in (`FingerState`'s `POINTS`), frozen so
 */
export function pressingIn(person: Person, hand: HandPlan & { from: Vector3; points: Vector3[]; lengths: number[]; seconds: number }, after: number) {
  const total = hand.lengths.reduce((sum, length) => sum + length, 0) || 1, seconds = hand.seconds;
  const path = timedPath({ current: { position: hand.from, quaternion: IDENTITY } }, hand.points.map((position, k) => [seconds * hand.lengths[k] / total, { position }] as const), { delay: after });
  const goal = (f: Frame): Goal => ({ ...hand.goal, position: path.to(f).position });
  return reaching(person, hand.side, goal, { on: person.movingFrameOf(hand.thing.object), thing: hand.thing, bodyFollows: !worn(hand.thing), accel: HOLD.accel, speed: HOLD.speed });
}

/** whether `take`'s grip is a fingertip's, and its pad is on its empty (`TOUCH`): a press ends there */
export function touching(person: Person, take: HandPlan, f: Frame): boolean {
  return take.thing.grip(take.grip).point !== 'palm' && padOff(person, take, f) < TOUCH * person.scale;
}

/** how far (m) `take`'s pad is off its empty, each as it last stood */
export function padOff(person: Person, take: Pick<HandPlan, 'side' | 'thing' | 'grip' | 'point'>, f: Frame): number {
  const bone = person.hands[take.side], pad = _pad.copy(take.point.at).applyQuaternion(f.prev.rotation(bone)).add(f.prev.position(bone));
  const { position, quaternion } = person.movingFrameOf(take.thing.object).at(f.time).prev;
  return pad.distanceTo(_empty.copy(take.thing.grip(take.grip).at.position).applyQuaternion(quaternion).add(position));
}

/**
 * the way (world, unit) a fingertip on `grip` of a thing placed so draws back off its button as it lets go: back along the line from
 * the button to the eyes that watch it, as far as `SIGHTED` off the face's normal; none: no fingertip's grip
 */
export function backOff(person: Person, grip: GripOn, placed: { position: Vector3; quaternion: Quaternion }): Vector3 | null {
  if (grip.point === 'palm' || !grip.facing) return null;
  const empty = grip.at.position.clone().applyQuaternion(placed.quaternion).add(placed.position);
  const out = grip.facing.clone().applyQuaternion(placed.quaternion).negate(), way = person.pose.position(INDEX.head).clone().sub(empty).normalize();
  const along = way.dot(out);
  if (along >= Math.cos(SIGHTED)) return way;
  const aside = way.addScaledVector(out, -along);
  if (aside.lengthSq() < 1e-8) return out;
  return aside.normalize().multiplyScalar(Math.sin(SIGHTED)).addScaledVector(out, Math.cos(SIGHTED));
}

const IDENTITY = new Quaternion(), _pad = new Vector3(), _empty = new Vector3();
