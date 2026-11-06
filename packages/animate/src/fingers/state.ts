import { Matrix4, Object3D, Quaternion, SkinnedMesh, Vector3 } from 'three';
import { smoothstep } from '../kernel/math';
import type { Triangles } from '../kernel/triangles';
import type { Placement } from '../kernel/goal';
import { inFrame, placedOf, toWorld, within, worldOf, type Placed } from '../kernel/scene';
import { Thing, vectorOf, type Grip } from '../things/thing';
import type { Hold } from '../things/resolve';
import { heldTurn } from '../hands/person/palm';
import type { DigitBones } from './bones';
import { closedOn, type Opposed } from './closing';
import { meet, type Contact } from './contact';
import { Guard, trianglesAbout } from './guard';
import type { HandPoint } from './point';
import { Joints, PINCH } from './joints';
import { blendShape, digitOf, POINT, RELAXED, shapeOf, type Digit, type Fingers, type Shape } from './shape';

/** What a grip asks of the fingers in `userData.fingers`, by digit: values, or an empty's name. */
type Asks = Readonly<Record<string, unknown>>;

/** How a hand closed on what it holds: what it closed for (a hold, or an empty its app poses it on), the shape it closed to, where its
 * thumb's pad opposes it, where the hand sits on it (`seat`: its node's place and turn; none where the thing hangs from the hand), its
 * contacts and the thing's triangles about it, all in the thing's frame; what its grip asked of the digits then, where its wrist was on
 * the thing and when it first closed (s). */
interface Closed {
  on: Hold | Object3D;
  shape: Shape;
  thumb: Opposed | null;
  seat: Placement | null;
  contacts: readonly Contact[];
  near: Triangles;
  asks: Asks;
  off: Vector3;
  since: number;
}

/** One hand's fingers: its bones, its shape as last written and what keeps it out of things; what a pose asks of it this update; how it
 * closed on what it holds; the grip a hand verb is bringing it to, the shape it set off for it in and, for a fingertip's, how far it
 * points (0 … 1, as the verb has its way gone; none, as it gets there); the shape its contacts were last met in. */
interface Hand {
  joints: Joints;
  guard: Guard;
  /** the body's own skinned meshes, which the hand never closes on */
  skins: readonly SkinnedMesh[];
  shape: Shape;
  posing: Shape | null;
  /** whether its shape was last eased toward one a pose asked of it (a fist after a press), not one it took holding something */
  posed: boolean;
  closed: Closed | null;
  coming: Object3D | null;
  from: Shape | null;
  pointing: number | null;
  met: { shape: Shape; digits: readonly Digit[] } | null;
  /** its last solve (`solved`): what it was given and the shape it found, kept while nothing it was given has moved */
  solve: { at: Placed; contacts: readonly Contact[]; near: Triangles | null; shape: Shape } | null;
}

/**
 * The shape a hand opens to on its way to a grip (Jeannerod 1984: the grip opens wider than the object late in the reach, closing on it
 * as the hand arrives): the thumb out in front of the palm, the fingers side by side, a little bent, each a little more than the one
 * before, their tips barely hooked — relaxed until its wrist is `NEARING` from where it holds the grip, open from `NEAR` (m), closing on it
 * within `ARRIVED` (m); a fingertip's hand points as it nears instead.
 */
const APERTURE: Shape = {
  thumb: { curl: 0.12, oppose: 0.1, spread: 0.55 },
  index: { curl: 0.16, hook: 0.05, spread: 0.06 }, middle: { curl: 0.2, hook: 0.06, spread: 0 }, ring: { curl: 0.25, hook: 0.07, spread: 0.05 },
  little: { curl: 0.3, hook: 0.08, spread: 0.1 },
};
const NEARING = 0.14, NEAR = 0.05, ARRIVED = 0.015;
/** how far a hand's wrist may move on what it holds before it closes on it afresh (m), for how long after it first closed on it (s): it
 * closes as it settles there, not once it has, and then keeps its grasp */
