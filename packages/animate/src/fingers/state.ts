import { Matrix4, Quaternion, SkinnedMesh, Vector3, type Object3D } from 'three';
import { turnOnto } from '../kernel/math';
import { Thing, type Grip } from '../things/thing';
import type { Hold } from '../things/resolve';
import type { DigitBones } from './bones';
import { closedOn, reaching } from './closing';
import type { Contact } from './contact';
import { Joints } from './joints';
import { digitOf, easeShape, RELAXED, shapeOf, type Digit, type Fingers, type Shape } from './shape';

/** One hand's fingers: its bones, its shape as last written, what a pose asks of it, the shape it closed to on what it holds (for a puppet's
 * grip, with how far its wrist stood off where `gripOn` puts it then), and where each digit a grip puts on one of its empties last reached
 * to (the hand's frame) and how. */
interface Hand {
  joints: Joints;
  shape: Shape;
  asked: { shape: Shape; time: number } | null;
  closed: { on: Hold | Object3D; shape: Shape; off: Vector3 | null } | null;
  reached: Map<Digit, { empty: string; target: Vector3; shape: Shape }>;
  /** the grip a hand verb is bringing it to */
  coming: Grip | null;
}

/** how long a hand that has taken hold of something waits before its fingers close on it (s): until its palm has settled there */
const SETTLE = 0.1;
/**
 * a hand on its way to a grip opens to take it (Jeannerod 1984: the grip opens wider than the object during the reach, closing on it as
 * the hand arrives): the thumb out in front of the palm, the fingers side by side and a little bent, each a little more than the one before
 * as a relaxed hand's are (all alike, the open hand read as a mannequin's claw; fanned, as a stiff splayed hand) — and how near its wrist
 * must come to where it holds the grip before it closes (m)
 */
const APERTURE: Shape = {
  thumb: { curl: 0.12, oppose: 0.12, spread: 0.4 },
  index: { curl: 0.1, hook: 0.08, spread: 0.05 }, middle: { curl: 0.14, hook: 0.1, spread: 0 }, ring: { curl: 0.19, hook: 0.12, spread: 0.04 },
  little: { curl: 0.25, hook: 0.14, spread: 0.08 },
};
const ARRIVED = 0.015;
/** how far a digit's empty may move in the hand before the digit reaches for it afresh, and a puppet's wrist on its grip before the hand
 * closes on it afresh (m) */
const MOVED = 0.002;

/**
 * A person's fingers, written after each update over the pose its bones were written in: a hand holding something closes on it (`closedOn`,
 * once a hold has settled) — a hand on a grip with a `userData.pad` only touches it, relaxed — with what its grip's empty asks in
 * `userData.fingers` laid over that: a digit's values, or the name of an empty on the thing its pad goes to (a trigger); a free hand takes
 * what a pose asks of it, else it hangs relaxed; each easing into its shape. Its skin (the skinned mesh its hands bend) measures how thick
 * each finger and the palm are.
 */
export class FingerState {
  private readonly hands: Record<'left' | 'right', Hand>;
  /** when each hand's hold began (s), to wait for it to settle */
  private readonly since = new WeakMap<Hold, number>();

  constructor(bones: { left: DigitBones; right: DigitBones }, nodes: Readonly<Record<string, Object3D>>, private readonly holding: Readonly<Record<string, Hold | null>>, model: Object3D) {
    const hand = (side: 'left' | 'right'): Hand => {
      const node = nodes[`${side}Hand`];
      if (!node) throw new Error(`fingers: no bone "${side}Hand"`);
      const joints = new Joints(node, bones[side], nodes, side, skinsOf(model, node)), shape = shapeOf({});
      joints.write(shape);
      return { joints, shape, asked: null, closed: null, reached: new Map(), coming: null };
    };
    this.hands = { left: hand('left'), right: hand('right') };
  }

  /** `side`'s finger bones */
  joints(side: 'left' | 'right'): Joints {
    return this.hands[side].joints;
  }

  /** a pose asks `side`'s fingers to take `shape` this sub-step (at `time`, s) */
  ask(side: 'left' | 'right', shape: Shape, time: number): void {
    this.hands[side].asked = { shape, time };
  }

