import { Matrix4, Object3D, Quaternion, SkinnedMesh, Vector3 } from 'three';
import { smoothstep } from '../kernel/math';
import type { Triangles } from '../kernel/triangles';
import type { Placement } from '../kernel/goal';
import { inFrame, placedOf, toWorld, within, worldOf, type Placed } from '../kernel/scene';
import type { Hold } from '../things/resolve';
import type { DigitBones } from './bones';
import { closedOn, PAD_DEPTH } from './closing';
import { meet, type Contact } from './contact';
import { Guard, nearHand } from './guard';
import { digitsOf, handOn, type HandPart, type HandPlacement, type HandPoint } from './placement';
import { Joints, FLAT } from './joints';
import { blendShape, digitOf, DIGITS, POINT, RELAXED, shapeOf, withValues, type Digit, type Fingers, type Shape } from './shape';
import { vectorOf } from '../things/thing';

/** A placement as a hand takes it: the shape its fingers close to there and the thing's triangles about it (the thing's frame), worked
 * out once, as it is first asked for; and the digits it puts apart (a hold's read from its grip every update). */
interface Taken {
  placement: HandPlacement;
  shape: Shape;
  near: Triangles;
  digits: HandPlacement['digits'];
}

/** One hand's fingers: its bones, its shape as last written and what keeps it out of things; what a pose asks of it this update; the
 * placements it has taken; the placement a hand verb brings it to, the shape it set off in and, for a fingertip's, how far it points
 * (0 … 1, as the verb has its way gone; none, as it gets there); the shape its digits' contacts were last met in. */
interface Hand {
  joints: Joints;
  guard: Guard;
  /** the body's own skinned meshes, which the hand never closes on */
  skins: readonly SkinnedMesh[];
  shape: Shape;
  posing: Shape | null;
  /** whether its shape was last eased toward one a pose asked of it (a fist after a press), not one it took holding something */
  posed: boolean;
  taken: WeakMap<HandPlacement, Taken>;
  /** each placement as the hand took what hangs from it: closed where the hand holds it, not where the placement puts it — and where it
   * hung in the hand then */
  hung: WeakMap<HandPlacement, Taken & { local: Placement }>;
  coming: HandPlacement | null;
  from: Shape | null;
  pointing: number | null;
  met: { shape: Shape; digits: readonly Digit[] } | null;
  /** its last solve (`solved`): what it was given, the shape it found and how far it missed, kept once it no longer closes in while nothing
   * it was given has moved */
  solve: { at: Placed; contacts: readonly Contact[]; shape: Shape; settled: boolean; miss: number } | null;
}

/**
 * How a hand shapes for what it takes on its way (Jeannerod 1984: the grip opens wider than the object late in the reach, closing on it
 * as the hand arrives): relaxed until its wrist is `NEARING` from where it goes, preshaped from `NEAR` (m) — each digit turned as it will
 * hold the thing, the thumb already in opposition, but opened, curled only `OPEN` as far — and closing on it within `ARRIVED` (m), each
 * digit then only curling on (from an open hand, the thumb swung round through the thing it opposes); a fingertip's hand points as it
 * nears instead.
 */
const OPEN = 0.3;
const NEARING = 0.4, NEAR = 0.2, ARRIVED = 0.015;
/** how little a hand and its contacts move on what it holds for its last solve to stand (m, rad) */
const STILL = 1e-4;
/** how much nearer its contacts a solve must come than the last to go on solving (m) */
const SETTLED = 1e-4;
/** how far a contact moves on what the hand holds before its digit is started afresh (m): a trigger squeezed is followed on */
const SWEPT = 0.02;
/** how near its goal a hand's shape is to have closed (the most any of its values is off it) */
const CLOSED = 0.15;
/** how far a thing hanging from the hand moves in it before the fingers close on it afresh (m, rad, in the hand's frame) */
const MOVED = 1e-3;
/** how far into the thing from a placement's point the grasp's line runs, which the thumb opposes the fingers across and a digit pressing
 * on an empty presses toward (m) */
const INTO = 0.02;

/**
 * A person's fingers: the shape each hand takes for its placement (`HandPlacement`) — closed on what it holds as its placement has the
 * hand there (`closedOn`: worked out once, where the hand goes, not where it is on its way), pointing for a fingertip's, opening on its
 * way, what a pose asks of a free hand, else relaxed — and each sub-step the digits its placement presses on empties met where the hand
 * is (`meet`). Written after each update over the pose its bones were written in. The fingers never move the hand. Its skin (the skinned
 * mesh its hands bend) measures how thick each finger and the palm are.
 */
