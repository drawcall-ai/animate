import { Quaternion, Vector3, type Object3D } from 'three';
import type { Placement } from '../../kernel/goal';
import { turnOnto } from '../../kernel/math';
import type { HandPart, HandPoint } from '../../fingers/point';
import { digitOf, POINT, valuesOf, type Digit, type Finger, type Fingers, type Thumb } from '../../fingers/shape';
import type { Grip } from '../../things/thing';
import { handLine, pressLine, rollToPoint } from './press';

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

/**
 * The placement a hand takes `grip` of `thing` by: of the placements the grip leaves free — a spread of them, and the one nearest the
 * hand bone turned as `natural` has it (the thing's frame) — the one that `cost`s least — how uncomfortably the body holds its hand bone
 * so, from where it stands — and on a handle free to roll, with its palm on an end of the narrowest chord, the thumb opposing across it. A fingertip's pad pressed into a face points along its pressing line,
 * rolled as a pointing hand is. `point`: where each point of the hand is (the hand bone's frame, scaled); `up`: the world's up in the
 * thing's frame.
 */
export function pick(thing: Object3D, grip: Grip, point: (part: HandPart) => HandPoint, up: Vector3, natural: Quaternion, cost: (hand: Placement) => number): HandPlacement {
  const part = grip.pad ?? 'palm', at = point(part), centre = grip.at.position;
  // (its digits read from the grip's empty as they are asked for: an app may lay a trigger finger on the trigger or off it every update)
  const placement = (position: Vector3, quaternion: Quaternion): HandPlacement => ({
    on: thing, point: part, position, quaternion, fingers: fingersOf(thing, grip).fingers, get digits() { return fingersOf(thing, grip).digits; },
  });
  // (a fingertip pressing into a face: the hand along its pressing line, rolled as a pointing hand is)
  if (grip.pad && grip.facing) {
    const line = pressLine(grip.facing, up), turn = new Quaternion().setFromUnitVectors(handLine(at), line);
    if (rollToPoint(turn, at, line, up)) return placement(centre.clone(), turn.multiply(framed(at.axis, at.facing)));
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

/** what a placement on `grip` asks of the fingers: a fingertip's hand points, any other closes on the thing; and the digits its
 * `userData.fingers` puts apart, each its values or the empty its pad presses on */
export function fingersOf(thing: Object3D, grip: Grip): Pick<HandPlacement, 'fingers' | 'digits'> {
  const fingers = grip.pad && grip.pad !== 'pinch' ? structuredClone(POINT) : 'close' as const;
  const asked: unknown = grip.node.userData.fingers;
  if (asked === undefined) return { fingers };
  if (typeof asked !== 'object' || asked === null) throw new Error(`"${grip.node.name}" userData.fingers is neither digits' values nor empties' names`);
  const digits: HandPlacement['digits'] = {};
  for (const [name, value] of Object.entries(asked)) {
    const digit = digitOf(name, `"${grip.node.name}" userData.fingers`);
    if (digit === grip.pad) throw new Error(`"${grip.node.name}" userData.fingers.${digit}: its pad is the grip's own, on it`);
    if (typeof value !== 'string') {
      digits[digit] = valuesOf(digit, value);
      continue;
    }
    const empty = thing.getObjectByName(value);
    if (!empty) throw new Error(`"${grip.node.name}" userData.fingers.${digit}: "${thing.name}" has no empty named "${value}"`);
    digits[digit] = empty;
  }
  return { fingers, digits };
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

const _x = new Vector3(), _y = new Vector3();
