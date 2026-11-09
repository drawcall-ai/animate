import { Object3D, Quaternion, Vector3 } from 'three';
import type { Frame } from '../../kernel/frame';
import type { Goal, Placement } from '../../kernel/goal';
import { minimumJerk } from '../../kernel/math';
import { digitsOf } from '../../fingers/placement';
import { handsOn, inHand } from '../../things/hold';
import { resolve } from '../../things/resolve';
import type { Hold } from '../../things/holder';
import type { Thing } from '../../things/thing';
import { sideOf, type Side } from '../anatomy/bones';
import { broughtTurn, elbowPole, scratch } from './arms';
import { holdsClear } from './arm-clearance';
import { solveChain } from '../../kernel/chain';
import { coordinates, coordinatesOf } from '../../kernel/limits';
import type { Pose, ReadonlyPose } from '../../kernel/pose';
import { fixes } from './plan';
import type { Person } from '../person';

/**
 * A thing in one hand hangs from the hand as the hand took it: the grasp fixes the hand on the thing, and the thing goes and turns with
 * the hand. Carried, the hand goes where the thing is to go, turned as the thing
 * is to be turned, and the arm — shoulder, elbow, forearm and wrist — finds how to put it there. Nothing reads the hand's own turn back
 * into where it goes: the thing's turn is the carry's, the hand's follows from the grasp.
 *
 * A grip that leaves the hand's turn free has its placement picked as the grab starts, for that moment, so the grasp may change. From
 * half a second before a carry's path ends (`PLANNED`, travel.ts), with the body nearly as it will stand, the hand weighs the grasp it has at the end, each sub-step while it
 * keeps it: solved there, how far its joints are out of the middle of their ranges (`strainAt`). Comfortable enough (`STRAINED`), it is
 * kept, the arm working for it (a lance borne upright beside the hip); else the hand regrips onto the least turned of the grasps tried
 * there that the arm holds clearly more comfortably (strained by half `STRAINED` at most, and by `STRAINED` less) — the hand as the arm
 * brings it (`broughtTurn`), turned about the palm — as people choose a grasp for the posture it ends in (the end-state comfort effect,
 * Rosenbaum et al. 1990, recalled);
 * if none is, onto the least strained, but only where the arm cannot hold the one it has at all (in the trunk: a belt's buckle taken
 * palm down off a table, held to the belly, its wrist a palm behind it; or far short of its turn). The hand turns the thing in its
 * fingers about the palm onto it (`REGRIP` s; an in-hand rotation, Exner 1992, recalled), and the thing still ends turned as the carry
 * asks. A thing not at rest half a second after its path is over is weighed again, from the body as it then stands, and held turned
 * off its end (`TURNED_OFF`) its grasp counts as one the arm does not hold there. A grip that sets
 * the hand's turn is never regripped: the author fixed the hand on it; nor one that declares its contact (`shifts`), the fingers kept on it.
 */

/** Tuned: how long (s) the hand takes to turn a thing in its fingers onto the grasp planned for its carry's end */
const REGRIP = 0.6;
/** how strained (rad, `strainAt`) the arm may hold a grasp at a carry's end and keep it, its joints working for it: summed over the
 * shoulder, elbow and wrist, some 7° each past their comfortable middle — a grasp no one shifts for; past it the joints near the ends of
 * their ranges brake into an unsteady hold, which people avoid by regripping */
const STRAINED = 0.35;

/** how far (rad) a thing a carry has not brought to rest may be held turned off its end and its grasp still count as held there */
const TURNED_OFF = 0.05;

/** the hand bone's node in the thing's frame: how the hand holds it */
type InHand = Placement;

/** how long (s) the fingers take to seat a thing on the place a carry brings it to (`seat`): a few millimetres and degrees */
const SEAT = 0.1;

/** A hold's regrip under way: the hand's node turned in the thing from as it held it onto as planned, its palm's centre going from
 * `palm` to `onto` on the thing (the thing's frame; the same, turned about it), over `seconds` from `start` (s). */
interface Regrip {
  from: Quaternion;
  to: Quaternion;
  palm: Vector3;
  onto: Vector3;
  start: number;
  seconds: number;
}
const regrips = new WeakMap<Hold, Regrip>();

/** hand `side`'s node in `thing`'s frame as the body was last posed (into `out`) */
function heldNow(person: Person, side: Side, thing: Thing, out: InHand): InHand {
  const hand = resolve(person, person.boneNode(person.hands[side]), out);
  const at = resolve(person, thing.object, _placed), back = _back.copy(at.quaternion).invert();
  hand.position.sub(at.position).applyQuaternion(back);
  hand.quaternion.premultiply(back);
  return hand;
}