export class FingerState {
  private readonly hands: Record<'left' | 'right', Hand>;

  constructor(bones: { left: DigitBones; right: DigitBones }, nodes: Readonly<Record<string, Object3D>>, private readonly holding: Readonly<Record<string, Hold | null>>, model: Object3D) {
    const hand = (side: 'left' | 'right'): Hand => {
      const node = nodes[`${side}Hand`];
      if (!node) throw new Error(`fingers: no bone "${side}Hand"`);
      // (its bones left as they stand: eased from there by its first update)
      const skins = skinsOf(model, node), joints = new Joints(node, bones[side], nodes, side, skins), shape = shapeOf({});
      return { joints, guard: new Guard(joints, skins), skins, shape, posing: null, posed: false, taken: new WeakMap(), hung: new WeakMap(), coming: null, from: null, pointing: null, met: null, solve: null };
    };
    this.hands = { left: hand('left'), right: hand('right') };
  }

  /** a pose asks `side`'s fingers to take `shape` this update */
  ask(side: 'left' | 'right', shape: Shape): void {
    this.hands[side].posing = shape;
  }

  /** `side`'s free hand keeps the shape it has this update, as a pose asked it (a fingertip drawing back off its button) */
  keep(side: 'left' | 'right'): void {
    this.hands[side].posing = structuredClone(this.hands[side].shape);
  }

  /** where `part` of `side`'s hand is as `shape` has it (see `HandPoint`; the hand's node's frame) */
  point(side: 'left' | 'right', part: HandPart, shape: Shape = POINT): HandPoint {
    return this.hands[side].joints.point(part, shape);
  }

  /** how deep `side`'s palm sinks into `thing` with its node at `node` (the thing's frame): its flesh's deepest (m) */
  sunk(side: 'left' | 'right', thing: Object3D): (node: Placement) => number {
    const { joints, skins } = this.hands[side], frame = worldOf(thing), near = nearHand(joints, skins, thing, frame), scale = placedOf(joints.hand).scale;
    const matrix = new Matrix4(), balls = joints.flesh(null, RELAXED);
    return (node) => {
      matrix.compose(node.position, node.quaternion, _scale.setScalar(scale));
      return Math.max(0, ...balls.map((ball) => near.depth(ball.at.clone().applyMatrix4(matrix), ball.radius * scale * PAD_DEPTH, 0.03)));
    };
  }

  /**
   * `side`'s digits pressing on empties met this sub-step, the hand where `at` places it (its node, in the world) and the things where
   * `placed` has them: a hand holding something, the arm having brought it there — not one still coming to it, shaped as it comes
   */
  meet(side: 'left' | 'right', at: Placed, placed: (object: Object3D) => Placement): void {
    const hand = this.hands[side], taken = this.held(side);
    if (!taken) return;
    const thing = taken.placement.on, contacts = contactsOf(taken.placement, taken.digits);
    if (!contacts.length) return;
    // (on what hangs from the hand, the hand where it carries it: placed as the body last read it, a sub-step behind the hand, the thing
    // would move with every step of a carry)
    const local = within(thing, hand.joints.hand) ? { ...inFrame(placedOf(hand.joints.hand), worldOf(thing)), scale: at.scale } : inFrame(at, placed(thing));
    hand.met = { shape: this.solved(hand, taken, local, contacts), digits: contacts.map((c) => c.part) };
  }

  /** whether `side`'s hand has closed on what it holds: its shape within `CLOSED` of the one it closes to */
  closed(side: 'left' | 'right'): boolean {
    const hand = this.hands[side], taken = this.held(side);
    return taken !== null && closedTo(hand.shape, hand.solve?.shape ?? goalOf(taken));
  }

  /** each hand eased `seconds` on toward what it holds, what a pose asked of it this update, or relaxed — one whose contacts were met
   * this update put as they were last met; what was met and asked then let go, each asked afresh the next */
  update(seconds: number): void {
    for (const side of ['left', 'right'] as const) {
      const hand = this.hands[side], taken = this.held(side), { met, posing } = hand;
      [hand.met, hand.posing] = [null, null];
      if (taken) hand.posed = false;
      else if (!hand.coming) hand.posed = posing !== null;
      const goal = met ? met.shape : taken ? goalOf(taken) : posing ?? (hand.coming ? this.onto(hand, hand.coming) : RELAXED);
      // (what it holds keeps its digits out itself, closed round it and its contacts met clear of it)
      if (taken) hand.guard.holding(taken.placement.on);
      this.ease(hand, goal, seconds, taken ? false : hand.coming?.on ?? null, met?.digits);
    }
  }

