import { Matrix4, Object3D, Quaternion, SkinnedMesh, Vector3 } from 'three';
import { smoothstep } from '../kernel/math';
import type { Placement } from '../kernel/goal';
import { Thing, type Grip } from '../things/thing';
import type { Hold } from '../things/resolve';
import { heldTurn } from '../things/hold';
import type { DigitBones } from './bones';
import { closedOn, type Opposed } from './closing';
import { DIGIT, meet, type Arm, type Contact } from './contact';
import type { HandPoint } from './point';
import { Joints, PINCH } from './joints';
import { blendShape, digitOf, easeShape, POINT, RELAXED, shapeOf, type Digit, type Fingers, type Shape } from './shape';

/** One hand's fingers: its bones, its shape as last written, what a pose asks of it, the shape it closed to on what it holds (and where
 * its thumb's pad opposes it, in the thing's frame), the grip a hand verb is bringing it to, and the shape its contacts were last met in,
 * when. */
interface Hand {
  joints: Joints;
  shape: Shape;
  asked: Shape | null;
  closed: { on: Hold | Object3D; shape: Shape; thumb: Opposed | null; off: Vector3; since: number } | null;
  coming: Object3D | null;
  met: { shape: Shape; digits: readonly Digit[] } | null;
}

/**
 * a hand on its way to a grip opens to take it (Jeannerod 1984: the grip opens wider than the object late in the reach, closing on it as
 * the hand arrives): the thumb out in front of the palm, the fingers side by side and a little bent, each a little more than the one before
 * as a relaxed hand's are, their tips barely hooked (all alike, the open hand read as a mannequin's claw; fanned, as a stiff splayed hand;
 * hooked more, a claw closing on nothing) — relaxed until its wrist is `NEARING` from where it holds the grip, open from `NEAR` (m: opened
 * all the way, it travelled 0.6 s as a palm-up claw), and closing on it within `ARRIVED` (m); a fingertip's hand points as it nears instead
 */
const APERTURE: Shape = {
  thumb: { curl: 0.12, oppose: 0.1, spread: 0.55 },
  index: { curl: 0.16, hook: 0.05, spread: 0.06 }, middle: { curl: 0.2, hook: 0.06, spread: 0 }, ring: { curl: 0.25, hook: 0.07, spread: 0.05 },
  little: { curl: 0.3, hook: 0.08, spread: 0.1 },
};
const NEARING = 0.22, NEAR = 0.08, ARRIVED = 0.015;
/** a fingertip's hand points only late, from this far off where it presses until this near (m): from `NEARING`, the index was out half
 * a second before it met its button */
const POINTING = { nearing: 0.12, near: 0.05 } as const;
/** how far a hand's wrist may move on what it holds before it closes on it afresh (m), for how long after it first closed on it (s): it
 * closes as it settles there, not once it has, and then keeps its grasp */
const MOVED = 0.002, SETTLING = 0.3;
/** how long an arm takes to come onto the contacts of what it has taken hold of (s) */
const TAKING = 0.6;

/**
 * A person's fingers: the shape each hand takes — closed on what it holds (`closedOn`), pointing for a fingertip's grip, opening on its
 * way to a grip, what a pose asks of a free hand, else relaxed — with what its grip's empty asks in `userData.fingers` laid over it; and
 * each sub-step the contacts its grip makes (`contacts`: its pad, palm or grasp on the empty, each digit named to an empty with its pad
 * there, a thumb's pad on the far side of a box) met together with its arm (`meet`), from that shape as preferred. Written after each
 * update over the pose its bones were written in, met contacts as they were met, the rest easing into their shape. Its skin (the skinned
 * mesh its hands bend) measures how thick each finger and the palm are.
 */
export class FingerState {
  private readonly hands: Record<'left' | 'right', Hand>;
  /** when each hold began (s) */
  private readonly began = new WeakMap<Hold, number>();