/**
 * Where hand `side` goes for `thing`, hanging from it, in the thing's frame (to be where a moving frame has it): where its grasp has the hand
 * bone in the thing, its rest undone. Mid-regrip, the grasp the regrip has reached, the thing placed in the hand so.
 */
export function grasped(person: Person, side: Side, thing: Thing): (f: Frame) => Goal {
  const bone = person.hands[side], rest = person.restOf(bone).clone().invert();
  const held = heldNow(person, side, thing, { position: new Vector3(), quaternion: new Quaternion() });
  return (f) => {
    const hold = person.holding[side], regrip = hold && regrips.get(hold);
    if (regrip) regripped(person, side, thing, regrip, f.time, held);
    return { position: held.position.clone(), quaternion: held.quaternion.clone().multiply(rest) };
  };
}

/** the grasp a regrip has reached at `time` (into `out`), the thing placed in the hand so */
function regripped(person: Person, side: Side, thing: Thing, regrip: Regrip, time: number, out: InHand): void {
  const bone = person.hands[side], share = minimumJerk(Math.min(1, (time - regrip.start) / regrip.seconds));
  out.quaternion.slerpQuaternions(regrip.from, regrip.to, share);
  // (the palm where it has got to on the thing: the wrist a palm back from it along the hand as it has turned so far)
  out.position.copy(palmOn(person, side)).applyQuaternion(handTurn(person, side, out.quaternion)).negate().add(_onto.lerpVectors(regrip.palm, regrip.onto, share));
  if (!inHand(person, thing)) throw new Error(`regrip: "${thing.object.name}" does not hang from the ${side} hand`);
  // (the thing under the hand's node: the inverse of the node in the thing, in the node's units)
  const object = thing.object;
  object.quaternion.copy(out.quaternion).invert();
  object.position.copy(out.position).applyQuaternion(object.quaternion).negate().divideScalar(person.scaleOf(bone));
}

/**
 * For a carry of `thing` in hand `side` alone by a grip that leaves its turn free (`fixes`), to `end` (world, turned): the grasp it has if
 * the arm holds it there comfortably enough (`strainAt`, `STRAINED`); else a regrip onto the least turned of the grasps tried that it holds
 * clearly more comfortably there — or, if none is and the arm cannot hold the one it has there at all (in the trunk, or far short of its
 * turn), onto the least strained of them; else still the one it has, the arm working for it (a lance borne upright beside the hip).
 * Whether it kept the grasp as comfortable enough there: weighed again as the end or the body moves on, it may yet be regripped.
 */
function planGrasp(person: Person, side: Side, thing: Thing, hold: Hold, end: Readonly<Placement>, settling = false): boolean {
  if (fixes(hold.thing.grip(hold.grip)) || !shifts(hold) || !inHand(person, thing)) return false;
  const f = person.frame, bone = person.hands[side], restOf = person.restOf(bone);
  const from = inHandNow(person, side, thing, hold);
  // (the hand's own turn in the thing, and its palm there: a regrip turns the hand about it)
  const turn = handTurn(person, side, from.quaternion);
  const palm = palmOn(person, side), inThing = palmIn(person, side, from, _palm);
  const at = _at.copy(inThing).applyQuaternion(end.quaternion).add(end.position);
  const { brought: posed, trial } = scratch(person);
  const brought = broughtTurn(person, f.prev, side, at, posed, _brought);
  trial.copy(posed);
  const strain = (hand: Readonly<Quaternion>) => strainAt(person, posed, trial, side, at, hand);
  // (settling, the thing held turned off its end: the arm as it stands does not hold this grasp there, whatever an arm brought there
  // afresh would, so waiting longer would not bring it there)
  const off = settling && resolve(person, thing.object, _placed).quaternion.angleTo(end.quaternion) > TURNED_OFF;
  const kept = Math.max(strain(_kept.copy(end.quaternion).multiply(turn)), off ? UNHELD : 0);
  if (kept <= STRAINED) return true;
  // (the hand as the arm brings it there, turned about the palm round the vertical, the body's left and its own length, the least first)
  const left = _left.set(1, 0, 0).applyQuaternion(_facing.setFromAxisAngle(UP, person.locomotion.facing));
  const along = _along.copy(palm).normalize().applyQuaternion(brought);
  // (the least turned grasp clearly more comfortable than the one it has — strained by no more than half `STRAINED`, and by `STRAINED`
  // less; where the arm cannot hold the one it has at all, else the least strained)
  const enough = Math.min(STRAINED / 2, kept - STRAINED);
  let least = kept >= UNHELD ? kept : enough, chosen: Quaternion | null = null;
  for (const [yaw, pitch, roll] of TURNS) {
    const hand = _candidate.setFromAxisAngle(UP, yaw).multiply(_q.setFromAxisAngle(left, pitch)).multiply(_q.setFromAxisAngle(along, roll)).multiply(brought);
    const strained = strain(hand);
    if (strained > least) continue;
    [least, chosen] = [strained, (chosen ?? new Quaternion()).copy(hand)];
    if (strained <= enough) break;
  }
  if (!chosen) return false;
  const to = chosen.premultiply(_back.copy(end.quaternion).invert()).multiply(restOf);
  regrips.set(hold, { from: from.quaternion, to, palm: inThing.clone(), onto: inThing.clone(), start: f.time, seconds: REGRIP });
  return false;
}

