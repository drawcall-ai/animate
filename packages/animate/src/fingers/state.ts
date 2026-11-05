import { Matrix4, Object3D, Quaternion, SkinnedMesh, Vector3 } from 'three';
import { smoothstep, turnOnto } from '../kernel/math';
import { Thing, type Grip } from '../things/thing';
import type { Hold } from '../things/resolve';
import type { DigitBones } from './bones';
import { closedOn, padToward } from './closing';
import type { Contact } from './contact';
import { Joints } from './joints';
import { blendShape, digitOf, easeShape, POINT, RELAXED, shapeOf, type Digit, type Fingers, type Shape } from './shape';

/** One hand's fingers: its bones, its shape as last written, what a pose asks of it, the shape it closed to on what it holds (for a puppet's
 * grip, with how far its wrist stood off where `gripOn` puts it then), and where each digit a grip puts on one of its empties last reached
 * to (the hand's frame) and how. */
interface Hand {
  joints: Joints;
  shape: Shape;
  asked: { shape: Shape; time: number } | null;
  closed: { on: Hold | Object3D; shape: Shape; off: Vector3 | null } | null;
  reached: Map<Digit, { empty: Object3D; target: Vector3; shape: Shape }>;
  /** the grip's empty a hand verb is bringing it to */
  coming: Object3D | null;
}

/** how long a hand that has taken hold of something waits before its fingers close on it (s): until its palm has settled there */
const SETTLE = 0.1;
/**
 * a hand on its way to a grip opens to take it (Jeannerod 1984: the grip opens wider than the object late in the reach, closing on it as
 * the hand arrives): the thumb out in front of the palm, the fingers side by side and a little bent, each a little more than the one before
 * as a relaxed hand's are, their tips barely hooked (all alike, the open hand read as a mannequin's claw; fanned, as a stiff splayed hand;
 * hooked more, a claw closing on nothing) — relaxed until its wrist is `NEARING` from where it holds the grip, open from `NEAR` (m: opened
 * all the way, it travelled 0.6 s as a palm-up claw), and closing on it within `ARRIVED` (m)
 */