  constructor(bones: { left: DigitBones; right: DigitBones }, nodes: Readonly<Record<string, Object3D>>, private readonly holding: Readonly<Record<string, Hold | null>>, model: Object3D) {
    const hand = (side: 'left' | 'right'): Hand => {
      const node = nodes[`${side}Hand`];
      if (!node) throw new Error(`fingers: no bone "${side}Hand"`);
      const joints = new Joints(node, bones[side], nodes, side, skinsOf(model, node)), shape = shapeOf({});
      joints.write(shape);
      return { joints, shape, asked: null, closed: null, coming: null, met: null };
    };
    this.hands = { left: hand('left'), right: hand('right') };
  }

  /** `side`'s finger bones */
  joints(side: 'left' | 'right'): Joints {
    return this.hands[side].joints;
  }

  /** a pose asks `side`'s fingers to take `shape` this update */
  ask(side: 'left' | 'right', shape: Shape): void {
    this.hands[side].asked = shape;
  }

  /**
   * `side`'s contacts met this sub-step (at `time`, s) with `arm` — its joints moved with the fingers where it holds what does not hang
   * from it, the hand placed as the pose has it otherwise — the things where `placed` has them: a hand holding something, or within
   * `ARRIVED` of a grip it is coming to, the arm still the reach's (a fingertip's met from `NEAR` out stretched the index 7 cm onto its button
   * in one sub-step)
   */
  meet(side: 'left' | 'right', arm: Arm, placed: (object: Object3D) => Placement, time: number): void {
    const hand = this.hands[side], hold = this.holding[side];
    const empty = hold ? hold.thing.grip(hold.grip).node : hand.coming;
    const thing = empty?.parent;
    if (!empty || !thing) return;
    const grip = Thing.of(thing).grip(empty.name);
    if (!hold) {
      if (this.wristOff(side, arm, grip, thing, placed) > ARRIVED) return;
      arm = { ...arm, bones: [] };
    }
    const closed = hand.closed && (hand.closed.on === hold || hand.closed.on === empty) ? hand.closed : null;
    const preferred = shapeOf(values(grip.node), closed && closed.on === (hold ?? empty) ? closed.shape : this.shaped(hand, grip));
    // (the arm eased onto the contacts as the hold begins: taken all at once, a rifle taken back jerked in the hands)
    if (hold) {
      const began = this.began.get(hold) ?? time;
      this.began.set(hold, began);
      arm = { ...arm, share: smoothstep(0, TAKING, time - began) };
    }
    const contacts = this.contacts(grip, thing, placed), thumb = opposing(closed?.thumb ?? null, contacts, thing, placed);
    hand.met = { shape: this.solved(hand, arm, contacts, thumb, preferred), digits: touching(thumb ? [...contacts, thumb] : contacts) };
  }

  /**
   * `preferred` with the digits `contacts` and `thumb` (where it opposes the handle) touch met together with `arm` (`meet`), as one chain,
   * from where they were last met: the digits bend to their pads' contacts, the arm barely giving for them (`DIGIT`)
   */
  private solved(hand: Hand, arm: Arm | null, contacts: readonly Contact[], thumb: Contact | null, preferred: Shape): Shape {
    const shape = structuredClone(preferred), was = hand.met?.shape ?? hand.shape;
    for (const digit of touching(thumb ? [...contacts, thumb] : contacts)) {
      if (digit === 'thumb') shape.thumb = { ...was.thumb };
      else shape[digit] = { ...was[digit] };
    }
    meet(hand.joints, arm, thumb ? [...contacts, thumb] : contacts, shape, preferred);
    return shape;
  }