  /** each hand eased `seconds` on toward what it holds, what a pose asks of it this sub-step (`time`, s; `dt` a sub-step), or relaxed */
  update(seconds: number, time: number, dt: number): void {
    for (const side of ['left', 'right'] as const) {
      const hand = this.hands[side], hold = this.holding[side];
      const asked = hand.asked && time - hand.asked.time < 1.5 * dt ? hand.asked.shape : null;
      this.ease(hand, hold ? this.held(hand, hold, time) ?? hand.shape : hand.coming ? coming(hand.coming) : asked ?? RELAXED, seconds);
    }
  }

  /** a hand verb is bringing `side` to `grip`, or no longer is (`null`): until it holds it, the hand opens as it comes — or, to put a
   * digit's pad on it, takes the shape it touches it in, as a finger points before it presses */
  toward(side: 'left' | 'right', coming: Grip | null): void {
    this.hands[side].coming = coming;
  }

  /**
   * `side`'s fingers eased `seconds` on toward `to`: on the way to an empty, open; once the wrist is there (`gripOn`), closed on its thing
   * with the empty's asks laid over that — once while it is given it, and afresh while the wrist still settles onto it (moving `MOVED` on
   * it), else the fingers stay as they closed short of the thing on arriving; a shape; or relaxed
   */
  set(side: 'left' | 'right', to: Fingers | Object3D | null, seconds: number): void {
    const hand = this.hands[side];
    if (to === null || !('isObject3D' in to)) {
      hand.closed = null;
      return this.ease(hand, to === null ? RELAXED : shapeOf(to), seconds);
    }
    const { wrist } = this.gripOn(side, to), off = hand.joints.hand.getWorldPosition(new Vector3()).sub(wrist);
    if (off.length() > ARRIVED) {
      hand.closed = null;
      return this.ease(hand, APERTURE, seconds);
    }
    const thing = to.parent;
    if (!thing) throw new Error(`fingers: "${to.name}" hangs from nothing`);
    if (hand.closed?.on !== to || !hand.closed.off || hand.closed.off.distanceTo(off) > MOVED) {
      hand.closed = { on: to, shape: this.taking(hand, Thing.of(thing).grip(to.name), thing), off };
      hand.reached.clear();
    }
    this.ease(hand, this.asked(hand, hand.closed.shape, to, thing), seconds);
  }

  /**
   * Where hand `side`'s bone goes to hold `empty` (a grip of its parent): its wrist and its bone's rotation (world) — see `Body.gripOn`.
   * The hand comes turned as it stands now, as little as the grip asks turned off that: its handle's axis along the hand's grasp line, its
   * palm or pad facing as it asks.
   */
  gripOn(side: 'left' | 'right', empty: Object3D): { wrist: Vector3; rotation: Quaternion } {
    const owner = empty.parent;
    if (!owner) throw new Error(`gripOn: "${empty.name}" hangs from nothing`);
    const grip = Thing.of(owner).grip(empty.name), hand = this.hands[side].joints.hand, contact = this.contact(side, grip);
    owner.updateWorldMatrix(true, false);
    const point = grip.at.position.clone().applyMatrix4(owner.matrixWorld), now = hand.getWorldQuaternion(new Quaternion());
    const turn = owner.getWorldQuaternion(new Quaternion()), facing = grip.facing?.clone().applyQuaternion(turn);
    const axis = grip.handle?.axis.clone().applyQuaternion(turn);
    const rotation = contact.axis && axis
      ? facing ? turnOnto(contact.axis, contact.facing, axis, facing) : new Quaternion().setFromUnitVectors(contact.axis.clone().applyQuaternion(now), axis).multiply(now)
      : facing ? new Quaternion().setFromUnitVectors(contact.facing.clone().applyQuaternion(now), facing).multiply(now) : now;
    const scale = new Vector3().setFromMatrixScale(hand.matrixWorld).x;
    return { wrist: point.sub(contact.at.multiplyScalar(scale).applyQuaternion(rotation)), rotation };
  }

  /** where hand `side` holds `grip` (see `Contact`): on a handle, in its grasp; with a pad, that digit's as the grip shapes it; else the palm */
  contact(side: 'left' | 'right', grip: Grip): Contact {
    const joints = this.hands[side].joints;
    if (!grip.handle) return joints.touch(grip.pad, shapeOf(values(grip.node), RELAXED));
    joints.hand.updateWorldMatrix(true, false);
    return joints.handle(grip.handle.radius / new Vector3().setFromMatrixScale(joints.hand.matrixWorld).x);
  }

