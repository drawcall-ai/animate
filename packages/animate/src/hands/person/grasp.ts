import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../../kernel/frame';
import type { Carrier } from '../../kernel/carrier';
import type { Goal, Placement } from '../../kernel/goal';
import { minimumJerk } from '../../kernel/math';
import { Pose } from '../../kernel/pose';
import { inHand } from '../../things/hold';
import { resolve, type Hold } from '../../things/resolve';
import type { Thing } from '../../things/thing';
import { palmOf } from '../../species/humanoid/landmarks';
import type { Side } from '../../species/humanoid/bones';
import { broughtTurn, strainAt, UNHELD } from './arms';
import type { Reacher } from './reacher';

/**
 * A thing in one hand hangs from the hand as the hand took it: the grasp fixes the hand on the thing, and the thing goes and turns with
 * the hand. Carried, the hand goes where the thing is to go, turned as the thing
 * is to be turned, and the arm — shoulder, elbow, forearm and wrist — finds how to put it there. Nothing reads the hand's own turn back
 * into where it goes: the thing's turn is the carry's, the hand's follows from the grasp.
 *
 * A grip that sets no hand turn says only where the palm closes, so the grasp may change. Half a second before a carry's course ends
 * (`PLANNED`, carry.ts), with the body nearly as it will stand, the hand weighs the grasp it has at the end: solved there, how far its
 * joints are out of the middle of their ranges (`strainAt`). Comfortable enough (`STRAINED`), it is kept, the arm working for it (a lance
 * borne upright beside the hip); else the hand regrips onto the least turned of the grasps tried there that the arm holds comfortably —
 * the hand as the arm brings it (`broughtTurn`), turned about the palm — as people choose a grasp for the posture it ends in (the
 * end-state comfort effect, Rosenbaum et al. 1990, recalled); if none is, onto the least strained, but only where the arm cannot hold
 * the one it has at all (in the trunk: a belt's buckle taken palm down off a table, held to the belly, its wrist a palm behind it; or far
 * short of its turn). The hand turns the thing in its fingers about the palm onto it (`REGRIP` s; an in-hand rotation, Exner 1992,
 * recalled), and the thing still ends turned as the carry asks. A thing not at rest half a second after its course is over is weighed
 * again, from the body as it then stands. A grip that sets the hand's turn is never regripped: the author fixed the hand on it.
 */

/** Tuned: how long (s) the hand takes to turn a thing in its fingers onto the grasp planned for its carry's end */
const REGRIP = 0.6;
/** Tuned: how strained (rad, `strainAt`) the arm may hold a grasp at a carry's end and keep it, its joints working for it (a box held by
 * its side, at 0.37 lifted 20 cm, regripped; one carried beside another, at 0.33, kept: the joints near the ends of their ranges brake
 * into an unsteady hold) */
const STRAINED = 0.35;

/** the hand bone's node in the thing's frame: how the hand holds it */
type InHand = Placement;

/** A hold's regrip under way: the hand's node turned in the thing from as it held it onto as planned, about its palm's centre there
 * (the thing's frame), set off at `start` (s). */
interface Regrip {
  from: Quaternion;
  to: Quaternion;
  palm: Vector3;
  start: number;
}
const regrips = new WeakMap<Hold, Regrip>();

/** hand `side`'s node in `thing`'s frame as the body was last posed (into `out`) */
function heldNow(person: Reacher, side: Side, thing: Thing, out: InHand): InHand {
  const hand = resolve(person, person.boneNode(person.hands[side]), out);
  const at = resolve(person, thing.object, _placed), back = _back.copy(at.quaternion).invert();
  hand.position.sub(at.position).applyQuaternion(back);
  hand.quaternion.premultiply(back);
  return hand;
}

/**
 * Where hand `side` goes for `thing`, hanging from it, to be where a carrier has it: where its grasp has the hand bone in the thing, its
 * rest undone. Mid-regrip, the grasp the regrip has reached, the thing placed in the hand so.
 */
export function grasped(person: Reacher, side: Side, thing: Thing): (f: Frame, carrier: Carrier) => Goal & { velocity: Vector3 } {
  const bone = person.hands[side], rest = person.restOf(bone).clone().invert(), velocity = new Vector3();
  const held = heldNow(person, side, thing, { position: new Vector3(), quaternion: new Quaternion() });
  return (f, carrier) => {
    const hold = person.holding[side], regrip = hold && regrips.get(hold);
    if (regrip) regripped(person, side, thing, regrip, f.time, held);
    const position = held.position.clone().applyQuaternion(carrier.current.quaternion).add(carrier.current.position);
    const quaternion = carrier.current.quaternion.clone().multiply(held.quaternion).multiply(rest);
    return { position, quaternion, velocity: carrier.velocity(velocity) };
  };
}