const MOVED = 0.002, SETTLING = 0.3;
/** how little a hand and its contacts move on what it holds for its last solve to stand (m, rad) */
const STILL = 1e-4;
/** how far a hand may be turned off its seat and still be on it (rad) */
const SEATED = 0.06;
/** how far a contact moves on what the hand holds before its digit is started afresh (m): a trigger squeezed is followed on */
const SWEPT = 0.02;
/** how near its goal a hand's shape is to have closed (the most any of its values is off it) */
const CLOSED = 0.15;

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
  /** where each hand was first seated on each grip (by hand and the grip's empty), as its arm turned it, by what the grip asked of its
   * digits then and in which hold: held again so, it sits so */
  private readonly seats = new Map<string, { asks: Asks; on: Hold | Object3D; closed: Closed }[]>();
  /** how long its hands have been shaped (s): by the body's updates, or by its app posing it (`set`) */
  private time = 0;

  constructor(bones: { left: DigitBones; right: DigitBones }, nodes: Readonly<Record<string, Object3D>>, private readonly holding: Readonly<Record<string, Hold | null>>, model: Object3D) {
    const hand = (side: 'left' | 'right'): Hand => {
      const node = nodes[`${side}Hand`];
      if (!node) throw new Error(`fingers: no bone "${side}Hand"`);
      const skins = skinsOf(model, node), joints = new Joints(node, bones[side], nodes, side, skins), shape = shapeOf({});
      joints.write(shape);
      return { joints, guard: new Guard(joints, skins), skins, shape, posing: null, posed: false, closed: null, coming: null, from: null, pointing: null, met: null, solve: null };
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

  /**
   * `side`'s contacts met this sub-step, the hand where `at` places it (its node, in the world) and the things where `placed` has them: a
   * hand holding something, the arm having brought it to its seat — not one still coming to its grip, shaped as it comes
   */
  meet(side: 'left' | 'right', at: Placed, placed: (object: Object3D) => Placement): void {
    const hand = this.hands[side], hold = this.holding[side], thing = hold?.thing.object;
    if (!hold || !thing) return;
    const grip = hold.thing.grip(hold.grip), empty = grip.node;
    const closed = hand.closed && (hand.closed.on === hold || hand.closed.on === empty) ? hand.closed : null;
    const preferred = shapeOf(values(asksOf(empty)), closed ? closed.shape : grip.pad ? POINT : hand.shape);
    const contacts = this.contacts(grip, thing, closed?.thumb ?? null);
    // (on what hangs from the hand, the hand where it carries it: placed as the body last read it, a sub-step behind the hand, the thing
    // and the thumb on it would move with every step of a carry)
    const local = within(thing, hand.joints.hand) ? { ...inFrame(placedOf(hand.joints.hand), worldOf(thing)), scale: at.scale } : inFrame(at, placed(thing));
    // (on its seat, its contacts where it was seated with them, as it was seated: met afresh along its way there, its digits would take
    // up whatever arrival it came by)
    const seated = closed?.seat && local.position.distanceTo(closed.seat.position) < MOVED && local.quaternion.angleTo(closed.seat.quaternion) < SEATED
      && sameContacts(closed.contacts, contacts);
    if (seated && closed) hand.solve = { at: local, contacts, near: closed.near, shape: structuredClone(preferred) };
    hand.met = { shape: seated ? structuredClone(preferred) : this.solved(hand, local, contacts, preferred, closed?.near ?? null), digits: contacts.map((c) => c.part) };
  }

  /** `preferred` with the digits `contacts` touch met where `at` places the hand, clear of `near` (`meet`; all in the thing's frame), from
   * where they were last met */
  private solved(hand: Hand, at: Placed, contacts: readonly Contact[], preferred: Shape, near: Triangles | null): Shape {
    // (as last solved while the hand and its contacts stay where they were on the thing: a hand held still on a rifle, however it turns)
    const last = hand.solve;
    if (last && last.near === near && last.at.position.distanceTo(at.position) < STILL && last.at.quaternion.angleTo(at.quaternion) < STILL
      && sameContacts(last.contacts, contacts)) return structuredClone(last.shape);
    // (closed afresh, from the shape it closed to — not from how the digits last lay — then followed on from where they were last met)
    const fresh = last?.near !== near, shape = structuredClone(preferred), was = fresh ? preferred : hand.met?.shape ?? hand.shape;
    for (const { part } of contacts) {
      if (part === 'thumb') shape.thumb = { ...was.thumb };
      else shape[part] = { ...was[part] };
    }
    // (a digit whose contact has moved on the thing, or is new, started afresh: the trigger finger off the receiver onto the trigger)
    const swept = contacts.filter((c) => fresh || !last?.contacts.some((was) => was.part === c.part && was.at.distanceTo(c.at) < SWEPT)).map((c) => c.part);
    meet(hand.joints, at, contacts, shape, { preferred, near, swept });
    hand.solve = { at, contacts, near, shape: structuredClone(shape) };
    return shape;
  }

  /** where `side`'s hand sits on what it holds, once it has closed on it: its node's place and turn in the thing's frame (none: not
   * closed on it yet, or it hangs from the hand) — where the arm brings the hand, so its contacts are met from the shoulder out */
  seat(side: 'left' | 'right'): Placement | null {
    const hand = this.hands[side], hold = this.holding[side];
    return hold && hand.closed?.on === hold ? hand.closed.seat : null;
  }

  /** whether `side`'s hand has closed on what it holds: its shape within `CLOSED` of the one it closes to */
  closed(side: 'left' | 'right'): boolean {
    const hand = this.hands[side], hold = this.holding[side];
    if (!hold || hand.closed?.on !== hold) return false;
    return near(hand.shape, hand.solve?.shape ?? hand.closed.shape);
  }

  /** each hand eased `seconds` on toward what it holds, what a pose asked of it this update, or relaxed — one whose contacts were met
   * this update put as they were last met; what was met and asked then let go, each asked afresh the next */
  update(seconds: number): void {
    this.time += seconds;
    for (const side of ['left', 'right'] as const) {
      const hand = this.hands[side], hold = this.holding[side], grip = hold?.thing.grip(hold.grip);
      // (closed afresh, and seated so, as its grip asks its digits elsewhere: the trigger finger onto the trigger from along the receiver)
      if (hold && grip && (hand.closed?.on !== hold || !sameAsks(hand.closed.asks, asksOf(grip.node)) || this.settling(hand, hold.thing.object))) {
        this.close(side, grip, hold.thing.object, hold);
      }
      const { met, posing } = hand;
      [hand.met, hand.posing] = [null, null];
      if (hold) hand.posed = false;
      else if (!hand.coming) hand.posed = posing !== null;
      // (what it holds keeps its digits out itself, closed round it and its contacts met clear of it)
      const on = hold ? false : hand.coming?.parent ?? null;
      if (hold) hand.guard.holding(hold.thing.object);
      const goal = met ? met.shape : grip ? shapeOf(values(asksOf(grip.node)), hand.closed?.shape ?? hand.shape) : posing ?? (hand.coming ? this.onto(side, hand.coming) : RELAXED);
      this.ease(hand, goal, seconds, on, met?.digits);
    }
  }

  /** where a hand verb is bringing `side`'s wrist to, before it holds it: the thing and the wrist in its frame, as a grab puts it (none:
   * nowhere) */
  coming(side: 'left' | 'right'): { thing: Object3D; wrist: Vector3 } | null {
    const empty = this.hands[side].coming, thing = empty?.parent;
    if (!empty || !thing) return null;
    return { thing, wrist: inFrame({ ...placedOf(this.hands[side].joints.hand), position: this.placedOn(side, empty).wrist }, worldOf(thing)).position };
  }

  /** a hand verb is bringing `side` to the grip `empty`, or no longer is (null): until it holds it, the hand shapes for it as it comes (`onto`),
   * from the shape it sets off in if a pose asked it of it — a fist kept back from a button — else from relaxed */
  toward(side: 'left' | 'right', empty: Object3D | null): void {
    const hand = this.hands[side];
    [hand.coming, hand.from, hand.pointing] = [empty, empty && hand.posed ? structuredClone(hand.shape) : null, null];
  }

  /** how far `side`'s hand, on its way to a fingertip's grip, points (0 … 1): as far as the verb bringing it has gone its final run in */
  point(side: 'left' | 'right', share: number): void {
    this.hands[side].pointing = share;
  }

  /** `side`'s fingers eased `seconds` on toward `to`, for a hand its app poses: an empty's grip as they come to it and take it (`onto`),
   * its contacts met from where the hand is; a shape; or relaxed */
  set(side: 'left' | 'right', to: Fingers | Object3D | null, seconds: number): void {
    this.time += seconds;
    const hand = this.hands[side];
    if (!(to instanceof Object3D)) {
      hand.closed = null;
      return this.ease(hand, to === null ? RELAXED : shapeOf(to), seconds, null);
    }
    const goal = this.onto(side, to), thing = to.parent;
    const grip = thing && Thing.of(thing).grip(to.name);
    if (!grip || !thing || hand.closed?.on !== to) return this.ease(hand, goal, seconds, thing);
    const contacts = this.contacts(grip, thing, hand.closed.thumb);
    this.ease(hand, this.solved(hand, inFrame(placedOf(hand.joints.hand), worldOf(thing)), contacts, goal, hand.closed.near), seconds, thing, contacts.map((c) => c.part));
  }

  /**
   * Where hand `side`'s bone goes to hold `empty` (a grip of its parent): its wrist and its bone's rotation (world) — see `Body.gripOn`:
   * where it sits on it once it has closed on it (`seat`), else as a grab puts it
   */
  gripOn(side: 'left' | 'right', empty: Object3D): { wrist: Vector3; rotation: Quaternion } {
    const closed = this.hands[side].closed, seat = closed && (closed.on === empty || (closed.on instanceof Object3D ? null : closed.on.thing.grip(closed.on.grip).node === empty)) ? closed.seat : null;
    if (!seat || !empty.parent) return this.placedOn(side, empty);
    const at = toWorld(seat, worldOf(empty.parent));
    return { wrist: at.position, rotation: at.quaternion };
  }

  /** where hand `side`'s bone goes to hold `empty` as a grab puts it, from the hand's turn now: its wrist and turn (world) */
  private placedOn(side: 'left' | 'right', empty: Object3D): { wrist: Vector3; rotation: Quaternion } {
    const owner = empty.parent;
    if (!owner) throw new Error(`gripOn: "${empty.name}" hangs from nothing`);
    const grip = Thing.of(owner).grip(empty.name), hand = this.hands[side].joints.hand, point = this.pointOn(side, grip);
    const placed = worldOf(owner), back = placed.quaternion.clone().invert(), scale = new Vector3().setFromMatrixScale(hand.matrixWorld).x;
    const now = back.clone().multiply(hand.getWorldQuaternion(new Quaternion()));
    const turn = heldTurn(grip, { point, turn: () => now, up: new Vector3(0, 1, 0).applyQuaternion(back) });
    const wrist = point.at.clone().multiplyScalar(scale).applyQuaternion(turn).negate().add(grip.at.position).applyQuaternion(placed.quaternion).add(placed.position);
    return { wrist, rotation: placed.quaternion.clone().multiply(turn) };
  }

  /** where hand `side` holds `grip` (see `HandPoint`; the hand's node's frame): on a handle, in its grasp; with a pad, that digit's as
   * the grip shapes it; else the palm */
  pointOn(side: 'left' | 'right', grip: Grip): HandPoint {
    const joints = this.hands[side].joints;
    if (!grip.handle) return joints.touch(grip.pad, shapeOf(values(asksOf(grip.node)), grip.pad ? POINT : RELAXED));
    joints.hand.updateWorldMatrix(true, false);
    return joints.handle(grip.handle.radius / new Vector3().setFromMatrixScale(joints.hand.matrixWorld).x);
  }

  /** whether `hand`'s wrist has moved on `thing` since it closed on it, while it still settles there (`SETTLING`) */
  private settling(hand: Hand, thing: Object3D): boolean {
    return hand.closed !== null && this.time - hand.closed.since < SETTLING && hand.closed.off.distanceTo(offOn(hand, thing)) > MOVED;
  }

  /**
   * the contacts a hand's digits make on `grip` of `thing`, in its frame: the pad a fingertip grip names on its empty; each digit
   * `userData.fingers` names to an empty with its pad there; and the thumb's pad on `thumb` (the thing's frame), where it opposes the
   * handle it closed on (`closedOn`), unless an empty has it
   */
  private contacts(grip: Grip, thing: Object3D, thumb: Opposed | null): Contact[] {
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

  /**
   * `side`'s hand closed on `grip` of `thing` afresh (`on`: the hold or empty it closed for; when it first closed on it kept): pointing
   * for a fingertip's grip, else round the thing (`closedOn`), its thumb opposing it; then seated on it (`meet`), from where a grab puts it
   * — moved and turned as its contacts and the thing's surface ask, so that no part of the hand is inside it — unless the thing hangs from
   * the hand, which carries it as it took it
   */
  private close(side: 'left' | 'right', grip: Grip, thing: Object3D, on: Hold | Object3D): void {
    const hand = this.hands[side], again = hand.closed && (hand.closed.on === on || hand.closed.on === grip.node) ? hand.closed : null;
    const since = again?.since ?? this.time, asks = asksOf(grip.node);
    thing.updateWorldMatrix(true, true);
    const frame = worldOf(thing), back = frame.quaternion.clone().invert(), near = trianglesAbout(hand.joints, hand.skins, thing, frame);
    // (held again later, its grip asking the same of its digits, as it was first held so: seated afresh from how it stood, the same hand
    // would take a rifle's front back turned otherwise after a reload)
    const key = `${side} ${grip.node.uuid}`, seats = this.seats.get(key) ?? [], kept = seats.find((seat) => sameAsks(seat.asks, asks));
    if (kept && kept.on !== on && !(on instanceof Object3D)) {
      hand.closed = { ...kept.closed, on, near, off: offOn(hand, thing), since };
      return;
    }
    // (seated from its point on the grip's empty, turned as a grab turns it, or, holding it, as the arm has turned it there — turned as
    // the grip asks, a turn the wrist may not make, the seat would lie off where the arm holds the hand — from the shape it closes to)
    const now = placedOf(hand.joints.hand);
    if (on instanceof Object3D) now.quaternion.copy(this.placedOn(side, grip.node).rotation);
    const point = this.pointOn(side, grip).at.multiplyScalar(now.scale).applyQuaternion(now.quaternion);
    const base = within(thing, hand.joints.hand) ? null : inFrame({ ...now, position: grip.at.position.clone().applyMatrix4(thing.matrixWorld).sub(point) }, frame);
    const handle = grip.handle && { at: grip.at.position.clone().applyMatrix4(thing.matrixWorld), axis: grip.handle.axis.clone().applyQuaternion(frame.quaternion) };
    // (closed round from where `at` places it, the hand standing so: its shape and where its thumb opposes the handle, in the thing's frame)
    const closing = (at: Placement | null) => {
      const world = at && toWorld(at, frame), matrix = world ? new Matrix4().compose(world.position, world.quaternion, new Vector3().setScalar(now.scale)) : undefined;
      const closed = closedOn(hand.joints, thing, handle, hand.skins, matrix);
      const thumb = closed.thumb && { at: closed.thumb.at.sub(frame.position).applyQuaternion(back), facing: closed.thumb.facing.applyQuaternion(back) };
      return { shape: shapeOf(values(asks), closed.shape), thumb };
    };
    let shape = shapeOf(values(asks), grip.pad ? POINT : hand.shape), seat: Placement | null = null, thumb: Opposed | null = null;
    // (closed round from where a grab puts it, then seated with its thumb on where it opposes the handle — so the hand makes room for the
    // thumb round the back strap — then closed round again from the seat; the digits on contacts kept as the seat put them)
    if (!grip.pad) ({ shape, thumb } = closing(base));
    const contacts = this.contacts(grip, thing, thumb), met = structuredClone(shape);
    if (base) {
      meet(hand.joints, base, contacts, met, { preferred: structuredClone(met), near, seat: true });
      seat = { position: base.position, quaternion: base.quaternion };
    }
    shape = met;
    if (!grip.pad && seat) {
      ({ shape } = closing(seat));
      for (const { part } of contacts) {
        if (part === 'thumb') shape.thumb = met.thumb;
        else shape[part] = met[part];
      }
    }
    hand.closed = { on, shape, thumb, seat, contacts: this.contacts(grip, thing, thumb), near, asks, off: offOn(hand, thing), since };
    if (on instanceof Object3D) return;
    this.seats.set(key, [...seats.filter((seat) => seat !== kept), { asks, on, closed: hand.closed }]);
  }

  /**
   * the shape `side` takes for the grip `empty` as its wrist stands off where `gripOn` puts it: relaxed, opening as it nears (`APERTURE`;
   * a fingertip's pointing), and within `ARRIVED` closed on its thing with the empty's asks laid over that
   */
  private onto(side: 'left' | 'right', empty: Object3D): Shape {
    const hand = this.hands[side], thing = empty.parent;
    if (!thing) throw new Error(`fingers: "${empty.name}" hangs from nothing`);
    const grip = Thing.of(thing).grip(empty.name), asks = asksOf(empty);
    const { wrist } = this.gripOn(side, empty), distance = hand.joints.hand.getWorldPosition(new Vector3()).distanceTo(wrist);
    const open = grip.pad ? shapeOf(values(asks), POINT) : APERTURE;
    // (a fingertip's hand comes as a loose fist, its digit curled with the others, and points over its way's final run alone, as its verb
    // says how far it has gone; any other hand keeps the shape it set off in and opens as it nears)
    if (grip.pad && hand.pointing !== null && hand.pointing < 1) return blendShape(grip.pad === 'thumb' ? open : { ...open, [grip.pad]: open.middle }, open, hand.pointing);
    if (!grip.pad && distance > ARRIVED) return blendShape(hand.from ?? RELAXED, open, 1 - smoothstep(NEAR, NEARING, distance));
    if (distance > ARRIVED) return open;
    // (closed afresh only while it settles there: kept on a moving empty, it would close again every sub-step, a search of its meshes each)
    if (hand.closed?.on !== empty || this.settling(hand, thing)) this.close(side, grip, thing, empty);
    return shapeOf(values(asks), hand.closed?.shape ?? open);
  }

  /** `hand` eased `seconds` on toward `goal`, the digits `at` put there at once (their contacts met), kept out of what it comes to (`on`;
   * `false`: it holds something), and written */
  private ease(hand: Hand, goal: Shape, seconds: number, on: Object3D | null | false, at: readonly Digit[] = []): void {
    hand.guard.ease(hand.shape, goal, seconds, on, at);
    hand.joints.write(hand.shape);
  }
}

/** what `grip` asks of the fingers in `userData.fingers` (none: nothing) */
function asksOf(grip: Object3D): Asks {
  const asked: unknown = grip.userData.fingers;
  if (asked === undefined) return {};
  if (typeof asked !== 'object' || asked === null) throw new Error(`"${grip.name}" userData.fingers is neither digits' values nor empties' names`);
  return { ...asked };
}

/** the digits' values `asks` gives, those it puts on an empty left out */
function values(asks: Asks): Fingers {
  return Object.fromEntries(Object.entries(asks).filter(([, value]) => typeof value !== 'string'));
}

/** whether `a` and `b` ask the same of each digit: the same empty, or the same values */
function sameAsks(a: Asks, b: Asks): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => {
    const x: unknown = a[key], y: unknown = b[key];
    if (typeof x !== 'object' || x === null || typeof y !== 'object' || y === null) return x === y;
    const xs = Object.entries(x), ys = new Map(Object.entries(y));
    return xs.length === ys.size && xs.every(([k, v]) => ys.get(k) === v);
  });
}

