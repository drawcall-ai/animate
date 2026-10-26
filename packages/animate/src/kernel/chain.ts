import { Matrix4, Quaternion, Vector3 } from 'three';
import { wrapAngle } from './math';
import type { Placement } from './goal';
import { clampRotation, coordinates, coordinatesOf } from './limits';
import type { Pose } from './pose';
import type { Limit, Skeleton } from './skeleton';

/** Where a chain is asked to go (world). */
export interface ChainGoal {
  /** the tip bone's origin and, if given, rotation */
  tip: Placement;
  /**
   * a point the middle joint of a two-segment chain bends toward (default: its bend stays turned
   * as it is now). The limb turns to it at once: move a pole that changes like any goal (`follow`).
   */
  pole?: Vector3;
  /** preferred middle-joint twist about its distal segment (rad); default: half the tip's twist */
  twist?: number;
  /** whether a limb whose limits the pole's side does not fit may swivel off it, or bend the other way, as far as they need (default
   * true); false: it keeps to the pole's side, clamped within them (a re-solve that keeps an elbow where its brakes left it) */
  swivel?: boolean;
}

/** the generic solver's sweeps at most; it stops sooner once a sweep brings the tip no closer than this (m) */
const SWEEPS = 64;
const PROGRESS = 1e-9;
/** how far outside its limits (rad, summed) a solution still fits */
const FITS = 1e-9;
/** the most bones a chain has */
const LONGEST = 16;

/**
 * Solves the skeleton's chain named `chain` for `goal` and writes its bones' rotations into
 * `frame.current` (with `weight`: blended over what is there). The tip goes to the goal's
 * position as far as the chain reaches (straight toward it when it is out of reach) and turns to
 * its rotation; every bone stays within its limit.
 *
 * A two-segment chain (a limb) is solved in closed form: its middle joint bends as a hinge about
 * the axis its limit allows the most swing about (its present bend axis without a limit), the
 * first bone turns the limb onto the goal and toward the pole, then the middle joint aims again
 * from where the first bone's limit left it; the tip's turn about the middle bone is shared
 * between the two. The limb swivels about the line to the goal from the pole's side only as far
 * as the limits need (with a tip rotation, the middle joint's and the tip's too), and far round
 * only for as much of their excess as it is worth (`SWIVEL`). As the middle
 * joint bends as a pure hinge, goals at the corners of its range — its small side play and its
 * twist at once — can be missed by centimetres. Other chains are solved by cyclic coordinate
 * descent.
 */
export function solveChain(frame: { current: Pose }, chain: string, goal: ChainGoal, weight = 1): void {
  const { position: at, quaternion: turned } = goal.tip;
  const finite = (...xs: number[]) => xs.every(Number.isFinite);
  const tipFinite = finite(at.x, at.y, at.z) && (!turned || finite(turned.x, turned.y, turned.z, turned.w));
  const poleFinite = !goal.pole || finite(goal.pole.x, goal.pole.y, goal.pole.z);
  const twistFinite = goal.twist === undefined || finite(goal.twist);
  if (!tipFinite || !poleFinite || !twistFinite) {
    throw new Error(`chain "${chain}": a goal that is not finite`);
  }
  const pose = frame.current;
  const { skeleton } = pose;
  const bones = skeleton.chain(chain);
  if (bones.length > LONGEST) throw new Error(`chain "${chain}" has ${bones.length} bones, more than ${LONGEST}`);
  const parent = skeleton.bones[bones[0]].parent;
  const c: Solving = { skeleton, bones, base: parent >= 0 ? _base.copy(pose.rotation(parent)) : _base.identity(), start: _start.copy(pose.position(bones[0])), local: _local };
  bones.forEach((b, k) => _local[k].copy(pose.local(b)));
  const { position, quaternion } = goal.tip;
  if (bones.length === 3) limb(c, position, goal.pole, quaternion, goal.twist, goal.swivel ?? true);
  else {
    if (goal.twist !== undefined) throw new Error(`chain "${chain}": a preferred twist applies only to a two-segment chain`);
    if (goal.pole) throw new Error(`chain "${chain}" has ${bones.length - 1} segments: a pole bends only a two-segment chain`);
    descend(c, position);
    if (quaternion) {
      const tip = bones.length - 1;
      worlds(c);
      limited(skeleton, bones[tip], _local[tip].copy(_rotations[tip - 1]).invert().multiply(quaternion));
    }
  }
  bones.forEach((b, k) => pose.setLocal(b, _local[k], weight));
}

