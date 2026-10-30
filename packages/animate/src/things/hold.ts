import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import type { Frame } from '../kernel/frame';
import type { Pose } from '../kernel/pose';
import { Carrier } from '../kernel/carrier';
import { follow } from '../kernel/follow';
import { anchors, movers, resolve, written, type Hold, type Holder, type Resolving } from './resolve';
import { Thing, type Grip } from './thing';
import type { Goal, Placement } from '../kernel/goal';

/** the nearest anchor among `object` and its ancestors: a body's object (bone −1) or moving bone */
function anchorOf(object: Object3D): { body: Holder; bone: number } | undefined {
  for (let at: Object3D | null = object; at; at = at.parent) {
    const anchor = anchors.get(at);
    if (anchor) return anchor;
  }
}

/** the moving bone of `self` that `object` hangs from (its nearest ancestor that is one; −1: its object; NaN: none) */
export function hangsFrom(self: Holder, object: Object3D): number {
  const anchor = anchorOf(object);
  return anchor?.body === self ? anchor.bone : NaN;
}

/** the body `object` is on (attached under its object or a bone of it), if any */
export function bodyOf(object: Object3D): Holder | null {
  return anchorOf(object)?.body ?? null;
}

/** whether `thing` is on `self`: attached under it, or in its hands */
export function onBody(self: Holder, thing: Thing): boolean {
  return bodyOf(thing.object) === self || held(self).includes(thing);
}

/** A person's palm, as a grip takes it: its centre in the hand bone's frame, and the hand bone's turn in the thing's frame as the body was
 * last posed. */
export interface Palm {
  at: Readonly<Vector3>;
  turn: () => Quaternion;
}

/**
 * Where a hand bone goes on `grip` (the thing's frame): turned as the empty is, its `rest` undone; or rolling about its free line; or turned
 * as the hand comes. A person's hand holds a grip in its `palm`: the bone, at the wrist, goes as far back from the empty as the palm's
 * centre is from the wrist, along the hand as it was last turned — read afresh, so the goal moves on the thing as the hand turns or rolls,
 * and a hand short of its asked turn (its wrist at the end of its range, or still turning) still has its palm on the empty, not the
 * wrist on the place the turn would have put it (a pistol grip turned 0.4 rad past the wrist's range: the palm 3 cm off it). A
 * creature's tip, with no palm, goes on the empty.
 */
export function goalOn(grip: Grip, rest: Readonly<Quaternion>, palm?: Palm): Goal {
  const quaternion = grip.turn === null ? undefined : grip.at.quaternion.clone().multiply(_back.copy(rest).invert());
  const axis = grip.turn instanceof Vector3 ? grip.turn.clone().applyQuaternion(grip.at.quaternion) : undefined;
  const turns = { ...(quaternion && { quaternion }), ...(axis && { axis }) };
  if (!palm) return { position: grip.at.position.clone(), ...turns };
  // (the wrist, the palm on the empty, the hand turned `turn` in the thing's frame)
  const empty = grip.at.position, wrist = new Vector3();
  return { get position() { return wrist.copy(palm.at).applyQuaternion(palm.turn()).negate().add(empty); }, ...turns };
}

/** the hold a hand takes on `grip` of `thing`, its goal `goal` (`goalOn`); a person's `palm` holds it */
export function holdOn(thing: Thing, grip: string, goal: Goal, palm?: Palm): Hold {
  if (!palm) return { thing, grip, goal };
  return { thing, grip, goal, palm: palm.at, ...(!goal.quaternion && { turn: palm.turn }) };
}

/** where a hand holding `hold` goes on its thing: its goal, turned as the hand holds it (`Hold.turn`) when the grip sets no turn */
export function steadied(hold: Hold): Goal {
  return hold.turn && !hold.goal.quaternion ? { position: hold.goal.position, quaternion: hold.turn().clone() } : hold.goal;
}

/** hand `hand` of `self` holding `hold` (null: letting go), the thing's holders kept */
export function grasp(self: Holder, hand: string, hold: Hold | null): void {
  const was = self.holding[hand];
  self.holding[hand] = hold;
  if (was && !handsOn(self, was.thing).length) was.thing.holders.delete(self);
  if (!hold) return;
  hold.thing.holders.add(self);
  hold.thing.parent ??= hold.thing.object.parent;
}

