import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../../kernel/frame';
import type { Goal } from '../../kernel/goal';
import { turnOnto } from '../../kernel/math';
import type { HandPoint } from '../../fingers/point';
import type { Grip, Thing } from '../../things/thing';
import type { Hold } from '../../things/resolve';
import type { Side } from '../../species/humanoid/bones';
import { palmOf } from '../../species/humanoid/landmarks';
import type { Reacher } from './reacher';
import { handLine, pressLine, rollToPoint } from './press';

/** A person's palm as a grip takes it: where it holds the grip (`HandPoint`, in the hand bone's frame), the hand bone's turn in the
 * thing's frame as the body was last posed, and the world's up in the thing's frame as the hand sets off. */
export interface Palm {
  point: HandPoint;
  turn: () => Quaternion;
  up: Vector3;
}

/** A hand's hold to take: the hand, the thing, by which grip, its goal there (`goalOn`) and the palm that takes it. */
export interface Taking {
  side: Side;
  thing: Thing;
  grip: string;
  goal: Goal;
  palm: Palm;
}

/**
 * `side`'s palm on `grip` of `thing`: where the hand holds it — measured off its finger bones, or for a hand without them a nominal palm
 * (its centre beyond the wrist, the palm facing down and the grasp line ahead, as the T-pose has a hand; a handle that far out from it, a
 * pad at the fingertips) — and the hand's turn in the thing's frame as the body was last posed (mid-update, the hand's turn may be the
 * free arm's hang's, written before the hand's own step: a reach read so never met its grip)
 */
export function palmOn(person: Reacher, side: Side, thing: Thing, grip: Grip): Palm {
  const bone = person.hands[side], turn = new Quaternion(), frame = () => person.track(thing.object).at(person.frame.time).prev.quaternion;
  const turned = () => turn.copy(frame()).invert().multiply(person.frame.prev.rotation(bone));
  const up = new Vector3(0, 1, 0).applyQuaternion(frame().clone().invert());
  if (!person.fingers) return { point: nominal(person, side, grip), turn: turned, up };
  // (where the hand holds it, measured in its node's frame, in its bone's)
  const scale = person.scaleOf(bone), { at, axis, facing, palmFacing } = person.fingers.pointOn(side, grip), rest = person.restOf(bone);
  return { point: { at: at.applyQuaternion(rest).multiplyScalar(scale), facing: facing.applyQuaternion(rest), axis: axis.applyQuaternion(rest), palmFacing: palmFacing.applyQuaternion(rest) }, turn: turned, up };
}

/** how far a hand without finger bones holds a pad out from its wrist, and its palm's skin from its bones (× the body's height) */
const NOMINAL = { tips: 0.1, palm: 0.01 } as const;

/** where a hand without finger bones holds `grip` (its bone's frame, the T-pose's: the fingers out along the forearm, the palm down) */
function nominal(person: Reacher, side: Side, grip: Grip): HandPoint {
  const height = person.proportions.height, centre = palmOf(person.proportions, side), along = centre.clone().normalize();
  const palm = new Vector3(0, -1, 0).addScaledVector(along, along.y).normalize();
  const axis = side === 'left' ? palm.clone().cross(along) : along.clone().cross(palm);
  if (grip.pad) return { at: along.clone().multiplyScalar(NOMINAL.tips * height), facing: along.clone(), axis, palmFacing: palm.clone() };
  const at = grip.handle ? centre.clone().addScaledVector(palm, NOMINAL.palm * height + grip.handle.radius) : centre;
  return { at, facing: palm.clone(), axis, palmFacing: palm };
}

/**
 * Where a hand bone goes on `grip` (the thing's frame), its `palm` holding it: the bone, at the wrist, as far back from the empty as the
 * point of the hand that goes on it is from the wrist, along the hand as the grip turns it — or, where the grip leaves the hand some
 * turn of its own, as it was last turned, read afresh, so the goal moves on the thing as the hand turns or rolls: turned, where the grip
 * asks a facing, by the least turn that faces it so. A hand short of a turn it is asked only as far as it goes (`palmTurn`) is still put
 * where the turn asked would have it.
 */
export function goalOn(grip: Grip, palm: Palm): Goal {
  const asked = palmTurn(grip, palm);
  const turns = asked ? { quaternion: asked.quaternion, preferred: true, ...(asked.axis && { axis: asked.axis }) } : {};
  // (the wrist, the palm on the empty, the hand turned as asked, or as it is — facing as asked — in the thing's frame)
  const empty = grip.at.position, wrist = new Vector3();
  return { get position() { return wrist.copy(palm.point.at).applyQuaternion(heldTurn(grip, palm, asked)).negate().add(empty); }, ...turns };
}

/** the hand bone's turn on `grip` (the thing's frame) as `palm` takes it: as the grip asks (`palmTurn`, given as `asked`), or as it is —
 * facing as asked, by the least turn that faces it so */
export function heldTurn(grip: Grip, palm: Palm, asked = palmTurn(grip, palm)): Quaternion {
  if (asked && !asked.axis) return asked.quaternion;
  const now = palm.turn();
  if (!grip.facing) return now;
  return new Quaternion().setFromUnitVectors(_facing.copy(palm.point.facing).applyQuaternion(now), grip.facing).multiply(now);
}

/**
 * the hand's turn (the thing's frame) a grip's `facing` asks of the palm — always only preferred: as far as the wrist turns it so. On a
 * handle, the hand's grasp line along the handle's axis, its thumb toward the axis's end, the palm facing so; a pad pressed in so, the
 * hand pointing along its pressing line rolled as a pointing hand is (`press.ts`); else the palm facing so, free to roll about it. None
 * asked: none (a handle without one takes the hand turned as the arm brings it, its palm on the handle's line).
 */
function palmTurn(grip: Grip, { point, up }: Palm): { quaternion: Quaternion; axis?: Vector3 } | null {
  if (!grip.facing) return null;
  if (grip.handle) return { quaternion: turnOnto(point.axis, point.facing, grip.handle.axis, grip.facing) };
  if (grip.pad) {
    const line = pressLine(grip.facing, up), quaternion = new Quaternion().setFromUnitVectors(handLine(point), line);
    if (rollToPoint(quaternion, point, line, up)) return { quaternion };
  }
  return { quaternion: new Quaternion().setFromUnitVectors(point.facing, grip.facing), axis: grip.facing.clone() };
}

/** the hold a hand takes on `grip` of `thing`, its goal `goal`, its `palm` holding it: a grip that sets no turn keeps the hand's */
export function holdOn(thing: Thing, grip: string, goal: Goal, palm: Palm): Hold {
  return { thing, grip, goal, ...(!goal.quaternion && { turn: palm.turn }) };
}

/** where the hand bone goes on a grip in the world this sub-step (its goal: a palm back from the empty), as the person tracks its thing */
export function gripAt(person: Reacher, take: Pick<Taking, 'thing' | 'goal'>, f: Frame, out = new Vector3()): Vector3 {
  const frame = person.track(take.thing.object).at(f.time).current;
  return out.copy(take.goal.position).applyQuaternion(frame.quaternion).add(frame.position);
}

/** where a grip's empty is in the world this sub-step (where the palm closes), as the person tracks its thing */
export function emptyAt(person: Reacher, take: Pick<Taking, 'thing' | 'grip'>, f: Frame, out = new Vector3()): Vector3 {
  const frame = person.track(take.thing.object).at(f.time).current;
  return out.copy(take.thing.grip(take.grip).at.position).applyQuaternion(frame.quaternion).add(frame.position);
}

const _facing = new Vector3();
