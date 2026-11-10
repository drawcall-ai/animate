// How low and bowed a person goes: the squat its knees allow, how a bow tips its pelvis, and the posture that brings its shoulders or
// eyes down toward a target.
import { MathUtils, type Vector3 } from 'three';
import { TRUNK_PITCH } from '../anatomy/ranges';
import { clamp, lerp } from '../../kernel/math';
import { DEFAULT_HEIGHT, proportionsFor, type Proportions } from '../anatomy/proportions';

/** how far the pelvis goes up for a body asked onto its toes, at most (m, default body) */
export const TIPTOE = 0.07;
/** of a bow, the share the hips take (the pelvis tipping forward), the lower back the rest; arched back, the pelvis tips back by that
 * share up to `ARCHED` (rad), the spine extending the rest (tuned: the hips keep the range a walk's trailing leg extends into — tipped
 * 0.15 back, a walk arched 0.25 slides its planted feet) */
const HINGE = 0.6, ARCHED = 0.08;
/** how far the knees let the pelvis down at most (m): a squat, the hip joints over the ankles, the knees folded as far as the default
 * body's let its pelvis down 0.38 of its height (tuned; 154°, a degree short of their range) — `FOLD`, the cosine between thigh and shin */
export const squatOf = (proportions: Proportions) => proportions.legLength - Math.sqrt(proportions.thigh ** 2 + proportions.shin ** 2 - 2 * proportions.thigh * proportions.shin * FOLD);
const FOLD = (({ thigh, shin, legLength }) => {
  const squatted = legLength - 0.38 * DEFAULT_HEIGHT;
  return (thigh ** 2 + shin ** 2 - squatted ** 2) / (2 * thigh * shin);
})(proportionsFor(DEFAULT_HEIGHT));

/** Recalled staging: tuck the pelvis under in a deep squat, leaving hip flexion for the knees; the lumbar and thoracic joints take the bow. */
const hingeOf = (proportions: Proportions, lower: number) => lerp(HINGE, -0.2, MathUtils.smoothstep(lower, 0, squatOf(proportions)));
/** how far (rad, + forward) the pelvis tips for a bow of `bow` let down `lower` (m) */
export const pelvisTilt = (proportions: Proportions, lower: number, bow: number) => bow < 0
  ? Math.max(hingeOf(proportions, lower) * bow, -ARCHED)
  : Math.max(hingeOf(proportions, lower) * bow, bow - TRUNK_PITCH * Math.PI / 180);

/** Shoulder height at a given squat and bow, using the articulated trunk rather than a single lever. */
export function shoulderHeight(proportions: Proportions, lower: number, bow: number): number {
  const tilt = pelvisTilt(proportions, lower, bow), offsets = proportions.offsets;
  const height = (offset: Vector3, pitch: number) => offset.y * Math.cos(pitch) - offset.z * Math.sin(pitch);
  return proportions.hipHeight - lower + height(offsets.spine, tilt) + height(offsets.chest, (tilt + bow) / 2)
    + height(offsets.leftShoulder, bow) + height(offsets.leftUpperArm, bow);
}

/** how far (m, + ahead) a bow of `bow` let down `lower` (m) brings the shoulder joint, or the eyes, ahead of the hip joint off where they
 * stand upright, using the articulated trunk: squatting, the pelvis tucks under and the back takes the bow from higher up (`hingeOf`) */
export function bowAhead(proportions: Proportions, lower: number, bow: number, upper: 'shoulder' | 'eyes'): number {
  const tilt = pelvisTilt(proportions, lower, bow), offsets = proportions.offsets;
  const ahead = (offset: Vector3, pitch: number) => offset.y * Math.sin(pitch) + offset.z * (Math.cos(pitch) - 1);
  const top = upper === 'shoulder' ? ahead(offsets.leftShoulder, bow) + ahead(offsets.leftUpperArm, bow)
    : ahead(offsets.neck, bow) + ahead(offsets.head, bow) + ahead(proportions.eyes, bow);
  return ahead(offsets.spine, tilt) + ahead(offsets.chest, (tilt + bow) / 2) + top - ahead(offsets.leftUpperLeg, tilt);
}

/** Posture needed to bring a shoulder within hand reach. */
export function handLowering(proportions: Proportions, request: { ahead: number; lateral: number; height: number; reach: number; bowLimit: number }): { lower: number; bow: number } {
  const { ahead, lateral, height, reach, bowLimit } = request;
  const lever = bowLever(proportions, proportions.shoulderHeight);
  const plane = Math.sqrt(Math.max(0, reach ** 2 - lateral ** 2));
  const up = height - proportions.shoulderHeight + lever;
  const distance = Math.hypot(ahead, up);
  const angle = distance > 0 ? Math.acos(clamp((distance ** 2 + lever ** 2 - plane ** 2) / (2 * distance * lever), -1, 1)) : Math.PI;
  // A reachable high forward target also recruits the shoulder. Beyond that arc, rise first;
  // bowing toward an unreachable overhead target lowers the shoulder and chases the deficit,
  // and toward one out of reach to the side brings it no nearer: the turn and the step do.
  const bow = plane > 0 && (height < proportions.shoulderHeight || distance < lever + plane)
    ? clamp(Math.atan2(ahead, up) - angle, 0, bowLimit) : 0;
  // A sideways approach is closed by steps and trunk turns, rather than a squat.
  const across = Math.min(Math.hypot(ahead - lever * Math.sin(bow), lateral), Math.max(0.5 * proportions.armLength, proportions.shoulderHeight - height));
  const below = Math.sqrt(Math.max(0, reach ** 2 - across ** 2));
  const drop = height > proportions.shoulderHeight
    ? Math.min(0, proportions.shoulderHeight + below - height)
    : Math.max(lever * (1 - Math.cos(bow)), proportions.shoulderHeight - height - below);
  return lowered(proportions, lever, drop, bow);
}

/** Posture needed to lower the eyes toward a target. */
export function lowering(proportions: Proportions, request: { drop: number; ahead: number; height: number }): { lower: number; bow: number } {
  const { drop, ahead, height } = request;
  const lever = bowLever(proportions, height);
  const bow = Math.min(Math.asin(clamp(ahead / lever, 0, 1)), Math.acos(1 - clamp(drop / lever, 0, 1)));
  return lowered(proportions, lever, drop, bow);
}

function lowered(proportions: Proportions, lever: number, drop: number, aheadBow: number) {
  const deepBow = Math.acos(1 - clamp((drop - squatOf(proportions)) / lever, 0, 1));
  // A small vertical reach recruits bow before the knees reach their deep-squat reserve.
  const bow = Math.min(MOST_BOW, Math.max(aheadBow, deepBow, 0.05 * MathUtils.smoothstep(drop, 0, squatOf(proportions))));
  const lower = clamp(drop - lever * (1 - Math.cos(bow)), 0, squatOf(proportions));
  // Discard the sub-ulp residual from inverse trig followed by its forward projection.
  return { lower: drop < 0 ? Math.max(drop, -TIPTOE * proportions.scale) : lower <= Number.EPSILON * proportions.height ? 0 : lower, bow };
}

export const bowLever = (proportions: Proportions, height: number) => 0.8 * (height - proportions.hipHeight);
// Tuned comfortable bow ceiling, independent of the neck joint range.
export const MOST_BOW = 60 * Math.PI / 180;