/** a chain being solved: its bones' rotations in their parents' frames (`local`), under a first joint at `start` whose parent is turned `base` */
interface Solving {
  skeleton: Skeleton;
  bones: readonly number[];
  base: Quaternion;
  start: Vector3;
  local: Quaternion[];
}

/** a limb: its middle joint as a hinge (bent to the distance), its first bone onto the goal and toward the pole, the middle joint aimed again */
function limb(c: Solving, target: Vector3, pole: Vector3 | undefined, quaternion: Quaternion | undefined, twist: number | undefined, swivels: boolean) {
  const { skeleton, bones, local, start } = c;
  const o1 = skeleton.bones[bones[1]].offset;
  const o2 = skeleton.bones[bones[2]].offset;
  const hinge = hingeOf(skeleton.limits[bones[1]], local[1], o1);
  const { axis: h, neutral } = hinge;
  const v = _v.copy(o2).applyQuaternion(neutral);
  // |o1 + R(h, θ) v| = d: with the parts across h, o1⊥ · R(θ) v⊥ = |o1⊥| |v⊥| cos(φ0 + θ)
  const o1a = _a.copy(h).multiplyScalar(o1.dot(h));
  const va = _b.copy(h).multiplyScalar(v.dot(h));
  const o1p = _c.subVectors(o1, o1a);
  const vp = _d.subVectors(v, va);
  const along = o1a.add(va).add(o1p).lengthSq();
  const across = 2 * o1p.length() * vp.length();
  const phi0 = signedAngle(o1p, vp, h);
  const toTarget = _t.subVectors(target, start);
  const d = toTarget.length();
  const turn = across > 1e-12 ? Math.acos(clampUnit((d * d - along - vp.lengthSq()) / across)) : 0;
  const candidates = [wrapAngle(turn - phi0), wrapAngle(-turn - phi0)];
  let bend = nearest(candidates[0], candidates[1], hinge);
  const now = _r.copy(c.base).multiply(local[0]);
  if (d < 1e-12) toTarget.copy(o1).add(v).applyQuaternion(now);
  const T = toTarget.normalize();
  const limits = bones.map((b) => skeleton.limits[b]);
  const a = _axis.copy(o2).normalize();
  const r0 = _r0;
  // (a re-solve that keeps the limb's bend where its brakes left it keeps the middle bone's twist there too, unless asked another: split
  // afresh, a wrist at the edge of its range could take the twist the other way — the forearm turned 25° in one sub-step, and back)
  if (!swivels && twist === undefined) twist = twistAbout(_q2.setFromAxisAngle(h, hinge.now).multiply(neutral).invert().multiply(local[1]), a);

  /** the first bone placed (into `local[0]`, unclamped) for the middle joint bent `bend`: how far the limbs's limits are left out */
  const place = (bend: number) => {
    // the tip (in the first bone's frame) onto the target, the hinge axis toward the pole's side
    const pn = _p.copy(v).applyQuaternion(_q.setFromAxisAngle(h, bend)).add(o1).normalize();
    const hl = _hl.copy(h).addScaledVector(pn, -h.dot(pn)).normalize();
    const n = _n;
    const P = pole ? _pole.subVectors(pole, start) : null;
    if (P && n.crossVectors(T, P).lengthSq() > 1e-12) {
      // the middle joint's side of the line to the tip, as seen along the hinge axis
      const side = Math.sign(o1.dot(_e.crossVectors(hl, pn))) || 1;
      n.normalize().multiplyScalar(side);
    } else n.copy(hl).applyQuaternion(now);
    n.addScaledVector(T, -n.dot(T));
    if (n.lengthSq() < 1e-12) perpendicular(T, n);
    n.normalize();
    const world = _qw.setFromRotationMatrix(_m.makeBasis(T, n, _e.crossVectors(T, n)));
    const own = _ql.setFromRotationMatrix(_m.makeBasis(pn, hl, _e.crossVectors(pn, hl)));
    r0.copy(world).multiply(own.invert());
    // swivelled about the line to the target as little as the limits need: the first joint's, and
    // with a tip rotation the middle joint's and the tip's as they would share its twist
    const bent = _bent.setFromAxisAngle(h, bend).multiply(neutral);
    const swivelled = (angle: number) => local[0].copy(c.base).invert().multiply(_q.setFromAxisAngle(T, angle)).multiply(r0);
    // (the first joint's limit before the tip's turn: it keeps the tip on the goal)
    const first = (angle: number) => {
      const turned = swivelled(angle);
      _upper.copy(c.base).multiply(turned);
      return 100 * excess(turned, limits[0]);
    };
    const tip = () => quaternion ? shared(_upper, bent, a, quaternion, limits, twist) : 0;
    const strain = (angle: number) => first(angle) + tip();
    // as the pole has it, unless a swivel searched with the preferred twist fits better, by more than the swivel costs (`SWIVEL`)
    let swivel = 0;
    let left = strain(0);
    if (left >= FITS && swivels) {
      const [searched, there] = least(first, tip, -Math.PI, Math.PI, 0);
      if (left - there > SWIVEL * searched * searched) [swivel, left] = [searched, there];
    }
    swivelled(swivel);
    return left;
  };
  // (a limb nearly straight can bend either way within its range: the way that fits its limits better)
  const left = place(bend);
  const other = candidates[0] === bend ? candidates[1] : candidates[0];
  if (left >= FITS && swivels && other !== bend && clampBend(other, hinge) === other) {
    _kept.copy(local[0]);
    if (place(other) < left) bend = other;
    else local[0].copy(_kept);
  }
  limited(skeleton, bones[0], local[0]);

  // the middle joint aimed again from where the first bone is: the target in its frame, about the hinge
  r0.copy(c.base).multiply(local[0]);
  const q = _p.copy(target).sub(start).applyQuaternion(_q.copy(r0).invert()).sub(o1);
  q.addScaledVector(h, -q.dot(h));
  if (q.lengthSq() > 1e-18) bend = clampBend(signedAngle(vp, q, h), hinge);
  local[1].setFromAxisAngle(h, bend).multiply(neutral);
  if (!quaternion) {
    if (twist !== undefined) limited(skeleton, bones[1], local[1].multiply(_q2.setFromAxisAngle(a, twist)));
    return;
  }

  // the tip's turn about the middle bone, shared between the middle bone and the tip
  shared(r0, local[1], a, quaternion, limits, twist);
  limited(skeleton, bones[1], local[1].copy(_twisted));
  limited(skeleton, bones[2], local[2].copy(r0).multiply(local[1]).invert().multiply(quaternion));
}