/** what `self`'s hands hold, a two-handed thing once */
export function held(self: Holder): Thing[] {
  return [...new Set(Object.values(self.holding).flatMap((hold) => hold ? [hold.thing] : []))];
}

/** the weight `self`'s hands bear: what they hold off its support, a two-handed thing once (kg) */
export function heldMass(self: Holder): number {
  return held(self).reduce((sum, thing) => sum + (supported(thing) ? 0 : thing.mass), 0);
}

/** the hands of `self` holding `thing` */
export function handsOn(self: Holder, thing: Thing): string[] {
  return Object.keys(self.holding).filter((hand) => self.holding[hand]?.thing === thing);
}

/** whether `thing` is worn: on a body (under its object or a bone), neither in both hands of a body that moves it nor hanging from a hand on it */
export function worn(thing: Thing): boolean {
  const body = bodyOf(thing.object);
  return body !== null && !movers.has(thing.object) && !inHand(body, thing);
}

/** whether `self` carries `thing`: in both its hands, moving it itself, or hanging from the one hand that holds it */
export function carriedBy(self: Holder, thing: Thing): boolean {
  return movers.get(thing.object) === self || inHand(self, thing);
}

/** whether `thing` hangs from a hand of `self` that holds it (a thing held in one hand is attached under that hand's bone) */
export function inHand(self: Holder, thing: Thing): boolean {
  const bone = hangsFrom(self, thing.object);
  return handsOn(self, thing).some((hand) => self.hands[hand] === bone);
}

/** whether `thing` rests on what it is in: not lifted since it was last put down in the room, and on no body */
export function supported(thing: Thing): boolean {
  return !thing.lifted && !bodyOf(thing.object);
}

/**
 * `thing` attached under `parent` where it is as the scene has them, moved by no body. A body re-parenting it mid-update (`reader`) takes
 * it where it was as the scene stood when the body last wrote it: what the app moves read as the body last read it (`written`), not as
 * the app has moved it since — the parent, a bone, still stands as the body last wrote it, and a rifle the app had moved 2 cm on took the
 * magazine in the hand 2 cm off the palm, the grasp keeping it so.
 */
export function attach(thing: Thing, parent: Object3D, reader?: Resolving): void {
  const object = thing.object, mover = movers.get(object);
  const world = reader && written(reader, object, _world);
  mover?.leave(object);
  parent.updateWorldMatrix(true, false);
  object.updateWorldMatrix(true, false);
  parent.attach(object);
  thing.parent = parent;
  if (!world) return;
  world.premultiply(_parentInverse.copy(parent.matrixWorld).invert()).decompose(object.position, object.quaternion, object.scale);
}

/** `object` written relative to `parent` to be at `position`, turned `quaternion` (world), as `reader` finds `parent` */
function placeUnder(reader: Resolving, object: Object3D, parent: Object3D, position: Readonly<Vector3>, quaternion: Readonly<Quaternion>): void {
  const frame = resolve(reader, parent, _frame), back = _back.copy(frame.quaternion).invert();
  object.position.copy(position).sub(frame.position).applyQuaternion(back).divideScalar(_scale.setFromMatrixScale(parent.matrixWorld).x);
  object.quaternion.copy(back).multiply(quaternion);
}

/** `thing` lifted into `self`'s hands (`take`), where it was taken from kept unless it was lifted already */
export function lift(self: Holder, thing: Thing): void {
  const parent = thing.object.parent;
  if (parent && !thing.lifted) [thing.home, thing.taken] = [parent, self.track(thing.object).current.position.clone()];
  thing.lifted = true;
  take(self, thing);
}

/** `thing` taken into `self`'s hands on it, where it is: in one, attached under that hand's bone; in both, under the root bone and moved by `self` (`move`) */
export function take(self: Holder, thing: Thing): void {
  const hands = handsOn(self, thing);
  if (!hands.length) throw new Error(`"${thing.object.name}" is in none of the body's hands`);
  if (carriedBy(self, thing)) return;
  attach(thing, self.boneNode(hands.length === 1 ? self.hands[hands[0]] : 0), self);
  if (hands.length === 1) return;
  const at = resolve(self, thing.object, { position: new Vector3(), quaternion: new Quaternion() });
  const carrier = new Carrier(at.position, at.quaternion);
  // (standing there as of the sub-step before: `move` moves it on in this one)
  carrier.place(self.frame.time - self.frame.dt, at.position, at.quaternion);
  self.carry(thing.object, carrier);
}