/** the grasp a regrip has reached at `time` (into `out`), the thing placed in the hand so */
function regripped(person: Reacher, side: Side, thing: Thing, regrip: Regrip, time: number, out: InHand): void {
  const bone = person.hands[side], share = minimumJerk(Math.min(1, (time - regrip.start) / REGRIP));
  out.quaternion.slerpQuaternions(regrip.from, regrip.to, share);
  // (the palm kept where it is on the thing: the wrist a palm back from it along the hand as it has turned so far)
  const turn = _turn.copy(out.quaternion).multiply(_back.copy(person.restOf(bone)).invert());
  out.position.copy(palmOf(person.proportions, side)).applyQuaternion(turn).negate().add(regrip.palm);
  if (!inHand(person, thing)) throw new Error(`regrip: "${thing.object.name}" does not hang from the ${side} hand`);
  // (the thing under the hand's node: the inverse of the node in the thing, in the node's units)
  const object = thing.object;
  object.quaternion.copy(out.quaternion).invert();
  object.position.copy(out.position).applyQuaternion(object.quaternion).negate().divideScalar(person.scaleOf(bone));
}

/**
 * For a carry of `thing` in hand `side` alone by a grip that sets no hand turn, to `end` (world, turned): the grasp it has if the arm
 * holds it there comfortably (`strainAt`); else a regrip onto the least turned of the grasps tried that it holds comfortably there — or,
 * if none is and the arm cannot hold the one it has there at all (in the trunk, or far short of its turn), onto the least strained of
 * them; else still the one it has, the arm working for it (a lance borne upright beside the hip).
 */
export function planGrasp(person: Reacher, side: Side, thing: Thing, hold: Hold, end: Readonly<Placement>): void {
  if (hold.goal.quaternion || !inHand(person, thing)) return;
  const f = person.frame, bone = person.hands[side], restOf = person.restOf(bone);
  const prior = regrips.get(hold);
  const from: InHand = { position: new Vector3(), quaternion: new Quaternion() };
  if (prior) regripped(person, side, thing, prior, f.time, from);
  else heldNow(person, side, thing, from);
  // (the hand's own turn in the thing, and its palm there: a regrip turns the hand about it)
  const turn = _turn.copy(from.quaternion).multiply(_back.copy(restOf).invert());
  const palm = palmOf(person.proportions, side), inThing = _palm.copy(palm).applyQuaternion(turn).add(from.position);
  const at = _at.copy(inThing).applyQuaternion(end.quaternion).add(end.position);
  const { brought: posed, trial } = scratch(person);
  const brought = broughtTurn(person, f.prev, side, at, posed, _brought);
  trial.copy(posed);
  const strain = (hand: Readonly<Quaternion>) => strainAt(person, posed, trial, side, at, hand);
  const kept = strain(_kept.copy(end.quaternion).multiply(turn));
  if (kept <= STRAINED) return;
  // (the hand as the arm brings it there, turned about the palm round the vertical, the body's left and its own length, the least first)
  const left = _left.set(1, 0, 0).applyQuaternion(_facing.setFromAxisAngle(UP, person.locomotion.facing));
  const along = _along.copy(palm).normalize().applyQuaternion(brought);
  let least = kept >= UNHELD ? kept : 0, chosen: Quaternion | null = null;
  for (const [yaw, pitch, roll] of TURNS) {
    const hand = _candidate.setFromAxisAngle(UP, yaw).multiply(_q.setFromAxisAngle(left, pitch)).multiply(_q.setFromAxisAngle(along, roll)).multiply(brought);
    const strained = strain(hand);
    if (strained === 0 || strained < least) [least, chosen] = [strained, (chosen ?? new Quaternion()).copy(hand)];
    if (strained === 0) break;
  }
  if (!chosen) return;
  const to = chosen.premultiply(_back.copy(end.quaternion).invert()).multiply(restOf);
  regrips.set(hold, { from: from.quaternion, to, palm: inThing.clone(), start: f.time });
}

/** for each body, poses to try an arm on: as the arm brings the hand to a carry's end, and each grasp tried from there */
const scratches = new WeakMap<Reacher, { brought: Pose; trial: Pose }>();
function scratch(person: Reacher): { brought: Pose; trial: Pose } {
  let poses = scratches.get(person);
  const skeleton = person.frame.prev.skeleton;
  if (!poses) scratches.set(person, (poses = { brought: new Pose(skeleton), trial: new Pose(skeleton) }));
  return poses;
}

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
const _palm = new Vector3(), _at = new Vector3();