const APERTURE: Shape = {
  thumb: { curl: 0.12, oppose: 0.1, spread: 0.55 },
  index: { curl: 0.16, hook: 0.05, spread: 0.06 }, middle: { curl: 0.2, hook: 0.06, spread: 0 }, ring: { curl: 0.25, hook: 0.07, spread: 0.05 },
  little: { curl: 0.3, hook: 0.08, spread: 0.1 },
};
const NEARING = 0.22, NEAR = 0.08, ARRIVED = 0.015;
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
      this.ease(hand, hold ? this.held(hand, hold, time) ?? hand.shape : hand.coming ? this.onto(side, hand.coming) : asked ?? RELAXED, seconds);
    }
  }

  /** a hand verb is bringing `side` to the grip `empty`, or no longer is (null): until it holds it, the hand shapes for it as it comes (`onto`) */
  toward(side: 'left' | 'right', empty: Object3D | null): void {
    this.hands[side].coming = empty;
  }

  /** `side`'s fingers eased `seconds` on toward `to`: an empty's grip as they come to it and take it (`onto`), a shape, or relaxed */
  set(side: 'left' | 'right', to: Fingers | Object3D | null, seconds: number): void {
    const hand = this.hands[side];
    if (!(to instanceof Object3D)) {
      hand.closed = null;
      return this.ease(hand, to === null ? RELAXED : shapeOf(to), seconds);
    }
    this.ease(hand, this.onto(side, to), seconds);
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
    const rotation = axis
      ? facing ? turnOnto(contact.axis, contact.facing, axis, facing) : new Quaternion().setFromUnitVectors(contact.axis.clone().applyQuaternion(now), axis).multiply(now)
      : facing ? new Quaternion().setFromUnitVectors(contact.facing.clone().applyQuaternion(now), facing).multiply(now) : now;
    const scale = new Vector3().setFromMatrixScale(hand.matrixWorld).x;
    return { wrist: point.sub(contact.at.multiplyScalar(scale).applyQuaternion(rotation)), rotation };
  }

  /** where hand `side` holds `grip` (see `Contact`): on a handle, in its grasp; with a pad, that digit's as the grip shapes it; else the palm */
  contact(side: 'left' | 'right', grip: Grip): Contact {
    const joints = this.hands[side].joints;
    if (!grip.handle) return joints.touch(grip.pad, shapeOf(values(grip.node), grip.pad ? POINT : RELAXED));
    joints.hand.updateWorldMatrix(true, false);
    return joints.handle(grip.handle.radius / new Vector3().setFromMatrixScale(joints.hand.matrixWorld).x);
  }

  /**
   * the shape `side` takes for the grip `empty` as its wrist stands off where `gripOn` puts it: for a pad, relaxed, pointing (or the
   * grip's own shape) as it nears, and its pad on the empty once it is `NEAR`; else relaxed, opening as it nears (`APERTURE`), and within `ARRIVED` closed on its thing with the
   * empty's asks laid over that — afresh while the wrist still settles onto it (moving `MOVED` on it), so the fingers close as the palm
   * meets it, not once it has stopped there
   */
  private onto(side: 'left' | 'right', empty: Object3D): Shape {
    const hand = this.hands[side], thing = empty.parent;
    if (!thing) throw new Error(`fingers: "${empty.name}" hangs from nothing`);
    const grip = Thing.of(thing).grip(empty.name);
    const { wrist } = this.gripOn(side, empty), off = hand.joints.hand.getWorldPosition(new Vector3()).sub(wrist), distance = off.length();
    // (a fingertip's hand comes relaxed, pointing as it nears, the pad met from where the hand is once it pushes in)
    if (grip.pad) return distance > NEAR ? blendShape(RELAXED, shapeOf(values(empty), POINT), 1 - smoothstep(NEAR, NEARING, distance)) : this.asked(hand, shapeOf(values(empty), POINT), empty, thing);
    if (distance > ARRIVED) {
      hand.closed = null;
      return blendShape(RELAXED, APERTURE, 1 - smoothstep(NEAR, NEARING, distance));
    }
    if (hand.closed?.on !== empty || !hand.closed.off || hand.closed.off.distanceTo(off) > MOVED) {
      hand.closed = { on: empty, shape: this.taking(hand, grip, thing, hand.closed?.on === empty ? hand.closed.shape : null), off };
      hand.reached.clear();
    }
    return this.asked(hand, hand.closed.shape, empty, thing);
  }

  /** the shape `hand` takes on `hold` (none yet: its palm still settling): its grip's asks laid over the shape it closed to */
  private held(hand: Hand, hold: Hold, time: number): Shape | null {
    const since = this.since.get(hold) ?? time;
    this.since.set(hold, since);
    if (time - since < SETTLE) return null;
    const grip = hold.thing.grip(hold.grip);
    if (hand.closed?.on !== hold) {
      hand.closed = { on: hold, shape: this.taking(hand, grip, hold.thing.object, hand.closed?.on === grip.node ? hand.closed.shape : null), off: null };
      hand.reached.clear();
    }
    return this.asked(hand, hand.closed.shape, grip.node, hold.thing.object);
  }

  /** the shape `hand` takes `grip` of `thing` in, before its asks: closed on it (again, from `was`), or relaxed touching it with a pad */
  private taking(hand: Hand, grip: Grip, thing: Object3D, was: Shape | null = null): Shape {
    if (grip.pad) return shapeOf(values(grip.node), POINT);
    if (!grip.handle) return closedOn(hand.joints, thing, null, was);
    // (the handle's line in the hand's frame)
    thing.updateWorldMatrix(true, false);
    hand.joints.hand.updateWorldMatrix(true, false);
    const back = new Matrix4().copy(hand.joints.hand.matrixWorld).invert(), turn = thing.getWorldQuaternion(new Quaternion());
    const at = grip.at.position.clone().applyMatrix4(thing.matrixWorld).applyMatrix4(back);
    const axis = grip.handle.axis.clone().applyQuaternion(turn).transformDirection(back);
    return closedOn(hand.joints, thing, { at, axis }, was);
  }

  /**
   * `closed` with what `grip` (an empty on `thing`) asks in `userData.fingers` laid over it — each digit given values takes them — and
   * each of its contacts met from where the hand is now: the grip's own pad on it (the hand put so that it is there, as far as the arm
   * brought it), and each digit given an empty's name with its pad there, pressing on the part the empty hangs from (not on the thing
   * itself); each reached afresh once its empty moves in the hand
   */
  private asked(hand: Hand, closed: Shape, grip: Object3D, thing: Object3D): Shape {
    const shape = shapeOf(values(grip), closed), pad: unknown = grip.userData.pad;
    const contacts = Object.entries(asks(grip)).flatMap(([name, value]) => {
      if (typeof value !== 'string') return [];
      if (name === pad) throw new Error(`"${grip.name}" userData.fingers.${name}: its pad is the grip's own, on it`);
      const empty = thing.getObjectByName(value);
      if (!empty) throw new Error(`"${grip.name}" userData.fingers.${name}: "${thing.name}" has no empty named "${value}"`);
      return [{ digit: digitOf(name, `"${grip.name}" userData.fingers`), empty, pressed: empty.parent === thing ? null : empty.parent }];
    });
    if (pad !== undefined) contacts.push({ digit: digitOf(pad, `"${grip.name}" userData.pad`), empty: grip, pressed: thing });
    for (const { digit, empty, pressed } of contacts) {
      const target = handFrame(hand.joints.hand, empty), last = hand.reached.get(digit);
      const afresh = last?.empty !== empty;
      if (afresh || !last || last.target.distanceTo(target) > MOVED) {
        const reached = structuredClone(afresh || !last ? shape : last.shape);
        padToward(hand.joints, thing, reached, digit, target, afresh, pressed);
        hand.reached.set(digit, { empty, target, shape: reached });
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
