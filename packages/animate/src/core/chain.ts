import { Quaternion, Vector3 } from 'three';
import { clampRotation } from './limits';
import type { Pose } from './pose';
import type { Skeleton } from './skeleton';

/** Where a chain is asked to go (world). */
export interface ChainGoal {
  /** the tip bone's origin and, if given, rotation */
  tip: { position: Vector3; quaternion?: Quaternion };
  /** the chain's first joint: the whole body is moved (its root position) to put it there first */
  root?: Vector3;
  /** a point the middle joint of a two-segment chain bends toward (default: it bends as it is bent) */
  pole?: Vector3;
}

/** the iterations of the generic solver at most, and the tip's distance (m) it stops at */
const ITERATIONS = 64;
const TOLERANCE = 1e-7;

/**
 * Solves the skeleton's chain named `chain` for `goal` and writes the rotations of its bones
 * into `frame.current` (with `weight`: blended from what is there). The tip goes to the goal's
 * position as far as the chain reaches (straight toward it when it is out of reach) and turns to
 * its rotation; every bone stays within its limit. A two-segment chain (a limb) is solved
 * analytically, bending in the plane of its pole; a longer or shorter one by cyclic coordinate
 * descent.
 */
export function solveChain(frame: { current: Pose }, chain: string, goal: ChainGoal, weight = 1): void {
  const pose = frame.current;
  const { skeleton } = pose;
  const bones = skeleton.chain(chain);
  if (bones.length > _joints.length) throw new Error(`chain "${chain}" has ${bones.length} bones, more than ${_joints.length}`);
  if (goal.root) pose.setRoot(_v.copy(goal.root).sub(pose.position(bones[0])).add(pose.position(0)), weight);
  const solved = bones.map((b) => pose.local(b).clone());
  const parent = skeleton.bones[bones[0]].parent;
  const base = new Quaternion();
  if (parent >= 0) base.copy(pose.rotation(parent));
  const start = pose.position(bones[0]).clone();
  const solving: Solving = { skeleton, bones, base, start, local: solved };
  if (bones.length === 3) twoBone(solving, goal.tip.position, goal.pole);
  else {
    if (goal.pole) throw new Error(`chain "${chain}" has ${bones.length - 1} segments: a pole bends only a two-segment chain`);
    descend(solving, goal.tip.position);
  }
  const { quaternion } = goal.tip;
  if (quaternion) {
    const tip = bones.length - 1;
    worlds(solving, _rotations);
    setLimited(skeleton, bones[tip], solved[tip].copy(_rotations[tip - 1]).invert().multiply(quaternion));
  }
  bones.forEach((b, k) => pose.setLocal(b, solved[k], weight));
}

/** a chain being solved: its bones' rotations in their parents' frames (`local`), under a first joint at `start` whose parent is turned `base` */
interface Solving {
  skeleton: Skeleton;
  bones: readonly number[];
  base: Quaternion;
  start: Vector3;
  local: Quaternion[];
}