  /** a hand verb is bringing `side` to `placement`, or no longer is (null): until it holds it, the hand shapes for it as it comes (`onto`),
   * from the shape it sets off in if a pose asked it of it — a fist kept back from a button — else from relaxed */
  toward(side: 'left' | 'right', placement: HandPlacement | null): void {
    const hand = this.hands[side];
    if (placement) this.take(hand, placement);
    [hand.coming, hand.from, hand.pointing] = [placement, placement && hand.posed ? structuredClone(hand.shape) : null, null];
  }

  /** how far `side`'s hand, on its way to a fingertip's placement, points (0 … 1): as far as the verb bringing it has gone toward its run */
  pointAt(side: 'left' | 'right', share: number): void {
    this.hands[side].pointing = share;
  }

  /** `side`'s fingers eased `seconds` on toward `to`, for a hand its app poses: a placement as they come to it and take it (`onto`), its
   * digits' contacts met from where the hand is; a shape; or relaxed */
  set(side: 'left' | 'right', to: HandPlacement | Fingers | null, seconds: number): void {
    const hand = this.hands[side];
    if (to === null || !('on' in to)) return this.ease(hand, to === null ? RELAXED : shapeOf(to), seconds, null);
    const taken = this.take(hand, to), thing = to.on, goal = this.onto(hand, to), contacts = contactsOf(to, to.digits);
    if (!this.arrived(hand, taken)) return this.ease(hand, goal, seconds, thing);
    // (there, it holds it, as `update` has a hand holding: closed round it, kept out of it by its shape, not by where its digits came in)
    hand.guard.holding(thing);
    if (!contacts.length) return this.ease(hand, goal, seconds, false);
    this.ease(hand, this.solved(hand, taken, inFrame(placedOf(hand.joints.hand), worldOf(thing)), contacts), seconds, false, contacts.map((c) => c.part));
  }

  /** where hand `side`'s bone goes for `placement`: its wrist and its node's rotation (world) — see `Body.gripOn` */
  gripOn(side: 'left' | 'right', placement: HandPlacement): { wrist: Vector3; rotation: Quaternion } {
    const at = toWorld(this.nodeOf(this.hands[side], placement), worldOf(placement.on));
    return { wrist: at.position, rotation: at.quaternion };
  }

  /** what `side` holds, as its hand takes it, its digits as its grip puts them apart now (none: nothing, or nothing placed) */
  private held(side: 'left' | 'right'): Taken | null {
    const hold = this.holding[side], placement = hold?.placement, hand = this.hands[side];
    if (!hold || !placement) return null;
    const taken = this.hung(hand, placement);
    taken.digits = digitsOf(hold.thing.object, hold.thing.grip(hold.grip));
    return taken;
  }

  /** `placement` as `hand` takes it — what hangs from the hand closed on where the hand holds it, which may be turned off its placement
   * (a reach's turn is only preferred), so the fingers meet its faces as it hangs; closed afresh once it has moved in the hand (a regrip,
   * a seat on its place) */
  private hung(hand: Hand, placement: HandPlacement): Taken {
    if (!within(placement.on, hand.joints.hand)) return this.take(hand, placement);
    const known = hand.hung.get(placement), { position, quaternion } = placement.on;
    if (known && known.local.position.distanceTo(position) < MOVED && known.local.quaternion.angleTo(quaternion) < MOVED) return known;
    const taken = { ...this.take(hand, placement, inFrame(placedOf(hand.joints.hand), worldOf(placement.on))), local: { position: position.clone(), quaternion: quaternion.clone() } };
    hand.hung.set(placement, taken);
    return taken;
  }