/** the tip's rotation (into `_tip`) that turns it `quaternion` under a first bone turned `upper` (world) and a middle bone turned `middle` then `twist` about `axis` (into `_twisted`) */
function tipped(upper: Quaternion, middle: Quaternion, axis: Vector3, twist: number, quaternion: Quaternion): Quaternion {
  _twisted.copy(middle).multiply(_q2.setFromAxisAngle(axis, twist));
  return _tip.copy(upper).multiply(_twisted).invert().multiply(quaternion);
}

/** The best joint fit and cost of leaving the preferred twist, used by both twist and swivel searches. */
function shared(upper: Quaternion, middle: Quaternion, axis: Vector3, quaternion: Quaternion, limits: (Limit | undefined)[], twist: number | undefined): number {
  // (the tip's limit first: it rules out more twists alone)
  // (the tip's rotation at a twist t is R(axis, −t) · (upper · middle)⁻¹ · quaternion: the part that does not turn with t taken once,
  // and the middle bone turned only where its limit is read — these run thousands of times in a limb's swivel search)
  const fixed = _fixed.copy(upper).multiply(middle).invert().multiply(quaternion);
  let at = 0;
  const tipOf = (twist: number) => {
    at = twist;
    _tip.setFromAxisAngle(axis, -twist).multiply(fixed);
    return excess(_tip, limits[2]);
  };
  const middleOf = () => excess(_twisted.copy(middle).multiply(_q2.setFromAxisAngle(axis, at)), limits[1]);
  // Both joints' limits are evaluated together, from the preferred twist or an even split.
  const whole = twistAbout(tipped(upper, middle, axis, 0, quaternion), axis);
  const [lo, hi] = limits[1]?.twist ?? [-Math.PI, Math.PI];
  const split = Math.min(hi, Math.max(lo, twist ?? whole / 2));
  const [fitted, value] = least(tipOf, middleOf, lo, hi, split);
  // (the middle bone turned as fitted, into `_twisted`)
  tipped(upper, middle, axis, fitted, quaternion);
  return value + NEAREST * Math.abs(fitted - split);
}

