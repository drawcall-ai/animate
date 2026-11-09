import { MathUtils, Vector3 } from 'three';
import type { Frame } from '../../kernel/frame';
import type { ReadonlyPose } from '../../kernel/pose';
import { forwardOf, wrapAngle, yawOf } from '../../kernel/math';
import { handLowering, MOST_BOW, shoulderHeight, squatOf } from '../legs/walk-pose';
import { INDEX, type Side } from '../anatomy/bones';
import type { Proportions } from '../anatomy/proportions';
import { NECK_PITCH, TRUNK_PITCH } from '../anatomy/ranges';
import { heldMass } from '../../things/hold';
import { loadFactor } from '../../kernel/load';
import { crouchOf, floorUnder } from '../legs/height';
import type { Person } from '../person';

/** how far a hand reaches, bowing and crouching for it (× the arm's length): all but straight, held out at most this far */
export const ARM_REACH = 0.95;
/** how far a reach is planned on the clavicle drawing the shoulder joint toward a hand out past 85% of the arm (× height): a little short
 * of what its range gives (`shrug`, arms.ts) */
export const PROTRACTION = 0.035;
/** how far above the shoulder joint at rest the clavicle aims it for a hand `above` (m) the joint at rest: from none for a hand at the
 * shoulder to a clavicle's length for one 0.6 of the arm above it */
export const liftFor = (proportions: Proportions, side: Side, above: number) =>
  MathUtils.smoothstep(above / proportions.armLength, -0.05, 0.6) * proportions.offsets[`${side}UpperArm`].length();
/** how far the clavicle has lifted the shoulder joint for a hand `height` up (m, on the floor): aimed `liftFor` up, it swings up round
 * the clavicle's length */
const elevationFor = (proportions: Proportions, side: Side, height: number) => {
  const length = proportions.offsets[`${side}UpperArm`].length(), lift = liftFor(proportions, side, height - proportions.shoulderHeight);
  return length * lift / Math.hypot(length, lift);
};

/** Tuned trunk recruitment: bearing beyond 0.75 rad recruits 60%, capped at 20°, keeps reaches within lumbar rotation and leaves the neck
 * to finish an over-shoulder look (requests combine by magnitude, so task order cannot cancel a stronger turn). A hand the trunk holds
 * `held` m off its goal (reaching across it) turns it as far as brings the shoulder that far forward, up to the thoracolumbar spine's
 * active rotation (45°, AAOS; recalled). */
const TWIST = { start: 0.75, share: 0.6, most: Math.PI / 9, held: Math.PI / 4 };
export function twistToward(person: Person, pose: ReadonlyPose, point: Readonly<Vector3>, share = 1, held = 0, carried = false) {
  const station = pose.com(_station);
  const bearing = wrapAngle(Math.atan2(point.x - station.x, point.z - station.z) - person.locomotion.facing);
  const distance = Math.hypot(point.x - station.x, point.z - station.z);
  share *= MathUtils.smoothstep(distance, person.proportions.shoulderHalfWidth, person.proportions.armLength);
  const twisted = carried && held > 0 ? Math.max(0, Math.sign(bearing) * wrapAngle(yawOf(pose.rotation(INDEX.chest)) - person.locomotion.facing)) : 0;
  const turn = Math.max(Math.min(TWIST.most, TWIST.share * Math.max(0, Math.abs(bearing) - TWIST.start)), Math.min(TWIST.held, twisted + held / person.proportions.shoulderHalfWidth));
  const twist = Math.sign(bearing) * turn * share;
  person.asks.add({ twist });
}

/** Tuned: a back bowed this share of what the load lets it is bowed its most */
const BOWED = 0.95;

