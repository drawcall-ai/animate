import { Matrix4, Mesh, Object3D, Quaternion, SkinnedMesh, Vector3 } from 'three';
import { smoothstep } from '../kernel/math';
import { Triangles } from '../kernel/triangles';
import type { Placement } from '../kernel/goal';
import { Thing, vectorOf, type Grip } from '../things/thing';
import type { Hold } from '../things/resolve';
import { heldTurn } from '../things/hold';
import type { DigitBones } from './bones';
import { closedOn, PRESSED, type Opposed } from './closing';
import { meet, type Contact, type Placed } from './contact';
import type { HandPoint } from './point';
import { Joints, PINCH } from './joints';
import { blendShape, digitOf, DIGITS, easeShape, POINT, RELAXED, shapeOf, type Digit, type Fingers, type Shape } from './shape';

/** One hand's fingers: its bones, its shape as last written, what a pose asks of it, the shape it closed to on what it holds — where its
 * thumb's pad opposes it, where the hand sits on it (`seat`: its node's place and turn, none where the thing hangs from the hand) and the
 * thing's triangles about it, all in the thing's frame — the grip a hand verb is bringing it to, the shape it set off for it in and, for a
 * fingertip's, how far it points (0 … 1, as the verb has its way gone: none, as it gets there), and the shape its contacts were last met
 * in, when. */
interface Hand {
  joints: Joints;
  shape: Shape;
  asked: Shape | null;
  closed: { on: Hold | Object3D; shape: Shape; thumb: Opposed | null; seat: Placement | null; contacts: readonly Contact[]; near: Triangles; asked: string; off: Vector3; since: number } | null;
  coming: Object3D | null;
  from: Shape | null;
  /** whether its shape was last eased toward one a pose asked of it (a fist after a press), not one it took holding something */
  posed: boolean;
  pointing: number | null;
  met: { shape: Shape; digits: readonly Digit[] } | null;
  /** its last solve (`solved`): what it was given and the shape it found, kept while nothing it was given has moved */
  solve: { at: Placed; contacts: readonly Contact[]; near: Triangles | null; shape: Shape } | null;
  /** what its eased shape is kept out of (`ease`): the thing it holds or comes to, else the last it held, till it is clear of it — and that
   * thing's triangles about the hand, in its frame, gathered about `at` */
  guard: { thing: Object3D; left: boolean; near: Triangles; at: Vector3 } | null;
  /** the body's own skinned meshes, which the hand never closes on, and how long its app has shaped it (s, `set`) */
  skins: readonly SkinnedMesh[];
  clock: number;
}

/**
 * a hand on its way to a grip opens to take it (Jeannerod 1984: the grip opens wider than the object late in the reach, closing on it as
 * the hand arrives): the thumb out in front of the palm, the fingers side by side and a little bent, each a little more than the one before
 * as a relaxed hand's are, their tips barely hooked (all alike, the open hand read as a mannequin's claw; fanned, as a stiff splayed hand;
 * hooked more, a claw closing on nothing) — relaxed until its wrist is `NEARING` from where it holds the grip, open from `NEAR` (m: opened
 * all the way, it travelled 0.6 s as a palm-up claw; opening from 22 cm off, a hand going back to a rifle from a button came at it as an
 * open claw for 0.4 s), and closing on it within `ARRIVED` (m); a fingertip's hand points as it nears instead
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
/** how near the last thing a hand held its digits are kept out of it, and how near it its shape is held as it was (m); how far a hand
 * moves before the triangles about it are gathered afresh (m); how deep a digit may sink into what it is kept out of (m: its skin's give
 * is in its balls' size already); and how many times a digit's ease is halved down to where it is kept out */