  /** each hand eased `seconds` on toward what it holds, what a pose asked of it this update, or relaxed — one whose contacts were met
   * this update put as they were last met — at `time` (s); what was met and asked then let go, each asked afresh the next */
  update(seconds: number, time: number): void {
    for (const side of ['left', 'right'] as const) {
      const hand = this.hands[side], hold = this.holding[side];
      if (hold && (hand.closed?.on !== hold || (time - hand.closed.since < SETTLING && hand.closed.off.distanceTo(offOn(hand, hold.thing.object)) > MOVED))) {
        this.close(hand, hold.thing.grip(hold.grip), hold.thing.object, hold, time);
      }
      const { met, asked } = hand;
      [hand.met, hand.asked] = [null, null];
      if (met) this.ease(hand, met.shape, seconds, met.digits);
      else this.ease(hand, hold ? shapeOf(values(hold.thing.grip(hold.grip).node), hand.closed?.shape ?? hand.shape) : hand.coming ? this.onto(side, hand.coming, time) : asked ?? RELAXED, seconds);
    }
  }

  /** a hand verb is bringing `side` to the grip `empty`, or no longer is (null): until it holds it, the hand shapes for it as it comes (`onto`) */
  toward(side: 'left' | 'right', empty: Object3D | null): void {
    this.hands[side].coming = empty;
  }

  /** `side`'s fingers eased `seconds` on toward `to`, for a hand its app poses: an empty's grip as they come to it and take it (`onto`),
   * its contacts met from where the hand is; a shape; or relaxed */
  set(side: 'left' | 'right', to: Fingers | Object3D | null, seconds: number): void {
    const hand = this.hands[side];
    if (!(to instanceof Object3D)) {
      hand.closed = null;
      return this.ease(hand, to === null ? RELAXED : shapeOf(to), seconds);
    }
    const goal = this.onto(side, to), thing = to.parent;
    const grip = thing && Thing.of(thing).grip(to.name);
    if (!grip || !thing || hand.closed?.on !== to) return this.ease(hand, goal, seconds);
    const contacts = this.contacts(grip, thing, worldOf), thumb = opposing(hand.closed.thumb, contacts, thing, worldOf);
    const shape = this.solved(hand, null, contacts, thumb, goal), digits = touching(thumb ? [...contacts, thumb] : contacts);
    this.ease(hand, shape, seconds, digits);
  }

  /**
   * Where hand `side`'s bone goes to hold `empty` (a grip of its parent): its wrist and its bone's rotation (world) — see `Body.gripOn`:
   * as a grab puts it (`goalOn`), from the hand's turn now
   */
  gripOn(side: 'left' | 'right', empty: Object3D): { wrist: Vector3; rotation: Quaternion } {
    const owner = empty.parent;
    if (!owner) throw new Error(`gripOn: "${empty.name}" hangs from nothing`);
    const grip = Thing.of(owner).grip(empty.name), hand = this.hands[side].joints.hand, part = this.part(side, grip);
    const placed = worldOf(owner), back = placed.quaternion.clone().invert(), scale = new Vector3().setFromMatrixScale(hand.matrixWorld).x;
    const now = back.clone().multiply(hand.getWorldQuaternion(new Quaternion()));
    const turn = heldTurn(grip, { at: part.at, turn: () => now, hand: part, up: new Vector3(0, 1, 0).applyQuaternion(back) });
    const wrist = part.at.clone().multiplyScalar(scale).applyQuaternion(turn).negate().add(grip.at.position).applyQuaternion(placed.quaternion).add(placed.position);
    return { wrist, rotation: placed.quaternion.clone().multiply(turn) };
  }

  /** where hand `side` holds `grip` (see `HandPoint`): on a handle, in its grasp; with a pad, that digit's as the grip shapes it; else the palm */
  part(side: 'left' | 'right', grip: Grip): HandPoint {
    const joints = this.hands[side].joints;
    if (!grip.handle) return joints.touch(grip.pad, shapeOf(values(grip.node), grip.pad ? POINT : RELAXED));
    joints.hand.updateWorldMatrix(true, false);
    return joints.handle(grip.handle.radius / new Vector3().setFromMatrixScale(joints.hand.matrixWorld).x);
  }

