import { Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import { vectorOf, type Grip } from '../things/thing';
import type { Opposed } from './closing';
import type { Contact } from './contact';
import { PINCH } from './joints';
import { digitOf, shapeOf, type Digit, type Fingers, type Shape } from './shape';

// What a grip asks of a hand's digits: the values its empty's `userData.fingers` gives them, and the contacts they make on it.

/** What a grip asks of the fingers in `userData.fingers`, by digit: values, or an empty's name. */
export type Asks = Readonly<Record<string, unknown>>;

/** what `grip` asks of the fingers in `userData.fingers` (none: nothing) */
export function asksOf(grip: Object3D): Asks {
  const asked: unknown = grip.userData.fingers;
  if (asked === undefined) return {};
  if (typeof asked !== 'object' || asked === null) throw new Error(`"${grip.name}" userData.fingers is neither digits' values nor empties' names`);
  return { ...asked };
}

/** `base` with the digits' values `asks` gives laid over it (those it puts on an empty left out) */
export function shapeAsked(asks: Asks, base: Shape): Shape {
  const values: Fingers = Object.fromEntries(Object.entries(asks).filter(([, value]) => typeof value !== 'string'));
  return shapeOf(values, base);
}

/** whether `a` and `b` ask the same of each digit: the same empty, or the same values */
export function sameAsks(a: Asks, b: Asks): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => {
    const x: unknown = a[key], y: unknown = b[key];
    if (typeof x !== 'object' || x === null || typeof y !== 'object' || y === null) return x === y;
    const xs = Object.entries(x), ys = new Map(Object.entries(y));
    return xs.length === ys.size && xs.every(([k, v]) => ys.get(k) === v);
  });
}

/**
 * the contacts a hand's digits make on `grip` of `thing`, in its frame: the pad a fingertip grip names on its empty; each digit
 * `userData.fingers` names to an empty with its pad there; and the thumb's pad on `thumb` (the thing's frame), where it opposes the
 * handle it closed on (`closedOn`), unless an empty has it
 */
export function contactsOn(grip: Grip, thing: Object3D, thumb: Opposed | null): Contact[] {
  const centre = grip.at.position.clone(), line = grip.handle?.axis ?? null;
  // (a digit's pad on what the hand holds presses with its flat toward the grip's middle — its line, on a handle — as a grasp opposes the
  // thumb to the fingers and the palm across it)
  const pinching = (part: Digit, at: Vector3): Contact => {
    const toward = centre.clone().sub(at);
    if (line) toward.addScaledVector(line, -toward.dot(line));
    return { part, at, round: PINCH, ...(toward.lengthSq() > 1e-8 && { facing: toward.normalize() }) };
  };
  // (a fingertip's pad only on its empty, the hand turned as it pointed to press)
  const contacts: Contact[] = grip.pad ? [{ part: grip.pad, at: centre }] : [];
  for (const [name, value] of Object.entries(asksOf(grip.node))) {
    if (typeof value !== 'string') continue;
    if (name === grip.pad) throw new Error(`"${grip.node.name}" userData.fingers.${name}: its pad is the grip's own, on it`);
    const empty = thing.getObjectByName(value);
    if (!empty) throw new Error(`"${grip.node.name}" userData.fingers.${name}: "${thing.name}" has no empty named "${value}"`);
    // (where the empty is on the thing as it stands)
    thing.updateWorldMatrix(true, true);
    const local = new Vector3().setFromMatrixPosition(empty.matrixWorld).applyMatrix4(new Matrix4().copy(thing.matrixWorld).invert());
    const digit = digitOf(name, `"${grip.node.name}" userData.fingers`), facing: unknown = empty.userData.facing;
    // (an empty's own `userData.facing` overrides the way toward the grip's middle)
    if (facing === undefined) contacts.push(pinching(digit, local));
    else contacts.push({ part: digit, at: local, round: PINCH, facing: vectorOf(facing, `"${value}" userData.facing`).normalize().applyQuaternion(empty.getWorldQuaternion(new Quaternion()).premultiply(thing.getWorldQuaternion(new Quaternion()).invert())) });
  }
  if (thumb && !contacts.some((c) => c.part === 'thumb')) contacts.push({ part: 'thumb', at: thumb.at.clone(), facing: thumb.facing.clone(), round: PINCH });
  return contacts;
}