/** a middle joint as a hinge: its axis and range in its parent's frame, the rotation it bends from, and how far it is bent now */
interface Hinge {
  axis: Vector3;
  range: [number, number];
  neutral: Quaternion;
  now: number;
}

/**
 * the hinge of a middle joint turned `q` now, `offset` from its parent: about the axis its limit
 * allows the most swing about, or without a limit about the axis it is bent about now
 */
function hingeOf(limit: Limit | undefined, q: Quaternion, offset: Vector3): Hinge {
  if (!limit) {
    const angle = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
    const axis = angle > 1e-9 ? _h.set(q.x, q.y, q.z).multiplyScalar(Math.sign(q.w) || 1).normalize() : perpendicular(offset, _h).normalize();
    return { axis, range: [-Math.PI, Math.PI], neutral: IDENTITY, now: angle > 1e-9 ? angle : 0 };
  }
  const { value } = coordinatesOf(q, limit, _coords);
  const wider = limit.swing[0][1] - limit.swing[0][0] >= limit.swing[1][1] - limit.swing[1][0] ? 0 : 1;
  const axis = _h.set(0, 0, 0).setComponent((limit.axis + 1 + wider) % 3, 1);
  return { axis, range: limit.swing[wider], neutral: limit.neutral ?? IDENTITY, now: value[wider] };
}

/** of two bends, the one within the hinge's range nearest how it is bent now, else the one nearest the range (clamped) */
function nearest(a: number, b: number, hinge: Hinge): number {
  const off = (x: number) => Math.abs(clampBend(x, hinge) - x);
  if (off(a) !== off(b)) return clampBend(off(a) < off(b) ? a : b, hinge);
  return Math.abs(a - hinge.now) <= Math.abs(b - hinge.now) ? a : b;
}

/**
 * the x within lo…hi where `f` = `part(x) + rest()` (both ≥ 0; `rest` reads what `part` left for that x) is least, `start` if it is
 * (all but) 0 there: sampled, then refined; of x where it is (all but) as little, the nearest `start` (a swivel moves no further than
 * it must), and `f` there. An x whose `part` alone is no less than the least yet is passed over without its `rest`: `f` there is no less.
 */
function least(part: (x: number) => number, rest: () => number, lo: number, hi: number, start: number): [x: number, f: number] {
  start = Math.min(hi, Math.max(lo, start));
  const near = (x: number) => NEAREST * Math.abs(x - start);
  let best = start;
  let value = part(start) + rest();
  let low = value + near(start);
  if (low < FITS) return [start, value];
  const see = (x: number) => {
    x = Math.min(hi, Math.max(lo, x));
    const cheap = part(x);
    if (cheap + near(x) >= low) return;
    const f = cheap + rest(), e = f + near(x);
    if (e < low) [low, best, value] = [e, x, f];
  };
  for (let k = 0; k <= 24; k++) see(lo + ((hi - lo) * k) / 24);
  for (let step = (hi - lo) / 48; step > SETTLED; step /= 2) {
    const at = best;
    see(at - step);
    see(at + step);
  }
  return [best, value];
}

/** how finely `least` settles (rad): 0.03 mm at the end of a forearm — far below what shows, and a limb's nested swivel and twist
 * searches take half the evaluations they would to settle to a micro-radian */
const SETTLED = 1e-4;

/** how much `least` holds each radian away from its start against what it minimises: next to nothing (ties broken toward the start) */
const NEAREST = 1e-3;

/**
 * Tuned: what a limb's swivel off the pole's side costs against the joints' excess it saves, × its square (rad): a small one, as a goal
 * moves on, next to nothing; one far round only for what it is worth — a radian's swivel for 0.05 rad (3°) of a wrist's excess saved,
 * half a turn for half a radian. Free, a swivel far round was taken for the last fraction of a degree a wrist is passed by (a rifle's
 * grip turning it just past its range swivelled the elbow 86° for 0.5°) and given back as the goal moved on: braked toward each in
 * turn, the arm trembled.
 */