/** whether contacts `a` and `b` are on the same digits at the same places (within `STILL`) */
function sameContacts(a: readonly Contact[], b: readonly Contact[]): boolean {
  return a.length === b.length && a.every((c, k) => c.part === b[k].part && c.at.distanceTo(b[k].at) < STILL);
}

/** whether `shape` is within `CLOSED` of `goal`, every value */
function near(shape: Shape, goal: Shape): boolean {
  const off = (a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>) => Object.keys(a).every((key) => Math.abs(a[key] - b[key]) <= CLOSED);
  return off(shape.thumb, goal.thumb) && off(shape.index, goal.index) && off(shape.middle, goal.middle) && off(shape.ring, goal.ring) && off(shape.little, goal.little);
}

/** where `hand`'s wrist is on `thing`, in its frame, as the scene stands now */
function offOn(hand: Hand, thing: Object3D): Vector3 {
  thing.updateWorldMatrix(true, false);
  return thing.worldToLocal(hand.joints.hand.getWorldPosition(new Vector3()));
}

/** the skinned meshes under `model` that `hand` bends (none: a bare body) */
function skinsOf(model: Object3D, hand: Object3D): SkinnedMesh[] {
  const found: SkinnedMesh[] = [];
  model.traverse((node) => { if (node instanceof SkinnedMesh && node.skeleton.bones.some((bone) => bone === hand)) found.push(node); });
  return found;
}
