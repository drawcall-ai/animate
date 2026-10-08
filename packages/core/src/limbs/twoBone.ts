import { Quaternion, Vector3 } from 'three';
import { clamp } from '../math';
import { REST_HINGE, type ChildBone, type LimbBone } from '../pose/bones';
import type { Limb } from '../pose/frames';
import { beyondRange } from '../pose/limits';
import { hingeFrame, splitTwist } from '../pose/rotations';

const _d = new Vector3();

/**
 * Analytic two-bone IK (law of cosines) from `limb.root` toward `target`. The middle
 * joint bends toward `pole` (a direction, projected perpendicular to root→target, written
 * to `limb.bend`). Writes the middle and end joints.
 */
export function solveTwoBone(limb: Limb, target: Vector3, len1: number, len2: number, pole: Vector3, maxExtension = 0.999, softness = 0) {
  const { root, bend } = limb;
  _d.subVectors(target, root);
  const raw = _d.length();
  const maxLen = (len1 + len2) * maxExtension;
  const minLen = Math.abs(len1 - len2) + 1e-4;
  // soft IK: ease into full extension instead of snapping straight (the knee/elbow
  // angle is ultra-sensitive near straight, so a hard clamp reads as jitter)
  const soft = softness * (len1 + len2);
  let dist = raw;
  if (soft > 0 && raw > maxLen - soft) dist = maxLen - soft + soft * (1 - Math.exp(-(raw - (maxLen - soft)) / soft));
  dist = clamp(dist, minLen, maxLen);
  if (raw < 1e-6) _d.set(0, -1, 0);
  else _d.divideScalar(raw);

  limb.end.copy(root).addScaledVector(_d, dist);

  const cosA = clamp((len1 * len1 + dist * dist - len2 * len2) / (2 * len1 * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);

  bend.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (bend.lengthSq() < 1e-10) {
    // pole parallel to the limb: choose any perpendicular
    bend.set(0, 0, 1).addScaledVector(_d, -_d.z);
    if (bend.lengthSq() < 1e-10) bend.set(1, 0, 0).addScaledVector(_d, -_d.x);
  }
  bend.normalize();

  limb.mid.copy(root).addScaledVector(_d, cosA * len1).addScaledVector(bend, sinA * len1);
}

/** A limb kept in its joints' ranges (`solveInRange`): the chain and its bones, what turns them besides the solve, and its swivel. */
export interface LimbJoints {
  limb: Limb;
  len1: number;
  len2: number;
  maxExtension: number;
  softness: number;
  upper: LimbBone;
  lower: LimbBone;
  end: ChildBone;
  /** the upper and lower bones' rest directions (the lower bone's and the end's rest offsets) */
  upperRest: Vector3;
  lowerRest: Vector3;
  /** the lower bone's share of the end's twist (`splitTwist`) */
  share: number;
  /** the root's parent's world rotation */
  parent: Quaternion;
  /** the end's world rotation, `weight` of the way from the lower bone's (0: it continues it) */
  turn: Quaternion;
  weight: number;
  /** the swivel off the pole last solved (rad, about root→end) */
  swivel: number;
}

/**
 * The swivel's search: how much a radian of it off the pole costs, and a radian of the end
 * beyond its range (in radians of the upper and lower bones' beyond theirs: what the end cannot
 * turn to it misses, the limb's reach it keeps); how fast it moves from where it was (rad/s), how
 * much better (rad) a swivel elsewhere must be to jump to it, sampled in how many steps a side.
 */
const SWIVEL = { cost: 0.1, end: 0.5, speed: 6, jump: 0.35, steps: 12 };

/**
 * `solveTwoBone` toward `target`, the middle joint swivelled about root→target off `pole` as
 * little as keeps the limb's joints in their ranges (limits.ts), or as far into them as they
 * go: analytic IK with joint limits over the swivel angle (Tolani, Goswami & Badler 2000),
 * searched (Kallmann 2008) — near where it was over `dt` (s; 0: anywhere), elsewhere only if
 * much better.
 */
export function solveInRange(j: LimbJoints, target: Vector3, pole: Vector3, dt: number) {
  const { limb } = j;
  solveTwoBone(limb, target, j.len1, j.len2, pole, j.maxExtension, j.softness);
  const e0 = beyond(j);
  if (e0 <= 0 && (j.swivel === 0 || dt <= 0)) {
    j.swivel = 0;
    return;
  }
  _target.copy(target);
  // the swivel's frame: the bend toward the pole and its quarter turn about the limb's line
  _b0.copy(limb.bend);
  _b1.subVectors(limb.end, limb.root).normalize().cross(_b0);
  // near where it was, within how far it turns in a tick; anywhere sampled, if much better
  let a = refine(j, dt > 0 ? j.swivel : 0, dt > 0 ? SWIVEL.speed * dt : Math.PI);
  let c = cost(j, a);
  if (c > SWIVEL.jump) {
    const step = Math.PI / SWIVEL.steps;
    const from = a;
    for (let i = -SWIVEL.steps; i < SWIVEL.steps; i++) {
      const ci = cost(j, i * step);
      if (ci < c - SWIVEL.jump) {
        a = i * step;
        c = ci;
      }
    }
    if (a !== from) a = refine(j, a, step);
  }
  j.swivel = a;
  cost(j, a);
}

/** the swivel of least cost within `reach` of `a` (rad; by thirds) */
function refine(j: LimbJoints, a: number, reach: number): number {
  let lo = a - reach;
  let hi = a + reach;
  for (let i = 0; i < 8; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (cost(j, m1) < cost(j, m2)) hi = m2;
    else lo = m1;
  }
  return (lo + hi) / 2;
}

/** the limb solved toward `_target` swivelled `a` off the pole: how far beyond range, and off the pole */
function cost(j: LimbJoints, a: number): number {
  _pole.copy(_b0).multiplyScalar(Math.cos(a)).addScaledVector(_b1, Math.sin(a));
  solveTwoBone(j.limb, _target, j.len1, j.len2, _pole, j.maxExtension, j.softness);
  return beyond(j) + SWIVEL.cost * Math.abs(a);
}

/** how far the limb's joints are beyond their ranges, summed (rad) */
function beyond(j: LimbJoints): number {
  const { limb } = j;
  const hinge = _h.subVectors(limb.end, limb.root).cross(limb.bend).normalize();
  hingeFrame(_d.subVectors(limb.mid, limb.root).normalize(), hinge, j.upperRest, REST_HINGE[j.upper], _upper);
  hingeFrame(_d.subVectors(limb.end, limb.mid).normalize(), hinge, j.lowerRest, REST_HINGE[j.lower], _lower);
  _end.copy(_lower);
  if (j.weight > 0) _end.slerp(j.turn, j.weight);
  _endL.copy(_lower).invert().multiply(_end);
  _lowerL.copy(_upper).invert().multiply(_lower);
  _upperL.copy(j.parent).invert().multiply(_upper);
  splitTwist(_lowerL, _endL, j.lowerRest, j.share);
  return beyondRange(j.upper, _upperL) + beyondRange(j.lower, _lowerL) + SWIVEL.end * beyondRange(j.end, _endL);
}

const _target = new Vector3();
const _b0 = new Vector3();
const _b1 = new Vector3();
const _pole = new Vector3();
const _h = new Vector3();
const _upper = new Quaternion();
const _lower = new Quaternion();
const _end = new Quaternion();
const _upperL = new Quaternion();
const _lowerL = new Quaternion();
const _endL = new Quaternion();