const GUARD = 0.04, LEAVING = 0.01, REGATHER = 0.03, SUNK = 0.001, HALVINGS = 5;
/** how little a hand and its contacts move on what it holds for its last solve to stand (m, rad) */
const STILL = 1e-4;
/** how far a hand may be turned off its seat and still be on it (rad) */
const SEATED = 0.06;
/** how far a contact moves on what the hand holds before its digit is started afresh (m): a trigger drawn back 5 mm is followed on, not
 * started afresh (its pad jumped 1.7 cm) */
const SWEPT = 0.02;
/** how much further than the hand reaches its seat may move it, and the triangles about it are kept for (m) */
const REACH = 0.05;

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
  /** where each hand was first seated holding each grip (by hand and the grip's empty), as its arm turned it, and in which hold: held
   * again, it sits so */
  private readonly seats = new Map<string, { on: Hold | Object3D; closed: NonNullable<Hand['closed']> }>();
  constructor(bones: { left: DigitBones; right: DigitBones }, nodes: Readonly<Record<string, Object3D>>, private readonly holding: Readonly<Record<string, Hold | null>>, model: Object3D) {
    const hand = (side: 'left' | 'right'): Hand => {
      const node = nodes[`${side}Hand`];
      if (!node) throw new Error(`fingers: no bone "${side}Hand"`);
      const skins = skinsOf(model, node), joints = new Joints(node, bones[side], nodes, side, skins), shape = shapeOf({});
      joints.write(shape);
      return { joints, shape, asked: null, closed: null, coming: null, from: null, posed: false, pointing: null, met: null, solve: null, guard: null, skins, clock: 0 };
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
   * `side`'s contacts met this sub-step, the hand where `at` places it (its node, in the world) and the things where `placed` has them: a
   * hand holding something, the arm having brought it to its seat — not one still coming to its grip, shaped as it comes (met from 1.5 cm
   * out, a fingertip's index straightened onto its button in one sub-step, its tip jumping 1.5–2 cm)
   */
  meet(side: 'left' | 'right', at: Placed, placed: (object: Object3D) => Placement): void {
    const hand = this.hands[side], hold = this.holding[side], thing = hold?.thing.object;
    if (!hold || !thing) return;
    const grip = hold.thing.grip(hold.grip), empty = grip.node;
    const closed = hand.closed && (hand.closed.on === hold || hand.closed.on === empty) ? hand.closed : null;
    const preferred = shapeOf(values(grip.node), closed ? closed.shape : this.shaped(hand, grip));
    const contacts = this.contacts(grip, thing, closed?.thumb ?? null);
    // (on what hangs from the hand, the hand where it carries it: placed as the body last read it, a sub-step behind the hand, it moved on
    // the magazine with every step of a carry, and the thumb with it)
    const local = hangsFrom(hand.joints.hand, thing) ? { ...inFrame(placedOf(hand.joints.hand), worldOf(thing)), scale: at.scale } : inFrame(at, placed(thing));
    // (on its seat, its contacts where it was seated with them, as it was seated: met afresh along its way there, its digits took up
    // whatever arrival it came by — a thumb up a receiver's side one time, along its lower edge the next)
    const seated = closed?.seat && local.position.distanceTo(closed.seat.position) < MOVED && local.quaternion.angleTo(closed.seat.quaternion) < SEATED
      && closed.contacts.length === contacts.length && closed.contacts.every((c, k) => c.part === contacts[k].part && c.at.distanceTo(contacts[k].at) < STILL);
    if (seated && closed) hand.solve = { at: local, contacts, near: closed.near, shape: structuredClone(preferred) };
    hand.met = { shape: seated ? structuredClone(preferred) : this.solved(hand, local, contacts, preferred, closed?.near ?? null), digits: contacts.map((c) => c.part) };
  }

  /** `preferred` with the digits `contacts` touch met where `at` places the hand, clear of `near` (`meet`; all in the thing's frame), from
   * where they were last met */
  private solved(hand: Hand, at: Placed, contacts: readonly Contact[], preferred: Shape, near: Triangles | null): Shape {
    // (as last solved while the hand and its contacts stay where they were on the thing: a hand held still on a rifle, however it turns)
    const last = hand.solve;
    if (last && last.near === near && last.at.position.distanceTo(at.position) < STILL && last.at.quaternion.angleTo(at.quaternion) < STILL
      && last.contacts.length === contacts.length && last.contacts.every((c, k) => c.part === contacts[k].part && c.at.distanceTo(contacts[k].at) < STILL)) return structuredClone(last.shape);
    // (closed afresh, from the shape it closed to — not from how the digits last lay: a thumb kept on from where it came lay up a receiver's
    // side one time and along its lower edge the next — then followed on from where they were last met)
    const fresh = last?.near !== near, shape = structuredClone(preferred), was = fresh ? preferred : hand.met?.shape ?? hand.shape;
    for (const { part } of contacts) {
      if (part === 'thumb') shape.thumb = { ...was.thumb };
      else shape[part] = { ...was[part] };
    }
    // (a digit whose contact has moved on the thing, or is new, started afresh: the trigger finger off the receiver onto the trigger)
    const swept = contacts.filter((c) => fresh || !last?.contacts.some((was) => was.part === c.part && was.at.distanceTo(c.at) < SWEPT)).map((c) => c.part);
    meet(hand.joints, at, contacts, shape, preferred, near, false, swept);
    hand.solve = { at, contacts, near, shape: structuredClone(shape) };
    return shape;
  }

  /** where `side`'s hand sits on what it holds, once it has closed on it: its node's place and turn in the thing's frame (none: not
   * closed on it yet, or it hangs from the hand) — where the arm brings the hand, so its contacts are met from the shoulder out */
  seat(side: 'left' | 'right'): Placement | null {
    const hand = this.hands[side], hold = this.holding[side];
    return hold && hand.closed?.on === hold ? hand.closed.seat : null;
  }

  /** each hand eased `seconds` on toward what it holds, what a pose asked of it this update, or relaxed — one whose contacts were met
   * this update put as they were last met — at `time` (s); what was met and asked then let go, each asked afresh the next */
  update(seconds: number, time: number): void {
    for (const side of ['left', 'right'] as const) {
      const hand = this.hands[side], hold = this.holding[side];
      // (closed afresh, and seated so, as its grip asks its digits elsewhere: the trigger finger onto the trigger from along the receiver)
      const grip = hold?.thing.grip(hold.grip);
      if (hold && grip && (hand.closed?.on !== hold || hand.closed.asked !== JSON.stringify(asks(grip.node))
        || (time - hand.closed.since < SETTLING && hand.closed.off.distanceTo(offOn(hand, hold.thing.object)) > MOVED))) {
        this.close(side, hold.thing.grip(hold.grip), hold.thing.object, hold, time);
      }
      const { met, asked } = hand;
      [hand.met, hand.asked] = [null, null];
      if (hold) hand.posed = false;
      else if (!hand.coming) hand.posed = asked !== null;
      // (what it holds keeps its digits out itself, closed round it and its contacts met clear of it)
      const on = hold ? false : hand.coming?.parent ?? null;
      if (hold) this.held(hand, hold.thing.object);
      if (met) this.ease(hand, met.shape, seconds, on, met.digits);
      else this.ease(hand, hold ? shapeOf(values(hold.thing.grip(hold.grip).node), hand.closed?.shape ?? hand.shape) : hand.coming ? this.onto(side, hand.coming, time) : asked ?? RELAXED, seconds, on);
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
   * from the shape it sets off in if a pose asked it of it — a fist kept back from a button — else from relaxed: set off from what it had
   * just let go of, a hand carried its pinch round an empty magazine to the pouch and arrived closed */
  toward(side: 'left' | 'right', empty: Object3D | null): void {
    const hand = this.hands[side];
    [hand.coming, hand.from, hand.pointing] = [empty, empty && hand.posed ? structuredClone(hand.shape) : null, null];
  }

  /** how far `side`'s hand, on its way to a fingertip's grip, points (0 … 1): as far as the verb bringing it has gone its final run in */
  pointing(side: 'left' | 'right', share: number): void {
    this.hands[side].pointing = share;
  }

  /** `side`'s fingers eased `seconds` on toward `to`, for a hand its app poses: an empty's grip as they come to it and take it (`onto`),
   * its contacts met from where the hand is; a shape; or relaxed */
  set(side: 'left' | 'right', to: Fingers | Object3D | null, seconds: number): void {
    const hand = this.hands[side];
    if (!(to instanceof Object3D)) {
      hand.closed = null;
      return this.ease(hand, to === null ? RELAXED : shapeOf(to), seconds, null);
    }
    hand.clock += seconds;
    const goal = this.onto(side, to, hand.clock), thing = to.parent;
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

  /** where hand `side`'s bone goes to hold `empty` as a grab puts it (`goalOn`), from the hand's turn now: its wrist and turn (world) */
  private placedOn(side: 'left' | 'right', empty: Object3D): { wrist: Vector3; rotation: Quaternion } {
    const owner = empty.parent;
    if (!owner) throw new Error(`gripOn: "${empty.name}" hangs from nothing`);
    const grip = Thing.of(owner).grip(empty.name), hand = this.hands[side].joints.hand, point = this.pointOn(side, grip);
    const placed = worldOf(owner), back = placed.quaternion.clone().invert(), scale = new Vector3().setFromMatrixScale(hand.matrixWorld).x;
    const now = back.clone().multiply(hand.getWorldQuaternion(new Quaternion()));
    const turn = heldTurn(grip, { at: point.at, turn: () => now, point, up: new Vector3(0, 1, 0).applyQuaternion(back) });
    const wrist = point.at.clone().multiplyScalar(scale).applyQuaternion(turn).negate().add(grip.at.position).applyQuaternion(placed.quaternion).add(placed.position);
    return { wrist, rotation: placed.quaternion.clone().multiply(turn) };
  }

  /** where hand `side` holds `grip` (see `HandPoint`): on a handle, in its grasp; with a pad, that digit's as the grip shapes it; else the palm */
  pointOn(side: 'left' | 'right', grip: Grip): HandPoint {
    const joints = this.hands[side].joints;
    if (!grip.handle) return joints.touch(grip.pad, shapeOf(values(grip.node), grip.pad ? POINT : RELAXED));
    joints.hand.updateWorldMatrix(true, false);
    return joints.handle(grip.handle.radius / new Vector3().setFromMatrixScale(joints.hand.matrixWorld).x);
  }

  /**
   * the contacts a hand's digits make on `grip` of `thing`, in its frame: the pad a fingertip grip names on its empty; each digit
   * `userData.fingers` names to an empty with its pad there; and the thumb's pad on `thumb` (the thing's frame), where it opposes the
   * handle it closed on (`closedOn`), unless an empty has it
   */
  private contacts(grip: Grip, thing: Object3D, thumb: Opposed | null): Contact[] {
    const centre = grip.at.position.clone(), line = grip.handle?.axis ?? null;
    // (a digit's pad on what the hand holds presses with its flat toward the grip's middle — its line, on a handle — as a grasp opposes the
    // thumb to the fingers and the palm across it: a thumb's on a magazine's face toward the fingers on the other, a trigger finger's back
    // toward the grip)
    const pinching = (part: Digit, at: Vector3): Contact => {
      const toward = centre.clone().sub(at);
      if (line) toward.addScaledVector(line, -toward.dot(line));
      return { part, at, round: PINCH, ...(toward.lengthSq() > 1e-8 && { facing: toward.normalize() }) };
    };
    // (a fingertip's pad only on its empty, the hand turned as it pointed to press: pulled to face the way into the face, it turned the
    // hand off the line it pointed along and slid off the button)
    const contacts: Contact[] = grip.pad ? [{ part: grip.pad, at: centre }] : [];
    for (const [name, value] of Object.entries(asks(grip.node))) {
      if (typeof value !== 'string') continue;
      if (name === grip.pad) throw new Error(`"${grip.node.name}" userData.fingers.${name}: its pad is the grip's own, on it`);
      const empty = thing.getObjectByName(value);
      if (!empty) throw new Error(`"${grip.node.name}" userData.fingers.${name}: "${thing.name}" has no empty named "${value}"`);
      // (where the empty is on the thing as it stands)
      thing.updateWorldMatrix(true, true);
      const local = new Vector3().setFromMatrixPosition(empty.matrixWorld).applyMatrix4(new Matrix4().copy(thing.matrixWorld).invert());
      const digit = digitOf(name, `"${grip.node.name}" userData.fingers`), facing: unknown = empty.userData.facing;
      // (an empty's own `userData.facing`, the way the pad presses into the face it is on, overrides the way toward the grip's middle: a
      // thumb laid along a stile's outer face tipped toward the handle's line through the bar)
      if (facing === undefined) contacts.push(pinching(digit, local));
      else contacts.push({ part: digit, at: local, round: PINCH, facing: vectorOf(facing, `"${value}" userData.facing`).normalize().applyQuaternion(empty.getWorldQuaternion(new Quaternion()).premultiply(thing.getWorldQuaternion(new Quaternion()).invert())) });
    }
    if (thumb && !contacts.some((c) => c.part === 'thumb')) contacts.push({ part: 'thumb', at: thumb.at.clone(), facing: thumb.facing.clone(), round: PINCH });
    return contacts;
  }

  /** the shape `hand` takes for `grip` before it has closed on it: pointing for a pad, else relaxed */
  private shaped(hand: Hand, grip: Grip): Shape {
    return grip.pad ? POINT : hand.shape;
  }

  /**
   * `side`'s hand closed on `grip` of `thing` afresh (`on`: the hold or empty it closed for; `since`, when it first closed on it, kept):
   * pointing for a fingertip's grip, else round the thing (`closedOn`), its thumb opposing it; then seated on it (`meet`), from where a
   * grab puts it — moved and turned as its contacts and the thing's surface ask, so that no part of the hand is inside it — unless the
   * thing hangs from the hand, which carries it as it took it
   */
  private close(side: 'left' | 'right', grip: Grip, thing: Object3D, on: Hold | Object3D, time: number): void {
    const hand = this.hands[side], again = hand.closed && (hand.closed.on === on || hand.closed.on === grip.node) ? hand.closed : null;
    const since = again?.since ?? time;
    thing.updateWorldMatrix(true, true);
    const frame = worldOf(thing), back = frame.quaternion.clone().invert(), near = trianglesAbout(hand, thing, frame);
    // (seated from its point on the grip's empty, turned as a grab turns it, or, holding it, as the arm has turned it there — turned as the
    // grip asks, a turn the wrist could not make, the seat lay 26° off where the arm held the hand and its digits took up whatever way it
    // came — and from the shape it closes to there; held again later, its grip asking the same of its digits, as it was first held so:
    // seated afresh from how it stood, the same hand took a rifle's front back after a reload turned 20° otherwise, its thumb up the
    // receiver's side, not along its edge)
    const asked = JSON.stringify(asks(grip.node)), key = `${side} ${grip.node.uuid} ${asked}`, kept = this.seats.get(key);
    if (kept && kept.on !== on && !(on instanceof Object3D)) {
      hand.closed = { ...kept.closed, on, near: trianglesAbout(hand, thing, worldOf(thing)), off: offOn(hand, thing), since };
      return;
    }
    const now = placedOf(hand.joints.hand);
    if (on instanceof Object3D) now.quaternion.copy(this.placedOn(side, grip.node).rotation);
    const point = this.pointOn(side, grip).at.multiplyScalar(now.scale).applyQuaternion(now.quaternion);
    const base = hangsFrom(hand.joints.hand, thing) ? null : inFrame({ ...now, position: grip.at.position.clone().applyMatrix4(thing.matrixWorld).sub(point) }, frame);
    const handle = grip.handle && { at: grip.at.position.clone().applyMatrix4(thing.matrixWorld), axis: grip.handle.axis.clone().applyQuaternion(frame.quaternion) };
    // (closed round from where it is placed: its shape and where its thumb opposes the handle, in the thing's frame)
    const closing = (at: Placement | null) => {
      const closed = at ? placedAt(hand.joints.hand, toWorld(at, frame), () => closedOn(hand.joints, thing, handle, hand.skins)) : closedOn(hand.joints, thing, handle, hand.skins);
      const thumb = closed.thumb && { at: closed.thumb.at.sub(frame.position).applyQuaternion(back), facing: closed.thumb.facing.applyQuaternion(back) };
      return { shape: shapeOf(values(grip.node), closed.shape), thumb };
    };
    let shape = shapeOf(values(grip.node), grip.pad ? POINT : hand.shape), seat: Placement | null = null, thumb: Opposed | null = null;
    // (closed round from where a grab puts it, then seated with its thumb on where it opposes the handle — so the hand makes room for the
    // thumb round the back strap — then closed round again from the seat; the digits on contacts kept as the seat put them)
    if (!grip.pad) ({ shape, thumb } = closing(base));
    const contacts = this.contacts(grip, thing, thumb), met = structuredClone(shape);
    if (base) {
      meet(hand.joints, base, contacts, met, structuredClone(met), near, true);
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
    hand.closed = { on, shape, thumb, seat, contacts: this.contacts(grip, thing, thumb), near, asked, off: offOn(hand, thing), since };
    if (!(on instanceof Object3D)) this.seats.set(key, { on, closed: hand.closed });
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
    // (a fingertip's hand comes as a loose fist, its digit curled with the others, and points over its way's final run alone, as its verb
    // says how far it has gone: pointing as its wrist came near, it pointed beside the panel, held up for 0.3 s; any other hand keeps the
    // shape it set off in and opens as it nears: from the relaxed hand's open fingers, a fingertip's hand travelled as a flat claw, and a
    // hand back from a button to its rifle passed its index out over the panel again)
    if (grip.pad && hand.pointing !== null && hand.pointing < 1) return blendShape(grip.pad === 'thumb' ? open : { ...open, [grip.pad]: open.middle }, open, hand.pointing);
    if (!grip.pad && distance > ARRIVED) return blendShape(hand.from ?? RELAXED, open, 1 - smoothstep(NEAR, NEARING, distance));
    if (distance > ARRIVED) return open;
    // (closed afresh only while it settles there: a hand kept on a moving empty closed again every sub-step, a search of its meshes each time)
    const closed = hand.closed?.on === empty ? hand.closed : null;
    if (!closed || (time - closed.since < SETTLING && closed.off.distanceTo(offOn(hand, thing)) > MOVED)) this.close(side, grip, thing, empty, time);
    return shapeOf(values(empty), hand.closed?.shape ?? open);
  }

  /**
   * `hand` eased `seconds` on toward `goal`, the digits `at` put there at once (their contacts met), and written — every other digit kept
   * out of `on` (what it comes to; false: it holds something, which keeps its digits out itself) or, once it has let go, of the last thing
   * it held or came to while it is within `GUARD` of it: no further
   * into it than it was, and opened as far as takes it out where the thing came into it — held as it was while it is still within
   * `LEAVING` of it, so a hand letting go opens only as its fingers must to clear the bar, not into a claw (eased open to relaxed, a thumb
   * swung through a ladder's stile 2.5 cm; and closing on a stile, the fingers curled across its face before the palm was on it)
   */
  private ease(hand: Hand, goal: Shape, seconds: number, on: Object3D | null | false, at: readonly Digit[] = []): void {
    const guard = on === false ? null : this.guarded(hand, on), was = structuredClone(hand.shape);
    const place = guard && inFrame(placedOf(hand.joints.hand), worldOf(guard.thing));
    const leaving = guard && place && guard.left ? this.clear(hand, guard.near, place, hand.shape) : Infinity;
    if (guard?.left && leaving > GUARD) hand.guard = null;
    easeShape(hand.shape, leaving < LEAVING ? was : goal, seconds);
    for (const digit of at) {
      if (digit === 'thumb') hand.shape.thumb = { ...goal.thumb };
      else hand.shape[digit] = { ...goal[digit] };
    }
    if (guard && place && hand.guard) {
      for (const digit of ['thumb', ...DIGITS] as const) if (!at.includes(digit)) keptOut(hand.joints, guard.near, place, hand.shape, was, digit);
    }
    hand.joints.write(hand.shape);
  }

  /** `hand` holding `thing`: the last it held once it lets go (`guarded`; while it holds it, its closing and its contacts keep it out) */
  private held(hand: Hand, thing: Object3D): void {
    if (hand.guard?.thing === thing && hand.guard.left) return;
    hand.guard = { thing, left: true, near: new Triangles([], new Vector3(), 0), at: new Vector3(Infinity, Infinity, Infinity) };
  }

  /** what `hand`'s shape is kept out of as it is `on` that (see `ease`): its triangles about the hand, gathered afresh once it has moved
   * `REGATHER` from where they were gathered */
  private guarded(hand: Hand, on: Object3D | null): Hand['guard'] {
    const thing = on ?? (hand.guard?.left || hand.guard?.thing !== on ? hand.guard?.thing : null) ?? null;
    if (!thing) return (hand.guard = null);
    const frame = worldOf(thing), at = inFrame(placedOf(hand.joints.hand), frame).position, left = on === null;
    if (hand.guard?.thing === thing && hand.guard.at.distanceTo(at) < REGATHER) return Object.assign(hand.guard, { left });
    return (hand.guard = { thing, left, near: trianglesAbout(hand, thing, frame), at });
  }

  /** how far `hand`'s palm and digits as `shape` has them are clear of `near` (m; `place`: the hand in its frame) */
  private clear(hand: Hand, near: Triangles, place: Placed, shape: Shape): number {
    const matrix = new Matrix4().compose(place.position, place.quaternion, new Vector3().setScalar(place.scale));
    let least = Infinity;
    for (const part of [null, 'thumb', ...DIGITS] as const) for (const ball of hand.joints.flesh(part, shape)) {
      least = Math.min(least, -near.depth(ball.at.applyMatrix4(matrix), ball.radius * place.scale * PRESSED, GUARD));
    }
    return least;
  }
}

/**
 * `digit` of `shape` (in place, eased on from `was`) kept out of `near` (`place`: the hand in its frame): as far on from `was` as it goes
 * no deeper into it than it was, halved down to that — or, where it was in it already (the thing come into it, the hand leaving it),
 * opened toward straight as far as takes it out
 */
function keptOut(joints: Joints, near: Triangles, place: Placed, shape: Shape, was: Shape, digit: Digit): void {
  const matrix = new Matrix4().compose(place.position, place.quaternion, new Vector3().setScalar(place.scale));
  const depth = () => Math.max(0, ...joints.flesh(digit, shape).map((ball) => near.depth(ball.at.applyMatrix4(matrix), ball.radius * place.scale * PRESSED, GUARD)));
  const to = { ...shape[digit] } as Record<string, number>, from = { ...was[digit] } as Record<string, number>;
  const set = (a: Record<string, number>, b: Record<string, number>, t: number) => {
    const mixed = Object.fromEntries(Object.keys(a).map((key) => [key, a[key] + (b[key] - a[key]) * t]));
    if (digit === 'thumb') shape.thumb = mixed as Shape['thumb'];
    else shape[digit] = mixed as Shape['index'];
  };
  if (depth() <= SUNK) return;
  set(from, from, 0);
  const before = depth();
  // (from where it was toward where it eased to, or, sunk already, from where it eased to toward straight)
  const [a, b] = before <= SUNK ? [from, to] : [to, Object.fromEntries(Object.keys(to).map((key) => [key, 0]))];
  let free = before <= SUNK ? 0 : 1, hit = before <= SUNK ? 1 : 0;
  if (before > SUNK) {
    set(a, b, 1);
    if (depth() > SUNK) return;
  }
  for (let k = 0; k < HALVINGS; k++) {
    const mid = (free + hit) / 2;
    set(a, b, mid);
    if (depth() <= SUNK) free = mid;
    else hit = mid;
  }
  set(a, b, free);
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

/** where `node` is in the world as the scene stands now: its position, turn and scale */
function placedOf(node: Object3D): Placed {
  node.updateWorldMatrix(true, false);
  const placed = { position: new Vector3(), quaternion: new Quaternion(), scale: new Vector3() };
  node.matrixWorld.decompose(placed.position, placed.quaternion, placed.scale);
  return { ...placed, scale: placed.scale.x };
}

/** `at` (the frame of what `frame` places) in the world */
function toWorld(at: Placement, frame: Placement): Placement {
  return { position: at.position.clone().applyQuaternion(frame.quaternion).add(frame.position), quaternion: frame.quaternion.clone().multiply(at.quaternion) };
}

/** what `read` finds with `node` put at `at` (the world) for it, put back after */
function placedAt<T>(node: Object3D, at: Placement, read: () => T): T {
  const position = node.position.clone(), quaternion = node.quaternion.clone(), parent = node.parent;
  parent?.updateWorldMatrix(true, false);
  const world = new Matrix4().compose(at.position, at.quaternion, new Vector3().setFromMatrixScale(node.matrixWorld));
  if (parent) world.premultiply(new Matrix4().copy(parent.matrixWorld).invert());
  world.decompose(node.position, node.quaternion, new Vector3());
  node.updateMatrixWorld(true);
  try {
    return read();
  } finally {
    node.position.copy(position);
    node.quaternion.copy(quaternion);
    node.updateMatrixWorld(true);
  }
}

/** `at` (the world) in the frame of what `frame` places */
function inFrame(at: Placed, frame: Placement): Placed {
  const back = frame.quaternion.clone().invert();
  return { position: at.position.clone().sub(frame.position).applyQuaternion(back), quaternion: back.multiply(at.quaternion), scale: at.scale };
}

/** whether `thing` hangs from `node` (under it in the scene) */
function hangsFrom(node: Object3D, thing: Object3D): boolean {
  for (let at = thing.parent; at; at = at.parent) if (at === node) return true;
  return false;
}

/** the triangles of `thing`'s meshes about `hand`, in the thing's frame (`frame`, the world's): every mesh shown under it, what hangs from
 * it too (a magazine in a rifle's well) — the body's own skin left out — as far as the hand reaches and a seat may move it */
function trianglesAbout(hand: Hand, thing: Object3D, frame: Placement): Triangles {
  const back = new Matrix4().compose(frame.position, frame.quaternion, new Vector3(1, 1, 1)).invert(), meshes: Mesh[] = [];
  thing.traverseVisible((node) => { if (node instanceof Mesh && !hand.skins.some((skin) => skin === node)) meshes.push(node); });
  const at = inFrame(placedOf(hand.joints.hand), frame);
  return new Triangles(meshes.map((mesh) => ({ geometry: mesh.geometry, matrix: back.clone().multiply(mesh.matrixWorld) })), at.position, hand.joints.span * at.scale + REACH);
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