/**
 * Where `self` moves what it holds, after its hands: a thing in both hands a carry aims this sub-step fitted to the wrists holding it
 * (their middle, turned so the line between its grips lies along the line between them), as the aim turns it; one nothing aims going
 * along with the root bone; each written into its object relative to the bone it hangs from. A thing in one hand hangs from that hand's
 * bone as the hand took it: it goes and turns with the hand (a grasp fixes the hand on the thing), and a carry turns it by turning the hand.
 */
export function move(self: Holder, f: Frame, aims: ReadonlyMap<Object3D, Carrier>): void {
  for (const [object, carrier] of self.carried) {
    const aim = aims.get(object), hands = handsOn(self, Thing.of(object));
    if (aim && hands.length === 2) fit(self, f, aim, hands, carrier);
    else if (!carrier.moved(f.time)) along(f, carrier);
    if (object.parent) placeUnder(self, object, object.parent, carrier.current.position, carrier.current.quaternion);
  }
}

/**
 * `object`, if `self` carries it and nothing aims it, moved on with bone `bone` (the root, unless told) this sub-step already (it has
 * moved by the time the hands keep to it): they go where it is, not where its last motion would have carried it on — a turn braking,
 * which it overshot by the hands' whole reach of it
 */
export function carryAlong(self: Holder, f: Frame, object: Object3D, bone = 0): void {
  const carrier = self.carried.get(object);
  if (carrier && !carrier.moved(f.time)) along(f, carrier, bone);
}

/** a carried thing nothing aims, moved with bone `bone` (the root's, unless the holder carries it by another) as it moved this sub-step */
function along(f: Frame, carrier: Carrier, bone = 0): void {
  const turn = _turn.copy(f.current.rotation(bone)).multiply(_back.copy(f.prev.rotation(bone)).invert());
  const at = _at.copy(carrier.current.position).sub(f.prev.position(bone)).applyQuaternion(turn).add(f.current.position(bone));
  carrier.move(f.time, at, turn.multiply(carrier.current.quaternion));
}

/** a thing in both hands where the wrists hold it: as `aim` has it, carried along with the wrists */
function fit(self: Holder, f: Frame, aim: Carrier, hands: readonly string[], carrier: Carrier): void {
  const at = (hand: string, out: Vector3) => {
    const hold = self.holding[hand];
    if (!hold) throw new Error(`fit: the ${hand} hand holds nothing`);
    return out.copy(hold.goal.position).applyQuaternion(aim.current.quaternion).add(aim.current.position);
  };
  const wrist = (hand: string, out: Vector3) => out.copy(f.current.position(self.hands[hand]));
  const grips = _a.subVectors(at(hands[1], _g1), at(hands[0], _g2)).normalize();
  const wrists = _b.subVectors(wrist(hands[1], _w1), wrist(hands[0], _w2)).normalize();
  const turn = _turn.setFromUnitVectors(grips, wrists);
  const middle = at(hands[0], _m).add(at(hands[1], _g1)).multiplyScalar(0.5);
  const between = wrist(hands[0], _h).add(wrist(hands[1], _w1)).multiplyScalar(0.5);
  carrier.move(f.time, _at.subVectors(aim.current.position, middle).applyQuaternion(turn).add(between), _q.copy(turn).multiply(aim.current.quaternion));
}

/** How much of a thing's weight a body bears: its share (0 … 1) now and the two sub-steps before, its mass borne (kg) and the bones it bears on. */
export interface Bearing {
  share: number;
  prev: number;
  prev2: number;
  kg: number;
  bones: number[];
}

/** how quickly a weight is taken up and given up (share/s², share/s) */
const BEARING = { accel: 16, speed: 4 };

/**
 * The weight `self` bears, a sub-step on: each thing it holds off its support borne by the hands holding it (and by them, what hangs
 * from it), each it wears by the bone it hangs from; each share taken up and given up over a moment (what it wears from its first
 * sub-step, borne from then), and loaded onto those bones at the thing's centre of mass in this sub-step's pose.
 */
