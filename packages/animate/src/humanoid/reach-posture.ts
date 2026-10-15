import { Vector3 } from 'three';
import type { Frame } from '../core/body';
import type { ReadonlyPose } from '../core/pose';
import { clamp, forwardOf, smoothstep, wrapAngle } from '../core/math';
import { bowLever, lowering } from './balance/posture';
import { INDEX, type Side } from './bones';
import type { Humanoid } from './humanoid';
import { NECK_PITCH } from './profile/limits';
import { ARM_REACH } from './arms';

/** Tuned trunk recruitment: bearing beyond 0.75 rad recruits 60%, capped at 20°, keeps reaches
 * within lumbar rotation and leaves the neck to finish an over-shoulder look. Requests
 * combine by magnitude, so task order cannot cancel a stronger turn. */
export function twistToward<W>(h: Humanoid<W>, pose: ReadonlyPose, point: Readonly<Vector3>, share = 1) {
  const hips = pose.position(0);
  const bearing = wrapAngle(Math.atan2(point.x - hips.x, point.z - hips.z) - h.gait.facing);
  // A bearing near the vertical axis is ill-conditioned: suppress its turn inside
  // the shoulder span, blending to full recruitment at an arm's horizontal reach.
  const distance = Math.hypot(point.x - hips.x, point.z - hips.z);
  const turn = Math.min(Math.PI / 9, 0.6 * Math.max(0, Math.abs(bearing) - 0.75));
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
  const from = _v.copy(hand).sub(f.current.position(0));
  const ahead = from.dot(forwardOf(h.gait.facing, _forward));
  const lateral = from.dot(_left.set(Math.cos(h.gait.facing), 0, -Math.sin(h.gait.facing))) - (side === 'left' ? 1 : -1) * p.shoulderHalfWidth;
  // Tuned 2% reserve for the articulated shoulder arc: its single lever slightly
  // overestimates the reach available when the pelvis tucks in a deep squat.
  const reach = 0.98 * ARM_REACH * p.armLength;
  const plane = Math.sqrt(Math.max(0, reach ** 2 - lateral ** 2));
  const lever = bowLever(p, p.shoulderHeight);
  const up = hand.y - p.shoulderHeight + lever;
  const distance = Math.hypot(ahead, up);
  // Intersect the shoulder's bow arc with the arm's reach circle. Measuring the
  // drop at the upright shoulder asks the knees to do work the forward sweep supplies.
  const angle = distance > 0 ? Math.acos(clamp((distance ** 2 + lever ** 2 - plane ** 2) / (2 * distance * lever), -1, 1)) : Math.PI;
  const bend = hand.y < p.shoulderHeight ? clamp(Math.atan2(ahead, up) - angle, 0, NECK_PITCH * Math.PI / 180) : 0;
  const sweep = lever * Math.sin(bend);
  // Retain the recalled half-arm horizontal cap for vertical recruitment:
  // steps and trunk turns, rather than a squat, close a sideways approach.
  const across = Math.min(Math.hypot(ahead - sweep, lateral), Math.max(0.5 * p.armLength, p.shoulderHeight - hand.y));
  const below = Math.sqrt(Math.max(0, reach ** 2 - across ** 2));
  const drop = Math.max(lever * (1 - Math.cos(bend)), p.shoulderHeight - hand.y - below);
  const { lower, bow } = lowering(p, { height: p.shoulderHeight, drop: hand.y > p.shoulderHeight ? Math.min(0, p.shoulderHeight + below - hand.y) : drop, ahead: sweep });
  if (lower > 0) h.asks.lower = Math.max(h.asks.lower, lower * share);
  else if (lower < 0 && share > 0 && h.asks.lower <= 0) h.asks.lower = Math.min(h.asks.lower, lower * share);
  h.asks.bow = Math.max(h.asks.bow, bow * share);
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
  const above = p.eyeHeight - p.hipHeight;
  const lever = bowLever(p, p.eyeHeight);
  const { bow } = lowering(p, { height: p.eyeHeight, drop: above * (1 - Math.cos(needed)), ahead: lever * Math.sin(needed) });
  h.asks.bow = Math.max(h.asks.bow, bow);
}
const _v = new Vector3();
const _forward = new Vector3();
const _left = new Vector3();