const SWIVEL = 0.05;

const clampBend = (x: number, { range: [lo, hi] }: Hinge) => Math.min(hi, Math.max(lo, x));

/** cyclic coordinate descent: from the last joint to the first, each turned to point the tip at the target, within its limit */
function descend(c: Solving, target: Vector3) {
  const { skeleton, bones, local } = c;
  const last = bones.length - 1;
  let was = Infinity;
  for (let n = 0; n < SWEEPS; n++) {
    for (let k = last - 1; k >= 0; k--) {
      joints(c);
      const from = _a.subVectors(_joints[last], _joints[k]);
      const to = _b.subVectors(target, _joints[k]);
      if (from.lengthSq() < 1e-18 || to.lengthSq() < 1e-18) continue;
      _q.setFromUnitVectors(from.normalize(), to.normalize());
      const above = k === 0 ? c.base : _rotations[k - 1];
      // the turn in the world, as the bone's rotation in its parent's frame
      limited(skeleton, bones[k], local[k].premultiply(_r.copy(above).invert().multiply(_q).multiply(above)));
    }
    joints(c);
    const off = _joints[last].distanceTo(target);
    if (was - off < PROGRESS) return;
    was = off;
  }
}

/** each bone's world rotation in the chain being solved, into `_rotations` */
function worlds(c: Solving) {
  for (let k = 0; k < c.bones.length; k++) _rotations[k].copy(k === 0 ? c.base : _rotations[k - 1]).multiply(c.local[k]);
}

/** each joint's world position in the chain being solved into `_joints` (and `worlds`) */
function joints(c: Solving) {
  worlds(c);
  _joints[0].copy(c.start);
  for (let k = 1; k < c.bones.length; k++) _joints[k].copy(c.skeleton.bones[c.bones[k]].offset).applyQuaternion(_rotations[k - 1]).add(_joints[k - 1]);
}

function limited(skeleton: Skeleton, bone: number, q: Quaternion) {
  const limit = skeleton.limits[bone];
  if (limit) clampRotation(q, limit);
}

/** how far (rad, summed over its coordinates) `q` is outside `limit` */
function excess(q: Quaternion, limit: Limit | undefined): number {
  if (!limit) return 0;
  const { value, range } = coordinatesOf(q, limit, _coords);
  return value.reduce((sum, x, k) => sum + Math.max(0, range[k][0] - x, x - range[k][1]), 0);
}

/** the angle of `q`'s twist about the unit `axis` */
function twistAbout(q: Quaternion, axis: Vector3): number {
  return wrapAngle(2 * Math.atan2(q.x * axis.x + q.y * axis.y + q.z * axis.z, q.w));
}

/** the angle about the unit `axis` from `a` to `b` (both across it) */
const signedAngle = (a: Vector3, b: Vector3, axis: Vector3) => Math.atan2(_s.crossVectors(a, b).dot(axis), a.dot(b));
const clampUnit = (x: number) => Math.min(1, Math.max(-1, x));

/** some direction across `v` */
function perpendicular(v: Vector3, out: Vector3): Vector3 {
  return Math.abs(v.x) < 0.9 * v.length() ? out.set(1, 0, 0).cross(v) : out.set(0, 1, 0).cross(v);
}

const IDENTITY = new Quaternion();
const _local = Array.from({ length: LONGEST }, () => new Quaternion());
const _joints = Array.from({ length: LONGEST }, () => new Vector3());
const _rotations = Array.from({ length: LONGEST }, () => new Quaternion());
const _coords = coordinates();
const _m = new Matrix4();
const _base = new Quaternion();
const _start = new Vector3();
const [_v, _a, _b, _c, _d, _e, _t, _p, _n, _h, _hl, _s] = Array.from({ length: 12 }, () => new Vector3());
const _pole = new Vector3();
const _axis = new Vector3();
const [_q, _q2, _r, _r0, _qw, _ql, _twisted, _tip, _bent, _upper, _kept, _fixed] = Array.from({ length: 12 }, () => new Quaternion());