  /**
   * the contacts a hand makes on `grip` of `thing` (`placed` where it is): its pad — pushing along the grip's `facing` — its grasp on a
   * handle there, its grasp line along the handle's axis, or its palm on the empty, facing as the grip asks; each digit `userData.fingers`
   * names to an empty with its pad there
   */
  private contacts(grip: Grip, thing: Object3D, placed: (object: Object3D) => Placement): Contact[] {
    const at = placed(thing), world = (local: Vector3) => local.clone().applyQuaternion(at.quaternion).add(at.position);
    const turned = (local: Vector3 | null) => local?.clone().applyQuaternion(at.quaternion);
    const facing = turned(grip.facing) ?? undefined, centre = world(grip.at.position), line = turned(grip.handle?.axis ?? null);
    // (a digit's pad on what the hand holds presses with its flat toward the grip's middle — its line, on a handle — as a grasp opposes the
    // thumb to the fingers and the palm across it: a thumb's on a magazine's face toward the fingers on the other, a trigger finger's back
    // toward the grip)
    const pinching = (part: Digit, at: Vector3): Contact => {
      const toward = centre.clone().sub(at);
      if (line) toward.addScaledVector(line, -toward.dot(line));
      return { part, at, round: PINCH, weight: DIGIT, ...(toward.lengthSq() > 1e-8 && { facing: toward.normalize() }) };
    };
    const contacts: Contact[] = [grip.pad ? { part: grip.pad, at: centre, facing }
      : grip.handle ? { part: 'handle', at: centre, axis: line ?? undefined, facing, radius: grip.handle.radius }
        : { part: 'palm', at: centre, facing }];
    for (const [name, value] of Object.entries(asks(grip.node))) {
      if (typeof value !== 'string') continue;
      if (name === grip.pad) throw new Error(`"${grip.node.name}" userData.fingers.${name}: its pad is the grip's own, on it`);
      const empty = thing.getObjectByName(value);
      if (!empty) throw new Error(`"${grip.node.name}" userData.fingers.${name}: "${thing.name}" has no empty named "${value}"`);
      // (where the empty is on the thing as it stands, carried to where `placed` has the thing)
      thing.updateWorldMatrix(true, true);
      const local = new Vector3().setFromMatrixPosition(empty.matrixWorld).applyMatrix4(new Matrix4().copy(thing.matrixWorld).invert());
      contacts.push(pinching(digitOf(name, `"${grip.node.name}" userData.fingers`), world(local)));
    }
    return contacts;
  }

  /** how far the hand bone `arm` has is off where it holds `grip` of `thing` as `placed` has it, turned as it is (m) */
  private wristOff(side: 'left' | 'right', arm: Arm, grip: Grip, thing: Object3D, placed: (object: Object3D) => Placement): number {
    const at = placed(thing), turn = arm.pose.rotation(arm.hand).clone().multiply(arm.rest);
    const part = this.part(side, grip);
    const wrist = part.at.clone().multiplyScalar(arm.scale).applyQuaternion(turn).negate().add(grip.at.position.clone().applyQuaternion(at.quaternion).add(at.position));
    return wrist.distanceTo(arm.pose.position(arm.hand));
  }

  /** the shape `hand` takes for `grip` before it has closed on it: pointing for a pad, else relaxed */
  private shaped(hand: Hand, grip: Grip): Shape {
    return grip.pad ? POINT : hand.shape;
  }

  /** `hand` closed on `grip` of `thing` afresh (`on`: the hold or empty it closed for; `since`, when it first closed on it, kept) */
  private close(hand: Hand, grip: Grip, thing: Object3D, on: Hold | Object3D, time: number): void {
    const again = hand.closed && (hand.closed.on === on || hand.closed.on === grip.node) ? hand.closed : null;
    const since = again?.since ?? time;
    if (grip.pad) {
      hand.closed = { on, shape: shapeOf(values(grip.node), POINT), thumb: null, off: offOn(hand, thing), since };
      return;
    }
    thing.updateWorldMatrix(true, false);
    const turn = thing.getWorldQuaternion(new Quaternion()), handle = grip.handle && { at: grip.at.position.clone().applyMatrix4(thing.matrixWorld), axis: grip.handle.axis.clone().applyQuaternion(turn) };
    const closed = closedOn(hand.joints, thing, handle);
    turn.invert();
    const thumb = closed.thumb && { at: thing.worldToLocal(closed.thumb.at).multiply(new Vector3().setFromMatrixScale(thing.matrixWorld)), facing: closed.thumb.facing.applyQuaternion(turn) };
    hand.closed = { on, shape: closed.shape, thumb, off: offOn(hand, thing), since };
  }

