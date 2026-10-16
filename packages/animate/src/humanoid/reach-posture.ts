import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../core/body';
import type { ReadonlyPose } from '../core/pose';
import { forwardOf, smoothstep, wrapAngle } from '../core/math';
import { handLowering, MOST_BOW } from './balance/posture';
import { INDEX, type Side } from './bones';
import type { Humanoid } from './humanoid';
import { NECK_EXTENSION, NECK_PITCH } from './profile/limits';
import { ARM_REACH } from './arms';

/** Tuned trunk recruitment: bearing beyond 0.75 rad recruits 60%, capped at 20°, keeps reaches
 * within lumbar rotation and leaves the neck to finish an over-shoulder look. Requests
 * combine by magnitude, so task order cannot cancel a stronger turn. */
const TWIST = { start: 0.75, share: 0.6, most: Math.PI / 9 };
export function twistToward<W>(h: Humanoid<W>, pose: ReadonlyPose, point: Readonly<Vector3>, share = 1) {
  askTwist(h, pose, point, TWIST.start, share);
}

function askTwist<W>(h: Humanoid<W>, pose: ReadonlyPose, point: Readonly<Vector3>, start: number, share = 1) {
  const hips = pose.position(0);
  const bearing = wrapAngle(Math.atan2(point.x - hips.x, point.z - hips.z) - h.gait.facing);
  // A bearing near the vertical axis is ill-conditioned: suppress its turn inside
  // the shoulder span, blending to full recruitment at an arm's horizontal reach.
  const distance = Math.hypot(point.x - hips.x, point.z - hips.z);
  const turn = Math.min(TWIST.most, TWIST.share * Math.max(0, Math.abs(bearing) - start));
  const twist = Math.sign(bearing) * turn * smoothstep(h.proportions.shoulderHalfWidth, h.proportions.armLength, distance) * share;
  if (Math.abs(twist) > Math.abs(h.asks.twist)) h.asks.twist = twist;
}

/** Reach requests use standing geometry, so a solved bow never chases itself. */
export function bringShoulder<W>(h: Humanoid<W>, f: Frame<W>, side: Side, hand: Readonly<Vector3>, share = 1) {
  const p = h.proportions;
  const shoulder = f.current.position(INDEX[`${side}UpperArm`]);
  // Tuned 6 cm gait allowance: clavicle motion absorbs small stride deficits.
  const allowance = h.gait.moving ? 0.06 * p.scale : 0;
  const deficit = shoulder.distanceTo(hand) - p.armLength - allowance;
  if (h.gait.moving && hand.y < shoulder.y && deficit <= 0) return;
  // Below the hips, reach from the support station rather than chase the
  // pelvis's backward counter-shift under a bow. Higher reaches use the pelvis frame.
  const low = hand.y < p.hipHeight;
  const from = _v.copy(hand).sub(low ? f.prev.com(_station) : f.current.position(0));
  const ahead = from.dot(forwardOf(h.gait.facing, _forward));
  const lateral = from.dot(_left.set(Math.cos(h.gait.facing), 0, -Math.sin(h.gait.facing))) - (side === 'left' ? 1 : -1) * p.shoulderHalfWidth;
  // Tuned 2% reserve for the articulated shoulder arc: its single lever slightly
  // overestimates the reach available when the pelvis tucks in a deep squat.
  const reach = 0.98 * ARM_REACH * p.armLength;
  const { lower, bow } = handLowering(p, { ahead, lateral, height: hand.y, reach });
  if (lower > 0) h.asks.lower = Math.max(h.asks.lower, lower * share);
  else if (lower < 0 && share > 0 && h.asks.lower <= 0) h.asks.lower = Math.min(h.asks.lower, lower * share);
  // Close the standing lever approximation against the actual shoulder reach.
  const correction = low ? Math.max(0, shoulder.distanceTo(hand) - reach) / (p.shoulderHeight - p.hipHeight) : 0;
  h.asks.bow = Math.max(h.asks.bow, Math.min(MOST_BOW, bow + correction) * share);
}

/** Downward gaze recruits the same bow solver once neck and eye declination run out. */
export function gazeAsks<W>(h: Humanoid<W>, pose: ReadonlyPose, point: Readonly<Vector3>) {
  // Pitch and yaw share cervical range. An extended neck has less yaw to
  // spare, so recruit trunk rotation before the usual upright yaw threshold.
  const local = _gaze.copy(point).sub(pose.position(INDEX.neck)).applyQuaternion(_turn.copy(pose.rotation(INDEX.chest)).invert());
  const pitch = Math.atan2(-local.y, Math.hypot(local.x, local.z));
  const used = Math.min(1, (pitch > 0 ? Math.max(0, pitch - h.gazer.range.down) / NECK_PITCH : -pitch / NECK_EXTENSION) * 180 / Math.PI);
  askTwist(h, pose, point, TWIST.start * Math.sqrt(1 - used * used));
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

const _gaze = new Vector3();
const _turn = new Quaternion();