  /**
   * `placement` as `hand` takes it, worked out the first time it is asked for: where its node goes, and the shape its fingers take there
   * — closed round the thing (`closedOn`) from the hand placed so (or at `at`, the thing's frame), or the shape it holds
   */
  private take(hand: Hand, placement: HandPlacement, at?: Placement): Taken {
    const known = at ? undefined : hand.taken.get(placement);
    if (known) return known;
    const thing = placement.on, { joints, skins } = hand;
    thing.updateWorldMatrix(true, true);
    const frame = worldOf(thing), scale = placedOf(joints.hand).scale, held = placement.fingers === 'close' ? null : shapeOf(placement.fingers);
    const node = at ?? this.nodeOf(hand, placement);
    const near = nearHand(joints, skins, thing, frame, node.position);
    let shape = held ?? RELAXED;
    if (!held) {
      const world = toWorld(node, frame), matrix = new Matrix4().compose(world.position, world.quaternion, _scale.setScalar(scale));
      shape = closedOn(joints, thing, lineOf(placement, frame), skins, matrix);
    }
    const taken = { placement, shape, near, digits: placement.digits };
    if (!at) hand.taken.set(placement, taken);
    return taken;
  }

  /** where `hand`'s node goes for `placement`, in its thing's frame: its point on its target */
  private nodeOf(hand: Hand, placement: HandPlacement): Placement {
    const held = placement.fingers === 'close' ? null : shapeOf(placement.fingers);
    return handOn(hand.joints.point(placement.point, held ?? POINT), placement, placedOf(hand.joints.hand).scale);
  }

  /** `taken`'s shape with the digits its placement presses on empties met where `at` places the hand (`meet`; the thing's frame), from
   * where they were last met */
  private solved(hand: Hand, taken: Taken, at: Placed, contacts: readonly Contact[]): Shape {
    const preferred = goalOf(taken);
    // (as last solved while the hand and its contacts stay where they were on the thing: a hand held still on it, however it turns)
    const last = hand.solve;
    if (last?.settled && last.at.position.distanceTo(at.position) < STILL && last.at.quaternion.angleTo(at.quaternion) < STILL && sameContacts(last.contacts, contacts)) {
      return structuredClone(last.shape);
    }
    // (followed on from where they were last met; a digit whose contact has moved on the thing, or is new, started afresh: put onto
    // another face, it would otherwise follow on from the face it left)
    const shape = structuredClone(preferred), was = hand.met?.shape ?? hand.shape;
    for (const { part } of contacts) withValues(shape, part, was[part]);
    const swept = contacts.filter((c) => !last?.contacts.some((was) => was.part === c.part && was.at.distanceTo(c.at) < SWEPT)).map((c) => c.part);
    const miss = meet(hand.joints, at, contacts, shape, { preferred, near: taken.near, swept });
    // (kept only once it has stopped closing in: met on from where it got to the next sub-step until then, not frozen short of its contact)
    hand.solve = { at, contacts, shape: structuredClone(shape), settled: last !== null && sameContacts(last.contacts, contacts) && last.miss - miss < SETTLED, miss };
    return shape;
  }

  /** whether `hand`'s node is within `ARRIVED` of where `taken` puts it */
  private arrived(hand: Hand, taken: Taken): boolean {
    const wrist = toWorld(this.nodeOf(hand, taken.placement), worldOf(taken.placement.on)).position;
    return hand.joints.hand.getWorldPosition(_at).distanceTo(wrist) <= ARRIVED;
  }

  /**
   * the shape `side` takes for the placement it comes to as its wrist stands off where it goes: relaxed, preshaped as it nears (`OPEN`;
   * a fingertip's pointing), and within `ARRIVED` the shape it takes there
   */
  private onto(hand: Hand, placement: HandPlacement): Shape {
    const taken = this.take(hand, placement);
    const wrist = toWorld(this.nodeOf(hand, placement), worldOf(placement.on)).position, distance = hand.joints.hand.getWorldPosition(_at).distanceTo(wrist);
    const point = taken.placement.point, pad = point !== 'palm' ? point : null;
    // (a fingertip's hand comes as a loose fist, its digit curled with the others, and points before its way's final run alone, as its
    // verb says how far it has gone; any other hand keeps the shape it set off in and opens as it nears)
    if (pad) {
      const open = goalOf(taken);
      return hand.pointing === null || hand.pointing >= 1 ? open : blendShape(pad === 'thumb' ? open : { ...open, [pad]: open.middle }, open, hand.pointing);
    }
    const closed = goalOf(taken);
    if (distance > ARRIVED) return blendShape(hand.from ?? RELAXED, preshaped(closed), 1 - smoothstep(NEAR, NEARING, distance));
    return closed;
  }