/** whether `hold` may shift in the fingers: not where its grip declares the contact (a pad on its empty, a digit on another) */
export function shifts(hold: Hold): boolean {
  const grip = hold.thing.grip(hold.grip);
  if (grip.point !== 'palm') return false;
  // (as the fingers read them, each update: an author may move a digit onto an empty mid-hold)
  return !Object.values(digitsOf(hold.thing.object, grip) ?? {}).some((digit) => digit instanceof Object3D);
}

/** where the palm of `side`'s hand was as its hold took it (the hand bone's frame): what a regrip turns the hand about */
function palmOn(person: Person, side: Side): Vector3 {
  const point = person.holding[side]?.point;
  if (!point) throw new Error(`regrip: the ${side} hand holds nothing by its palm`);
  return point.at;
}

/** when a carry's one-handed grasp is weighed for its end (`regripping`) */
export interface Regripping {
  /** weighed as the course nears its end, the last time as it is `over` */
  nearing: (f: Frame, over: boolean) => void;
  settling: (f: Frame) => void;
}

/**
 * For a carry of `thing` to `end` in one hand, its grasp planned for its end (`planGrasp`, the end turned as the carry asks or else as
 * the thing is now): as it nears its end (`nearing`, from `PLANNED` s before it, travel.ts) — weighed each sub-step until its course is over, the end and the body as they
 * then stand, for as long as the grasp it has is kept as comfortable there: an end that moves on the body (a socket on
 * something the other hand holds up as the head turns to it) is weighed where it has gone, not only where it was half a second before
 * — and once more, from the body as it then stands, if it has not come to rest there `SETTLING` s (travel.ts) after its course is over
 * (`settling`): then a thing held turned off its end counts as not held by the grasp it has.
 */
export function regripping(person: Person, thing: Thing, end: (f: Frame) => Goal): Regripping {
  const [hand, ...others] = handsOn(person, thing), hold = hand === undefined || others.length ? null : person.holding[hand];
  const plan = (f: Frame, settling = false) => {
    if (!hold) return false;
    const at = end(f);
    return planGrasp(person, sideOf(hand), thing, hold, { position: at.position, quaternion: at.quaternion ?? resolve(person, thing.object, _placed).quaternion }, settling);
  };
  let kept = true;
  return {
    nearing: (f, over) => {
      if (kept) kept = plan(f) && !over;
    },
    settling: once((f) => plan(f, true)),
  };
}

/** `act`, done the first time only */
function once(act: (f: Frame) => void): (f: Frame) => void {
  let done = false;
  return (f) => {
    if (done) return;
    done = true;
    act(f);
  };
}

/**
 * `thing`, carried to a place in hand `side` alone, seated on it exactly: `at` (world) where it is, `end` its place, the hand held where
 * it is and the thing moved in its fingers over `SEAT` s the last few millimetres and degrees the arm leaves it off its place. When it is
 * seated (s, the body's time).
 */
export function seat(person: Person, side: Side, thing: Thing, at: Readonly<Placement>, end: Readonly<Placement>): number {
  const hold = person.holding[side];
  if (!hold || hold.thing !== thing || !inHand(person, thing)) throw new Error(`seat: "${thing.object.name}" does not hang from the ${side} hand`);
  const from = inHandNow(person, side, thing, hold);
  // (the hand where it is, as the thing where it is has it, brought into the thing's frame on its place)
  const back = end.quaternion.clone().invert(), hand = from.position.clone().applyQuaternion(at.quaternion).add(at.position);
  const to: InHand = { position: hand.sub(end.position).applyQuaternion(back), quaternion: back.multiply(at.quaternion).multiply(from.quaternion) };
  const start = person.frame.time;
  regrips.set(hold, { from: from.quaternion, to: to.quaternion, palm: palmIn(person, side, from, new Vector3()), onto: palmIn(person, side, to, new Vector3()), start, seconds: SEAT });
  return start + SEAT;
}