/** a limb: bend the middle joint to the distance, swing the whole onto the target, then turn it about that line to the pole */
function twoBone(c: Solving, target: Vector3, pole: Vector3 | undefined) {
  const { skeleton, bones, local, start } = c;
  joints(c, _joints);
  const [j0, j1, j2] = _joints;
  const r0 = _rotations[0];
  const upper = _a.subVectors(j1, j0);
  const lower = _b.subVectors(j2, j1);
  const a = upper.length();
  const b = lower.length();
  const d = Math.min(a + b, Math.max(Math.abs(a - b), target.distanceTo(start)));
  // the middle joint's interior angle now and wanted (law of cosines), bent about the axis it is bent about now
  const now = Math.acos(clampUnit(-upper.dot(lower) / (a * b)));
  const wanted = Math.acos(clampUnit((a * a + b * b - d * d) / (2 * a * b)));
  const axis = _axis.crossVectors(upper, lower);
  if (axis.lengthSq() < 1e-12 * a * a * b * b) axis.crossVectors(upper, pole ? _c.subVectors(pole, j0) : perpendicular(upper, _c));
  if (axis.lengthSq() < 1e-24) axis.copy(perpendicular(upper, _c));
  axis.normalize();
  const r1 = _rotations[1].premultiply(_q.setFromAxisAngle(axis, now - wanted));
  const tip = _c.copy(skeleton.bones[bones[2]].offset).applyQuaternion(r1).add(j1).sub(j0);
  // swing onto the target
  const swing = _q.setFromUnitVectors(tip.normalize(), _d.subVectors(target, j0).normalize());
  r0.premultiply(swing);
  r1.premultiply(swing);
  if (pole) {
    // turn about the line to the target until the middle joint is toward the pole
    const line = _d;
    const mid = _a.copy(skeleton.bones[bones[1]].offset).applyQuaternion(r0);
    const toPole = _b.subVectors(pole, j0);
    mid.addScaledVector(line, -mid.dot(line));
    toPole.addScaledVector(line, -toPole.dot(line));
    if (mid.lengthSq() > 1e-12 && toPole.lengthSq() > 1e-12) {
      const angle = Math.atan2(_c.crossVectors(mid, toPole).dot(line), mid.dot(toPole));
      _q.setFromAxisAngle(line, angle);
      r0.premultiply(_q);
      r1.premultiply(_q);
    }
  }
  setLimited(skeleton, bones[0], local[0].copy(c.base).invert().multiply(r0));
  r0.copy(c.base).multiply(local[0]);
  setLimited(skeleton, bones[1], local[1].copy(r0).invert().multiply(r1));
}

/** cyclic coordinate descent: from the last joint to the first, each turned to point the tip at the target, within its limit */
function descend(c: Solving, target: Vector3) {
  const { skeleton, bones, local } = c;
  const last = bones.length - 1;
  for (let n = 0; n < ITERATIONS; n++) {
    for (let k = last - 1; k >= 0; k--) {
      joints(c, _joints);
      const from = _a.subVectors(_joints[last], _joints[k]);
      const to = _b.subVectors(target, _joints[k]);
      if (from.lengthSq() < 1e-18 || to.lengthSq() < 1e-18) continue;
      _q.setFromUnitVectors(from.normalize(), to.normalize());
      const above = k === 0 ? c.base : _rotations[k - 1];
      // the turn in the world, as the bone's rotation in its parent's frame
      setLimited(skeleton, bones[k], local[k].premultiply(_r.copy(above).invert().multiply(_q).multiply(above)));
    }
    joints(c, _joints);
    if (_joints[last].distanceToSquared(target) < TOLERANCE * TOLERANCE) return;
  }
}

/** each bone's world rotation in the chain being solved */
function worlds(c: Solving, out: Quaternion[]) {
  c.local.forEach((q, k) => out[k].copy(k === 0 ? c.base : out[k - 1]).multiply(q));
}

/** each joint's world position in the chain being solved (and each bone's world rotation, into `_rotations`) */
function joints(c: Solving, out: Vector3[]) {
  worlds(c, _rotations);
  out[0].copy(c.start);
  for (let k = 1; k < c.bones.length; k++) out[k].copy(c.skeleton.bones[c.bones[k]].offset).applyQuaternion(_rotations[k - 1]).add(out[k - 1]);
}

function setLimited(skeleton: Skeleton, bone: number, q: Quaternion) {
  const limit = skeleton.limits[bone];
  if (limit) clampRotation(q, limit);
}

const clampUnit = (x: number) => Math.min(1, Math.max(-1, x));

/** some direction perpendicular to `v` */
function perpendicular(v: Vector3, out: Vector3): Vector3 {
  return Math.abs(v.x) < 0.9 * v.length() ? out.set(1, 0, 0).cross(v) : out.set(0, 1, 0).cross(v);
}

const _joints = Array.from({ length: 16 }, () => new Vector3());
const _rotations = Array.from({ length: 16 }, () => new Quaternion());
const _v = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _d = new Vector3();
const _axis = new Vector3();
const _q = new Quaternion();
const _r = new Quaternion();
