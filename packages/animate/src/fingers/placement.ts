import { Vector3, type Object3D, type Quaternion } from 'three';
import type { Placement } from '../kernel/goal';
import { turnOnto } from '../kernel/math';
import type { GripOn } from '../things/thing';
import { digitOf, valuesOf, type Digit, type Finger, type Fingers, type Thumb } from './shape';

/** A point of a hand that goes on what it holds: the palm's middle, or a digit's pad. */
export type HandPart = 'palm' | Digit;

/**
 * Where a hand's point is, in its frame: where it goes on a thing (`at`), the way it faces into it (the palm's, a pad's), its grasp line
 * toward the thumb (across the palm, along its slanted crease where a handle lies) and the way the palm faces. A placement's turn is that
 * of the point's frame: +X its grasp line, +Y its facing.
 */
export interface HandPoint {
  at: Vector3;
  facing: Vector3;
  axis: Vector3;
  palmFacing: Vector3;
}

/**
 * Where a hand goes on a thing, exactly: the point of the hand `point` names goes to `position`, its frame turned as `quaternion` has it
 * (+X its grasp line toward the thumb, +Y the way it faces into the thing), both in the frame of `on`, the thing — the arm brings it
 * there; and its fingers `close` on the thing's meshes (each digit folding until it touches, the thumb opposing them) or hold a shape.
 * A digit named in `digits` is put apart: its pad pressed on that empty (a node under `on`; its own `userData.facing` lays the pad flat
 * on its face, else it presses toward the grasp), or held as its values have it. The fingers never move the hand.
 */
export interface HandPlacement {
  on: Object3D;
  point: HandPart;
  position: Vector3;
  quaternion: Quaternion;
  fingers: 'close' | Fingers;
  digits?: Partial<Record<Digit, Object3D | Finger | Thumb>>;
}

/** where the frame `point` is in (a hand's, `scale` its size) goes for `placement`, in the frame of `placement.on`: the point on its
 * target, turned as its target is */
export function handOn(point: HandPoint, placement: Pick<HandPlacement, 'position' | 'quaternion'>, scale = 1): Placement {
  const turn = placement.quaternion;
  const quaternion = turnOnto(point.axis, point.facing, _x.set(1, 0, 0).applyQuaternion(turn), _y.set(0, 1, 0).applyQuaternion(turn));
  return { position: point.at.clone().multiplyScalar(scale).applyQuaternion(quaternion).negate().add(placement.position), quaternion };
}

/** the digits `grip`'s `userData.digits` puts apart on `thing`, each its values or the empty its pad presses on (none: no digit apart) */
export function digitsOf(thing: Object3D, grip: GripOn): HandPlacement['digits'] {
  const asked: unknown = grip.node.userData.digits;
  if (asked === undefined) return undefined;
  if (typeof asked !== 'object' || asked === null) throw new Error(`"${grip.node.name}" userData.digits is neither digits' values nor empties' names`);
  const digits: HandPlacement['digits'] = {};
  for (const [name, value] of Object.entries(asked)) {
    const digit = digitOf(name, `"${grip.node.name}" userData.digits`);
    if (digit === grip.point) throw new Error(`"${grip.node.name}" userData.digits.${digit}: its pad is the grip's own point, on it`);
    if (typeof value !== 'string') {
      digits[digit] = valuesOf(digit, value);
      continue;
    }
    const empty = thing.getObjectByName(value);
    if (!empty) throw new Error(`"${grip.node.name}" userData.digits.${digit}: "${thing.name}" has no empty named "${value}"`);
    digits[digit] = empty;
  }
  return digits;
}

const _x = new Vector3(), _y = new Vector3();