  /**
   * the shape `side` takes for the grip `empty` as its wrist stands off where `gripOn` puts it: relaxed, opening as it nears (`APERTURE`;
   * a fingertip's pointing), and within `ARRIVED` closed on its thing with the empty's asks laid over that
   */
  private onto(side: 'left' | 'right', empty: Object3D, time = 0): Shape {
    const hand = this.hands[side], thing = empty.parent;
    if (!thing) throw new Error(`fingers: "${empty.name}" hangs from nothing`);
    const grip = Thing.of(thing).grip(empty.name);
    const { wrist } = this.gripOn(side, empty), distance = hand.joints.hand.getWorldPosition(new Vector3()).distanceTo(wrist);
    const open = grip.pad ? shapeOf(values(empty), POINT) : APERTURE;
    if (distance > ARRIVED) return blendShape(RELAXED, open, 1 - (grip.pad ? smoothstep(POINTING.near, POINTING.nearing, distance) : smoothstep(NEAR, NEARING, distance)));
    if (hand.closed?.on !== empty || hand.closed.off.distanceTo(offOn(hand, thing)) > MOVED) this.close(hand, grip, thing, empty, time);
    return shapeOf(values(empty), hand.closed?.shape ?? open);
  }

  /** `hand` eased `seconds` on toward `goal`, the digits `at` put there at once (their contacts met), and written */
  private ease(hand: Hand, goal: Shape, seconds: number, at: readonly Digit[] = []): void {
    easeShape(hand.shape, goal, seconds);
    for (const digit of at) {
      if (digit === 'thumb') hand.shape.thumb = { ...goal.thumb };
      else hand.shape[digit] = { ...goal[digit] };
    }
    hand.joints.write(hand.shape);
  }
}

/** the thumb's pad on `opposed` (the thing's frame), where it opposes the handle the hand closed on (`closedOn`), with `thing` where
 * `placed` has it — none where `contacts` already put the thumb on an empty */
function opposing(opposed: Opposed | null, contacts: readonly Contact[], thing: Object3D, placed: (object: Object3D) => Placement): Contact | null {
  if (!opposed || contacts.some((c) => c.part === 'thumb')) return null;
  const at = placed(thing);
  return { part: 'thumb', at: opposed.at.clone().applyQuaternion(at.quaternion).add(at.position), facing: opposed.facing.clone().applyQuaternion(at.quaternion), round: PINCH, weight: DIGIT };
}

/** the digits `contacts` put a pad of on the thing */
function touching(contacts: readonly Contact[]): Digit[] {
  return contacts.flatMap((c) => c.part === 'palm' || c.part === 'handle' ? [] : [c.part]);
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

/** where `hand`'s wrist is on `thing`, in its frame, as the scene stands now */
function offOn(hand: Hand, thing: Object3D): Vector3 {
  thing.updateWorldMatrix(true, false);
  return thing.worldToLocal(hand.joints.hand.getWorldPosition(new Vector3()));
}

/** where `object` is in the world as the scene stands now (its scale left out) */
function worldOf(object: Object3D): Placement {
  object.updateWorldMatrix(true, false);
  const placed = { position: new Vector3(), quaternion: new Quaternion() };
  object.matrixWorld.decompose(placed.position, placed.quaternion, new Vector3());
  return placed;
}

/** the skinned meshes under `model` that `hand` bends (none: a bare body) */
function skinsOf(model: Object3D, hand: Object3D): SkinnedMesh[] {
  const found: SkinnedMesh[] = [];
  model.traverse((node) => { if (node instanceof SkinnedMesh && node.skeleton.bones.some((bone) => bone === hand)) found.push(node); });
  return found;
}
