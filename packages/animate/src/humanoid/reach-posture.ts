import { Vector3 } from 'three';
import type { Frame } from '../core/body';
import type { ReadonlyPose } from '../core/pose';
import { forwardOf, smoothstep, wrapAngle } from '../core/math';
import { handLowering, MOST_BOW, SQUAT } from './balance/posture';
import { INDEX, type Side } from './bones';
import type { Humanoid } from './humanoid';
import { NECK_PITCH } from './profile/limits';
import { ARM_REACH } from './arms';
import { heldMass } from './hands/grips';
import { loadFactor } from '../core/load';

/** Tuned trunk recruitment: bearing beyond 0.75 rad recruits 60%, capped at 20°, keeps reaches
 * within lumbar rotation and leaves the neck to finish an over-shoulder look. Requests
 * combine by magnitude, so task order cannot cancel a stronger turn. */
const TWIST = { start: 0.75, share: 0.6, most: Math.PI / 9 };
export function twistToward<W>(h: Humanoid<W>, pose: ReadonlyPose, point: Readonly<Vector3>, share = 1) {
  const hips = pose.position(0);
  const bearing = wrapAngle(Math.atan2(point.x - hips.x, point.z - hips.z) - h.locomotion.facing);
  const distance = Math.hypot(point.x - hips.x, point.z - hips.z);
  share *= smoothstep(h.proportions.shoulderHalfWidth, h.proportions.armLength, distance);
  const turn = Math.min(TWIST.most, TWIST.share * Math.max(0, Math.abs(bearing) - TWIST.start));
  const twist = Math.sign(bearing) * turn * share;
  if (Math.abs(twist) > Math.abs(h.asks.twist)) h.asks.twist = twist;
}

/** Standing reach requests, closed against the solved shoulder and chest. */
export function bringShoulder<W>(h: Humanoid<W>, f: Frame<W>, side: Side, hand: Readonly<Vector3>, share = 1, mass = 0) {
  const p = h.proportions;
  const factor = loadFactor(Math.max(mass, heldMass(h)));
  const low = hand.y < p.hipHeight;
  // Tuned load strategy, not an empirical dose-response: heavier low reaches trade bow for knees.
  const bowLimit = low ? MOST_BOW / factor ** 2 : MOST_BOW;
  if (low) h.asks.bowLimit = Math.min(h.asks.bowLimit, bowLimit);
  // Preserve the landing leg's clearance; loaded knees prepare as root travel ends.
  if (low && factor > 1 && h.locomotion.moving) return;
  // research-contact §4 rule 3 [C]: ≥10–15° knees under load. Tuned 30° ceiling
  // on each leg segment (knee flexion is their sum), scaled by the same load law.
  if (low) h.asks.lower = Math.max(h.asks.lower, p.legLength * (1 - Math.cos(Math.PI / 6 * (1 - 1 / factor ** 2))) * share);
  const shoulder = f.current.position(INDEX[`${side}UpperArm`]);
  // Tuned 6 cm gait allowance: clavicle motion absorbs small stride deficits.
  const allowance = h.locomotion.moving ? 0.06 * p.scale : 0;
  const deficit = shoulder.distanceTo(hand) - p.armLength - allowance;
  if (h.locomotion.moving && hand.y < shoulder.y && deficit <= 0 && !(low && mass > 0)) return;
  // A bow moves the pelvis back. Every reach is planned from the support station,
  // so that counter-shift cannot make a shoulder ask for still more bow.
  const from = _v.copy(hand).sub(f.prev.com(_station));
  const ahead = from.dot(forwardOf(h.locomotion.facing, _forward));
  const lateral = from.dot(_left.set(Math.cos(h.locomotion.facing), 0, -Math.sin(h.locomotion.facing))) - (side === 'left' ? 1 : -1) * p.shoulderHalfWidth;
  // Tuned 2% reserve for the articulated shoulder arc: its single lever slightly
  // overestimates the reach available when the pelvis tucks in a deep squat.
  const reach = 0.98 * ARM_REACH * p.armLength;
  const { lower, bow } = handLowering(p, { ahead, lateral, height: hand.y, reach, bowLimit });
  if (lower > 0) h.asks.lower = Math.max(h.asks.lower, lower * share);
  else if (lower < 0 && share > 0 && h.asks.lower <= 0) h.asks.lower = Math.min(h.asks.lower, lower * share);
  // The standing lever leaves a residual on hip-high grips (hands.test.ts).
  const correction = low ? Math.max(0, shoulder.distanceTo(hand) - reach) / (p.shoulderHeight - p.hipHeight) : 0;
  // Once bow is exhausted, close its unmet reach with the knees rather than
  // requesting the same saturated back angle forever.
  const pitch = Math.asin(-_forward.set(0, 0, 1).applyQuaternion(f.current.rotation(INDEX.chest)).y);
  const overflow = Math.max(0, pitch + correction - MOST_BOW) * (p.shoulderHeight - p.hipHeight);
  if (low && overflow > 0) h.asks.lower = Math.max(h.asks.lower, Math.min(SQUAT * p.height, lower + overflow) * share);
  h.asks.bow = Math.max(h.asks.bow, Math.min(bowLimit, bow + correction) * share);
}

/** Downward gaze recruits the same bow solver once neck and eye declination run out. */
export function gazeAsks<W>(h: Humanoid<W>, pose: ReadonlyPose, point: Readonly<Vector3>) {
  twistToward(h, pose, point);
  const p = h.proportions;
  const hips = pose.position(0);
  const distance = Math.hypot(point.x - hips.x, point.z - hips.z);
  const neck = NECK_PITCH * Math.PI / 180;
  // Standing eye position with the neck at its comfortable downward stop. Its forward
  // sweep matters for nearby targets: measuring pitch at the upright eyes misses those.
  const trunk = p.eyeHeight - p.hipHeight - p.offsets.head.y - p.eyes.y;
  const eyeUp = trunk + p.offsets.head.y * Math.cos(neck / 2) + p.eyes.y * Math.cos(neck) - p.eyes.z * Math.sin(neck);
  const eyeAhead = p.offsets.head.y * Math.sin(neck / 2) + p.eyes.y * Math.sin(neck) + p.eyes.z * Math.cos(neck);
  const needed = Math.max(0, Math.atan2(eyeUp - (point.y - hips.y), distance - eyeAhead) - neck - h.gazer.range.down);
  const bow = Math.max(0, Math.min(needed, MOST_BOW));
  h.asks.bow = Math.max(h.asks.bow, bow);
}
const _station = new Vector3();
const _v = new Vector3();
const _forward = new Vector3();
const _left = new Vector3();
