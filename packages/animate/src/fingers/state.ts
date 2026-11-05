import { Matrix4, Quaternion, SkinnedMesh, Vector3, type Object3D } from 'three';
import { turnOnto } from '../kernel/math';
import { Thing } from '../things/thing';
import type { Hold } from '../things/resolve';
import type { DigitBones } from './bones';
import { closedOn, reaching } from './closing';
import { Joints, type Digit } from './joints';
import { DIGITS, easeShape, RELAXED, shapeOf, type Fingers, type Shape } from './shape';

/** One hand's fingers: its bones, its shape as last written, what a pose asks of it, the shape it closed to on what it holds, and where
 * each digit a grip puts on one of its empties last reached to (the hand's frame) and how. */
interface Hand {
  joints: Joints;
  shape: Shape;
  asked: { shape: Shape; time: number } | null;
  closed: { on: Hold | Object3D; shape: Shape } | null;
  reached: Map<Digit, { empty: string; target: Vector3; shape: Shape }>;
  /** a hand verb is bringing it to a grip */
  coming: boolean;
}

/** how long a hand that has taken hold of something waits before its fingers close on it (s): until its palm has settled there */
const SETTLE = 0.1;
/**
 * a hand on its way to a grip opens to take it (Jeannerod 1984: the grip opens wider than the object during the reach, closing on it as
 * the hand arrives), and how near its wrist must come to where it holds the grip before it closes (m)
 */
const APERTURE: Shape = {
  thumb: { curl: 0.05, oppose: 0.4 },
  index: { curl: 0.1, hook: 0.05, spread: 0.15 }, middle: { curl: 0.12, hook: 0.05, spread: 0 }, ring: { curl: 0.14, hook: 0.05, spread: 0.1 },
  little: { curl: 0.16, hook: 0.05, spread: 0.15 },
};
const ARRIVED = 0.015;
/** how far a digit's empty may move in the hand before the digit reaches for it afresh (m) */
const MOVED = 0.002;