  /** the shape `hand` takes on `hold` (none yet: its palm still settling): its grip's asks laid over the shape it closed to */
  private held(hand: Hand, hold: Hold, time: number): Shape | null {
    const since = this.since.get(hold) ?? time;
    this.since.set(hold, since);
    if (time - since < SETTLE) return null;
    const grip = hold.thing.grip(hold.grip);
    if (hand.closed?.on !== hold) {
      hand.closed = { on: hold, shape: this.taking(hand, grip, hold.thing.object), off: null };
      hand.reached.clear();
    }
    return this.asked(hand, hand.closed.shape, grip.node, hold.thing.object);
  }

  /** the shape `hand` takes `grip` of `thing` in, before its asks: closed on it, or relaxed touching it with a pad */
  private taking(hand: Hand, grip: Grip, thing: Object3D): Shape {
    return grip.pad ? structuredClone(RELAXED) : closedOn(hand.joints, thing);
  }

  /**
   * `closed` with what `grip` (an empty on `thing`) asks in `userData.fingers` laid over it: each digit given values takes them; each
   * given an empty's name reaches its pad there, afresh once the empty moves in the hand (not the digit whose pad the grip is: the hand
   * goes so that it is there)
   */
  private asked(hand: Hand, closed: Shape, grip: Object3D, thing: Object3D): Shape {
    const shape = shapeOf(values(grip), closed);
    for (const [name, value] of Object.entries(asks(grip))) {
      if (typeof value !== 'string') continue;
      if (name === grip.userData.pad) throw new Error(`"${grip.name}" userData.fingers.${name}: its pad is the grip's, where the hand puts it`);
      const digit = digitOf(name, `"${grip.name}" userData.fingers`), empty = thing.getObjectByName(value);
      if (!empty) throw new Error(`"${grip.name}" userData.fingers.${name}: "${thing.name}" has no empty named "${value}"`);
      const target = handFrame(hand.joints.hand, empty), last = hand.reached.get(digit);
      const afresh = last?.empty !== value;
      if (afresh || !last || last.target.distanceTo(target) > MOVED) {
        const reached = structuredClone(afresh || !last ? shape : last.shape);
        reaching(hand.joints, thing, reached, digit, target, afresh);
        hand.reached.set(digit, { empty: value, target, shape: reached });
      }
      const reached = hand.reached.get(digit)?.shape;
      if (!reached) continue;
      if (digit === 'thumb') shape.thumb = { ...reached.thumb };
      else shape[digit] = { ...reached[digit] };
    }
    return shape;
  }

  private ease(hand: Hand, goal: Shape, seconds: number): void {
    easeShape(hand.shape, goal, seconds);
    hand.joints.write(hand.shape);
  }
}

/** what `grip` asks of the fingers in `userData.fingers`, by digit: values, or an empty's name (none: nothing) */
function asks(grip: Object3D): Record<string, unknown> {
  const asked: unknown = grip.userData.fingers;
  if (asked === undefined) return {};
  if (typeof asked !== 'object' || asked === null) throw new Error(`"${grip.name}" userData.fingers is neither digits' values nor empties' names`);
  return Object.fromEntries(Object.entries(asked));
}

/** the shape a hand coming to `grip` takes on its way (see `FingerState.toward`) */
function coming(grip: Grip): Shape {
  return grip.pad ? shapeOf(values(grip.node), RELAXED) : APERTURE;
}

/** the digits' values `grip` asks (`asks`), those it puts on an empty left out */
function values(grip: Object3D): Fingers {
  return Object.fromEntries(Object.entries(asks(grip)).filter(([, value]) => typeof value !== 'string'));
}

/** where `empty` is in `hand`'s frame as the scene stands now */
function handFrame(hand: Object3D, empty: Object3D): Vector3 {
  hand.updateWorldMatrix(true, false);
  empty.updateWorldMatrix(true, false);
  return new Vector3().setFromMatrixPosition(empty.matrixWorld).applyMatrix4(new Matrix4().copy(hand.matrixWorld).invert());
}

/** the skinned meshes under `model` that `hand` bends (none: a bare body) */
function skinsOf(model: Object3D, hand: Object3D): SkinnedMesh[] {
  const found: SkinnedMesh[] = [];
  model.traverse((node) => { if (node instanceof SkinnedMesh && node.skeleton.bones.some((bone) => bone === hand)) found.push(node); });
  return found;
}