/** Standing reach requests, closed against the solved shoulder and chest; `carried`: the hand's goal rides on the body itself. */
export function bringShoulder(person: Person, f: Frame, side: Side, hand: Readonly<Vector3>, share = 1, mass = 0, carried = false) {
  const proportions = person.proportions;
  const factor = loadFactor(Math.max(mass, heldMass(person)));
  // (crouched as its root is driven — a player's crouch — it reaches from the crouch, as from a floor that much lower: a hand at its chest
  // is no low reach; what it asks the knees to let it down is from standing, as `lower` is, so it takes the crouch in)
  const crouched = crouchOf(person);
  const floor = floorUnder(person) - crouched, height = carried ? hand.y - f.current.position(0).y + proportions.hipHeight : hand.y - floor;
  const low = height < proportions.hipHeight;
  // Tuned load strategy, not an empirical dose-response: heavier low reaches trade bow for knees.
  let bowLimit = low ? MOST_BOW / factor ** 2 : MOST_BOW;
  // A short arm can still miss the floor with the comfortable bow and a full squat: recruit the remaining trunk range.
  const deeper = low && height < shoulderHeight(proportions, squatOf(proportions), MOST_BOW) - proportions.armLength;
  if (deeper) bowLimit = TRUNK_PITCH * Math.PI / 180 / factor ** 2;
  if (low) person.asks.add({ bowLimit });
  // Preserve the landing leg's clearance; loaded knees prepare as root travel ends.
  if (low && factor > 1 && person.locomotion.moving) return;
  // Recalled: ≥10–15° knees under load. Tuned 30° ceiling on each leg segment (knee flexion is their sum), scaled by the same load law.
  if (low) person.asks.add({ lower: proportions.legLength * (1 - Math.cos(Math.PI / 6 * (1 - 1 / factor ** 2))) * share });
  const shoulder = f.current.position(INDEX[`${side}UpperArm`]);
  // (a hand high up reached for with the shoulder lifted as the arm lifts it, not on the toes)
  const elevation = elevationFor(proportions, side, height);
  // (walking, the clavicle drawn toward the hand, `PROTRACTION`, takes up a small stride's deficit)
  const allowance = person.locomotion.moving ? PROTRACTION * proportions.height : 0;
  // (judged from the shoulder standing upright, not as low as the reach has let it down, so a lowering reach keeps asking while it is short
  // standing — but from the shoulder as it is for a goal on the body, which falls with it, and before the legs' first sub-step)
  const deficit = (person.stepper && !carried ? _upright.copy(shoulder).setY(floor + proportions.shoulderHeight + elevation) : shoulder).distanceTo(hand) - proportions.armLength - allowance;
  const pitch = Math.asin(-_forward.set(0, 0, 1).applyQuaternion(f.current.rotation(INDEX.chest)).y);
  if (person.locomotion.moving && hand.y < shoulder.y && deficit <= 0 && !(low && mass > 0)) return;
  // A bow moves the pelvis back: every reach is planned from the support station, so that shift cannot make a shoulder ask for more bow.
  const from = _v.copy(hand).sub(carried ? f.current.position(0) : f.prev.com(_station));
  const ahead = from.dot(forwardOf(person.locomotion.facing, _forward));
  const lateral = _v.subVectors(hand, shoulder).dot(_left.set(Math.cos(person.locomotion.facing), 0, -Math.sin(person.locomotion.facing)));
  // Tuned 2% reserve for the articulated shoulder arc: its single lever overestimates the reach a deep squat's tucked pelvis leaves.
  const reach = 0.98 * ARM_REACH * proportions.armLength;
  const { lower, bow } = handLowering(proportions, { ahead, lateral, height: height - elevation, reach, bowLimit });
  if (share > 0) person.asks.add({ lower: (crouched + lower) * share });
  // (standing, a hand short of what it reaches for — further than the arm holds out, `ARM_REACH` — shifts the weight toward it, as far
  // as the feet let it: before a step; reaching below the hips, only once the back bows as far as the load lets it. Short of it from the
  // shoulder as low as the knees are asked to let it: a crouch still coming closes the reach by itself — leaning for it meanwhile, the
  // weight came back as the crouch closed it, the shoulder drawn back from the hands on their way)
  const coming = Math.max(0, lower * share - (floor + proportions.hipHeight - f.current.position(0).y));
  const short = _lowered.copy(shoulder).setY(shoulder.y - coming).distanceTo(hand) - ARM_REACH * proportions.armLength;
  if (!person.locomotion.moving && short > 0 && (!low || pitch >= BOWED * bowLimit)) {
    const toward = new Vector3(hand.x - shoulder.x, 0, hand.z - shoulder.z);
    if (toward.lengthSq() > 1e-12) person.asks.add({ shift: toward.setLength(short * share) });
  }
  // The standing lever leaves a residual on hip-high grips (hands.test.ts).
  const correction = low ? Math.max(0, shoulder.distanceTo(hand) - reach) / (proportions.shoulderHeight - proportions.hipHeight) : 0;
  // (the bow exhausted, the knees close the reach it leaves unmet: below the hips by a quarter thigh, past what the load lets it bow;
  // hip-high, past its most — or, for a load to take (`mass`), what the arm held out still falls short less what the bow left will bring,
  // so a short-armed body is not left short. A load already held goes where its course takes it: the knees do not chase it.)
  const deep = height < proportions.hipHeight - proportions.thigh / 4;
  const span = proportions.shoulderHeight - proportions.hipHeight;
  const overflow = !deep && mass > 0 ? Math.max(0, short - (bowLimit - pitch) * span)
    : Math.max(0, pitch + correction - (deep ? bowLimit : MOST_BOW)) * span;
  if (low && overflow > 0) person.asks.add({ lower: Math.min(squatOf(proportions), crouched + lower + overflow) * share });
  person.asks.add({ bow: Math.max(0, Math.min(bowLimit, bow + correction) * share) });
}

/** Downward gaze recruits the same bow solver once neck and eye declination run out. */
export function gazeAsks(person: Person, pose: ReadonlyPose, point: Readonly<Vector3>) {
  twistToward(person, pose, point);
  const proportions = person.proportions;
  const hips = pose.position(0);
  const distance = Math.hypot(point.x - hips.x, point.z - hips.z);
  const neck = NECK_PITCH * Math.PI / 180;
  // Standing eye position with the neck at its comfortable downward stop. Its forward
  // sweep matters for nearby targets: measuring pitch at the upright eyes misses those.
  const trunk = proportions.eyeHeight - proportions.hipHeight - proportions.offsets.head.y - proportions.eyes.y;
  const eyeUp = trunk + proportions.offsets.head.y * Math.cos(neck / 2) + proportions.eyes.y * Math.cos(neck) - proportions.eyes.z * Math.sin(neck);
  const eyeAhead = proportions.offsets.head.y * Math.sin(neck / 2) + proportions.eyes.y * Math.sin(neck) + proportions.eyes.z * Math.cos(neck);
  const needed = Math.max(0, Math.atan2(eyeUp - (point.y - hips.y), distance - eyeAhead) - neck - person.gazer.range.down);
  const bow = Math.max(0, Math.min(needed, MOST_BOW));
  person.asks.add({ bow });
}
const _lowered = new Vector3(), _station = new Vector3(), _upright = new Vector3(), _v = new Vector3(), _forward = new Vector3(), _left = new Vector3();