export function bear(self: Holder, f: Frame, worn: readonly Thing[], borne: Map<Thing, Bearing>): void {
  const things = new Set<Thing>([...worn, ...held(self), ...borne.keys()]);
  // (a released bearing stays in this set for the sub-step that clears its loads)
  if (things.size === 0) return;
  for (const thing of things) {
    if (thing.mass === 0) continue;
    const bones = bearers(self, thing);
    let bearing = borne.get(thing);
    // (worn from the start — as the body was made — it bears it from the start)
    const start = f.time <= f.dt + 1e-9 && bones.length > 0 ? 1 : 0;
    if (!bearing) borne.set(thing, (bearing = { share: start, prev: start, prev2: start, kg: 0, bones }));
    [bearing.prev2, bearing.prev] = [bearing.prev, bearing.share];
    bearing.share = Math.min(1, Math.max(0, follow(bearing.prev2, bearing.prev, bones.length > 0 ? 1 : 0, BEARING, f.dt)));
    if (bones.length > 0) bearing.bones = bones;
    if (bearing.share === 0 && bones.length === 0) borne.delete(thing);
    else bearing.kg = bearing.share * thing.mass;
  }
  load(self, f.current, borne);
}

/** the bones `thing` bears on: the hands holding it (or what it hangs from) off its support, else the bone of `self` it hangs from */
function bearers(self: Holder, thing: Thing): number[] {
  for (let at: Object3D | null = thing.object; at; at = at.parent) {
    const anchor = anchors.get(at);
    if (anchor) return anchor.body === self && anchor.bone >= 0 ? [anchor.bone] : [];
    if (at.userData.mass === undefined) continue;
    const above = Thing.of(at), hands = handsOn(self, above);
    if (hands.length) return supported(above) ? [] : hands.map((hand) => self.hands[hand]);
  }
  return [];
}

/** what `self` bears loaded onto its bones in `pose`, each thing's at its centre of mass */
export function load(self: Holder, pose: Pose, borne: ReadonlyMap<Thing, Bearing>): void {
  const mass = new Map<number, number>(), moment = new Map<number, Vector3>();
  for (const [thing, bearing] of borne) {
    const placed = self.track(thing.object).at(self.frame.time).current;
    const centre = _c.copy(thing.centre).applyQuaternion(placed.quaternion).add(placed.position);
    for (const bone of bearing.bones) {
      mass.set(bone, (mass.get(bone) ?? 0) + bearing.kg / bearing.bones.length);
      let sum = moment.get(bone);
      if (!sum) moment.set(bone, (sum = new Vector3()));
      sum.addScaledVector(centre, bearing.kg / bearing.bones.length);
    }
  }
  for (let bone = 0; bone < pose.skeleton.bones.length; bone++) {
    const m = mass.get(bone) ?? 0, sum = moment.get(bone);
    if (m === 0 || !sum) pose.setLoad(bone, 0, ZERO);
    else pose.setLoad(bone, m, sum.divideScalar(m).sub(pose.position(bone)).applyQuaternion(_q.copy(pose.rotation(bone)).invert()));
  }
}

/**
 * development: a thing whose parent changed under a holding hand of `self` but not by the library (a stray `scene.add`, a physics
 * sync) is a problem, once; the hand follows it where it is now, and `self` no longer moves it
 */
export function checkParents(self: Holder, f: Frame): void {
  for (const thing of held(self)) {
    const now = thing.object.parent;
    if (!thing.parent || now === thing.parent) continue;
    f.dev?.append(f.time, { check: 'the parent of a held thing changed under the hand: something else moved it', value: 1, limit: 0, where: `${thing.object.name} under ${now?.name ?? 'nothing'}` });
    thing.parent = now;
    self.leave(thing.object);
  }
}

/** the things under `self` (on its object or bones) its hands do not hold: what it wears */
export function wornOf(self: Holder): Thing[] {
  const worn: Thing[] = [], holding = held(self);
  self.object.traverse((node) => {
    if (node.userData.mass === undefined) return;
    const thing = Thing.of(node);
    if (!holding.includes(thing)) worn.push(thing);
  });
  return worn;
}

const _frame: Placement = { position: new Vector3(), quaternion: new Quaternion() };
const _world = new Matrix4(), _parentInverse = new Matrix4();
const ZERO = new Vector3(), _scale = new Vector3();
const _back = new Quaternion(), _turn = new Quaternion(), _q = new Quaternion();
const _at = new Vector3(), _c = new Vector3(), _a = new Vector3(), _b = new Vector3(), _m = new Vector3(), _h = new Vector3();
const _g1 = new Vector3(), _g2 = new Vector3(), _w1 = new Vector3(), _w2 = new Vector3();