/**
 * A person's fingers, written after each update over the pose its bones were written in: a hand holding something closes on it (`closedOn`,
 * once a hold has settled), with what its grip's empty asks in `userData.fingers` laid over that — a digit's values, or the name of an
 * empty on the thing its pad goes to (a trigger); a free hand takes what a pose asks of it, else it hangs relaxed; each easing into its
 * shape. Its skin (the skinned mesh its hands bend) measures how thick each finger and the palm are.
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
      return { joints, shape, asked: null, closed: null, reached: new Map(), coming: false };
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
      this.ease(hand, hold ? this.held(hand, hold, time) ?? hand.shape : hand.coming ? APERTURE : asked ?? RELAXED, seconds);
    }
  }

  /** a hand verb is bringing `side` to a grip (`true`) or no longer is: until it holds it, the hand opens as it comes */
  toward(side: 'left' | 'right', coming: boolean): void {
    this.hands[side].coming = coming;
  }

  /**
   * `side`'s fingers eased `seconds` on toward `to`: on the way to an empty, open; once the wrist is there (`gripOn`), closed on its thing
   * (once, while it is given it); a shape; or relaxed
   */
  set(side: 'left' | 'right', to: Fingers | Object3D | null, seconds: number): void {
    const hand = this.hands[side];
    if (to === null || !('isObject3D' in to)) {
      hand.closed = null;
      return this.ease(hand, to === null ? RELAXED : shapeOf(to), seconds);
    }
    const { wrist } = this.gripOn(side, to), at = hand.joints.hand.getWorldPosition(new Vector3());
    if (at.distanceTo(wrist) > ARRIVED) {
      hand.closed = null;
      return this.ease(hand, APERTURE, seconds);
    }
    const thing = to.parent;
    if (!thing) throw new Error(`fingers: "${to.name}" hangs from nothing`);
    if (hand.closed?.on !== to) {
      hand.closed = { on: to, shape: closedOn(hand.joints, thing) };
      hand.reached.clear();
    }
    this.ease(hand, this.asked(hand, to, thing, hand.closed.shape), seconds);
  }

  /** where hand `side`'s bone goes to hold `empty` (a grip of its parent): its wrist and its bone's rotation (world) — see `Body.gripOn` */
  gripOn(side: 'left' | 'right', empty: Object3D): { wrist: Vector3; rotation: Quaternion } {
    const owner = empty.parent;
    if (!owner) throw new Error(`gripOn: "${empty.name}" hangs from nothing`);
    const grip = Thing.of(owner).grip(empty.name), joints = this.hands[side].joints, hand = joints.hand;
    owner.updateWorldMatrix(true, false);
    hand.updateWorldMatrix(true, false);
    const point = grip.at.position.clone().applyMatrix4(owner.matrixWorld), now = hand.getWorldQuaternion(new Quaternion());
    const scale = new Vector3().setFromMatrixScale(hand.matrixWorld).x;
    if (!grip.handle) return { wrist: point.sub(joints.centre().multiplyScalar(scale).applyQuaternion(now)), rotation: now };
    const turn = owner.getWorldQuaternion(new Quaternion()), line = joints.handleLine(grip.handle.radius / scale);
    const axis = grip.handle.axis.clone().applyQuaternion(turn);
    const rotation = grip.handle.palm
      ? turnOnto(line.axis, line.facing, axis, grip.handle.palm.clone().applyQuaternion(turn))
      : new Quaternion().setFromUnitVectors(line.axis.clone().applyQuaternion(now), axis).multiply(now);
    return { wrist: point.sub(line.at.multiplyScalar(scale).applyQuaternion(rotation)), rotation };
  }

  /** the shape `hand` takes on `hold` (none yet: its palm still settling): its grip's asks laid over the shape it closed to */
  private held(hand: Hand, hold: Hold, time: number): Shape | null {
    const since = this.since.get(hold) ?? time;
    this.since.set(hold, since);
    if (time - since < SETTLE) return null;
    if (hand.closed?.on !== hold) {
      hand.closed = { on: hold, shape: closedOn(hand.joints, hold.thing.object) };
      hand.reached.clear();
    }
    return this.asked(hand, hold.thing.grip(hold.grip).node, hold.thing.object, hand.closed.shape);
  }

  /**
   * `closed` with what `grip` (an empty on `thing`) asks in `userData.fingers` laid over it: each digit given values takes them; each given
   * the name of an empty on `thing` reaches its pad there, afresh once the empty moves in the hand
   */
  private asked(hand: Hand, grip: Object3D, thing: Object3D, closed: Shape): Shape {
    const asked: unknown = grip.userData.fingers;
    if (asked === undefined) return closed;
    if (typeof asked !== 'object' || asked === null) throw new Error(`"${grip.name}" userData.fingers is neither digits' values nor empties' names`);
    const values = Object.fromEntries(Object.entries(asked).filter(([, value]) => typeof value !== 'string'));
    const shape = shapeOf(values, closed);
    for (const [name, value] of Object.entries(asked)) {
      if (typeof value !== 'string') continue;
      const digit = digitOf(name), empty = thing.getObjectByName(value);
      if (!empty) throw new Error(`"${grip.name}" userData.fingers.${name}: "${thing.name}" has no empty named "${value}"`);
      const target = handFrame(hand.joints.hand, empty), last = hand.reached.get(digit);
      const afresh = last?.empty !== value;
      if (afresh || !last || last.target.distanceTo(target) > MOVED) {
        const reached = structuredClone(afresh || !last ? shape : last.shape);
        reaching(hand.joints, reached, digit, target, afresh);
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

/** `name` as a digit; another is a misuse, said at once */
function digitOf(name: string): Digit {
  const digit = (['thumb', ...DIGITS] as const).find((d) => d === name);
  if (digit === undefined) throw new Error(`fingers: a hand has a thumb, ${DIGITS.join(', ')}; not "${name}"`);
  return digit;
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