/** how hand `side` holds `thing` now: as its regrip has reached, else as the body was last posed */
function inHandNow(person: Person, side: Side, thing: Thing, hold: Hold): InHand {
  const from: InHand = { position: new Vector3(), quaternion: new Quaternion() }, prior = regrips.get(hold);
  if (prior) regripped(person, side, thing, prior, person.frame.time, from);
  else heldNow(person, side, thing, from);
  return from;
}

/** the hand bone's own turn in the thing as its node is turned `node` there */
function handTurn(person: Person, side: Side, node: Readonly<Quaternion>): Quaternion {
  return _turn.copy(node).multiply(_back.copy(person.restOf(person.hands[side])).invert());
}

/** where the palm's centre is on the thing, the hand held `held` (into `out`) */
function palmIn(person: Person, side: Side, held: Readonly<InHand>, out: Vector3): Vector3 {
  return out.copy(palmOn(person, side)).applyQuaternion(handTurn(person, side, held.quaternion)).add(held.position);
}

/**
 * How uncomfortably arm `side` holds its hand turned `turn` (world) with its palm at `at`: solved there on `scratch` (a pose as the body
 * stands, the arm set off as `pose` has it), how far (rad, summed) its joints are out of the middle `COMFORTABLE` share of their ranges,
 * and its hand short of the turn where a range stops it; `UNHELD` more if it cannot hold it so — no elbow keeps the arm out of the trunk,
 * or the hand is short of the turn by more than `SHORT`. 0: comfortably.
 */
function strainAt(person: Person, pose: ReadonlyPose, scratch: Pose, side: Side, at: Readonly<Vector3>, turn: Readonly<Quaternion>): number {
  const proportions = person.proportions, skeleton = scratch.skeleton, bones = skeleton.chain(`${side}Arm`), hand = bones[bones.length - 1];
  for (const bone of bones) scratch.setLocal(bone, pose.local(bone));
  const wrist = _held.copy(palmOn(person, side)).applyQuaternion(turn).negate().add(at), pole = elbowPole(scratch, proportions, side, wrist, _pole);
  solveChain({ current: scratch }, `${side}Arm`, { tip: { position: wrist, quaternion: _turnAt.copy(turn) }, pole });
  const short = scratch.rotation(hand).angleTo(turn);
  let strain = short;
  for (const bone of bones) {
    const limit = skeleton.limits[bone];
    if (!limit) continue;
    const { value, range } = coordinatesOf(_turnAt.copy(scratch.local(bone)), limit, _coordinates);
    value.forEach((x, k) => {
      const [lo, hi] = range[k], margin = (1 - COMFORTABLE) / 2 * (hi - lo);
      strain += Math.max(0, lo + margin - x, x - hi + margin);
    });
  }
  return short <= SHORT && holdsClear(scratch, proportions, side, wrist, at, pole) ? strain : strain + UNHELD;
}

/** the share of each joint's range, about its middle, it is comfortable in: all but the last tenth at either end, where the joint's
 * passive stiffness rises steeply */
const COMFORTABLE = 0.8;
/** how far (rad) a hand may be left short of its turn and still hold its thing so: as far as the fingers' own give takes up unseen;
 * further, it is visibly held wrong */
const SHORT = 0.5;
/** what a hand its arm cannot hold so counts for against its joints' discomfort (rad): more than any */
const UNHELD = 10;

const _placed: Placement = { position: new Vector3(), quaternion: new Quaternion() };
const _back = new Quaternion(), _turn = new Quaternion(), _brought = new Quaternion(), _kept = new Quaternion(), _candidate = new Quaternion(), _facing = new Quaternion();
const UP = new Vector3(0, 1, 0), _left = new Vector3(), _along = new Vector3(), _q = new Quaternion();
/** the turns tried about the palm off how the arm brings the hand (rad: round the vertical, the body's left, the hand's own length), the
 * least first: every 30° to 90° round the vertical, to 60° about the left, every 45° to 90° about the hand */
const TURNS = (() => {
  const turns: [number, number, number][] = [], deg = Math.PI / 180;
  for (let yaw = -90; yaw <= 90; yaw += 30) for (let pitch = -60; pitch <= 60; pitch += 30) for (let roll = -90; roll <= 90; roll += 45) turns.push([yaw * deg, pitch * deg, roll * deg]);
  return turns.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
})();
const _palm = new Vector3(), _at = new Vector3(), _onto = new Vector3();
const _pole = new Vector3(), _held = new Vector3(), _turnAt = new Quaternion(), _coordinates = coordinates();