  /** `hand` eased `seconds` on toward `goal`, the digits `at` put there at once (their contacts met), kept out of what it comes to (`on`;
   * `false`: it holds something), and written */
  private ease(hand: Hand, goal: Shape, seconds: number, on: Object3D | null | false, at: readonly Digit[] = []): void {
    hand.guard.ease(hand.shape, goal, seconds, on, at);
    hand.joints.write(hand.shape, seconds);
  }
}

/** the shape `taken` holds: the one it closed to, with the values it gives digits laid over it */
function goalOf(taken: Taken): Shape {
  const shape = structuredClone(taken.shape);
  for (const [digit, values] of Object.entries(taken.digits ?? {})) {
    if (!(values instanceof Object3D)) withValues(shape, digitOf(digit, 'digits'), values);
  }
  return shape;
}

/** `closed` opened for a hand on its way to it (see `OPEN`): each digit turned as `closed` has it, its curl and hook `OPEN` of the way */
function preshaped(closed: Shape): Shape {
  const shape = structuredClone(closed);
  shape.thumb.curl *= OPEN;
  for (const digit of DIGITS) Object.assign(shape[digit], { curl: shape[digit].curl * OPEN, hook: shape[digit].hook * OPEN });
  return shape;
}

/** the grasp's line through what `placement` holds (the world; `frame`: the thing's): along its grasp line, `INTO` in from its point */
function lineOf(placement: HandPlacement, frame: Placement) {
  const turn = frame.quaternion.clone().multiply(placement.quaternion);
  return {
    at: _y.set(0, 1, 0).applyQuaternion(placement.quaternion).multiplyScalar(INTO).add(placement.position).applyQuaternion(frame.quaternion).add(frame.position).clone(),
    axis: new Vector3(1, 0, 0).applyQuaternion(turn),
  };
}

/**
 * the contacts `digits` make on the empties `placement` presses them on, in its thing's frame (as the empties stand): each pad on its
 * empty, pressing with its flat along the empty's own `userData.facing`, else toward the grasp's line (`lineOf`), as a grasp opposes the
 * fingers and the thumb across what it holds
 */
function contactsOf(placement: HandPlacement, digits: HandPlacement['digits']): Contact[] {
  const thing = placement.on, contacts: Contact[] = [];
  thing.updateWorldMatrix(true, true);
  const back = new Matrix4().copy(thing.matrixWorld).invert(), turn = thing.getWorldQuaternion(new Quaternion()).invert();
  const line = new Vector3(1, 0, 0).applyQuaternion(placement.quaternion);
  const centre = new Vector3(0, 1, 0).applyQuaternion(placement.quaternion).multiplyScalar(INTO).add(placement.position);
  for (const [digit, empty] of Object.entries(digits ?? {})) {
    if (!(empty instanceof Object3D)) continue;
    const at = new Vector3().setFromMatrixPosition(empty.matrixWorld).applyMatrix4(back), facing: unknown = empty.userData.facing;
    const toward = facing === undefined ? centre.clone().sub(at).projectOnPlane(line) : vectorOf(facing, `"${empty.name}" userData.facing`).normalize().applyQuaternion(empty.getWorldQuaternion(new Quaternion()).premultiply(turn));
    contacts.push({ part: digitOf(digit, 'digits'), at, round: FLAT, ...(toward.lengthSq() > 1e-8 && { facing: toward.normalize() }) });
  }
  return contacts;
}

/** whether contacts `a` and `b` are on the same digits at the same places (within `STILL`) */
function sameContacts(a: readonly Contact[], b: readonly Contact[]): boolean {
  return a.length === b.length && a.every((c, k) => c.part === b[k].part && c.at.distanceTo(b[k].at) < STILL);
}

/** whether `shape` is within `CLOSED` of `goal`, every value */
function closedTo(shape: Shape, goal: Shape): boolean {
  const off = (a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>) => Object.keys(a).every((key) => Math.abs(a[key] - b[key]) <= CLOSED);
  return off(shape.thumb, goal.thumb) && off(shape.index, goal.index) && off(shape.middle, goal.middle) && off(shape.ring, goal.ring) && off(shape.little, goal.little);
}

/** the skinned meshes under `model` that `hand` bends (none: a bare body) */
function skinsOf(model: Object3D, hand: Object3D): SkinnedMesh[] {
  const found: SkinnedMesh[] = [];
  model.traverse((node) => { if (node instanceof SkinnedMesh && node.skeleton.bones.some((bone) => bone === hand)) found.push(node); });
  return found;
}

const _scale = new Vector3(), _at = new Vector3(), _y = new Vector3();
