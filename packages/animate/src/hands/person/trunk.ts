import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../../kernel/frame';
import { solveChain } from '../../kernel/chain';
import type { Dev } from '../../kernel/dev';
import { clampRotation } from '../../kernel/limits';
import type { ReadonlyPose } from '../../kernel/pose';
import { INDEX, SIDES, type Side } from '../../species/humanoid/bones';
import type { Proportions } from '../../species/humanoid/proportions';

// An arm keeps out of its own trunk. The trunk is two capsules up the spine, from the hips to the chest and on to the neck, and the arm
// three (radii × height: a lean adult's girths, Winter's, as examples/test/clearance.ts measures them; the hand reaching on from
// the wrist along the forearm, Drillis & Contini; where a reach asks its hand a turn, as turned).

const TRUNK = [['hips', 'chest', 0.06], ['chest', 'neck', 0.045]] as const;
export const ARM = { upper: 0.026, fore: 0.022, hand: 0.013, length: 0.08 };
/** Tuned: the air an arm keeps from the trunk (× height), over the joints' lag behind their solve */
const AIR = 0.005;
/** how far an arm may be seen in the trunk (m) */
const DEPTH = 0.01;
/** Tuned: how much further than `BACK` asks a wrist goal is pushed forward at most to clear the trunk (× the arm's length) */
const PUSH = 4;
/** how far ahead of the shoulder a hand far across the midline is kept, at most (× the shoulder's half-width) */
const BACK = 0.5;
/** Tuned: how far ahead of the shoulder's front plane a hand waits while the body turns to a goal behind or across it (× the arm's length) */
const WAIT = 0.4;
/** Tuned: how far round toward the other side of the body a goal ahead of the shoulder may lie and be reached for at once (rad) */
const SECTOR = Math.PI / 3;
/** Tuned: how far a nudge may move a braked joint in a sub-step, as a share of what its dev-checked acceleration moves it from rest
 * (half: a step that takes no more than half of that check) */
const NUDGE = 0.5;
/** the share of the arm's length a wrist goal is judged at, out of reach (as `ChainTip` lets a tip out) */
const REACH = 0.98;
/** the elbow's swivels tried about the shoulder–wrist line, each way (`SWIVEL.steps` of `SWIVEL.step` rad) */
const SWIVEL = { steps: 4, step: Math.PI / 12 };

/** How firmly `keepArmOut` keeps an arm out of the trunk. */
interface Keeping {
  /** how far into the trunk it may be (m; negative: clear of it by so much) */
  depth: number;
  /** how far the elbow may swivel each way (steps of `SWIVEL.step`) */
  swivel: number;
  /** how much further forward than `BACK` asks the wrist may be pushed (× the arm's length) */
  push: number;
  /** whether a hand across the midline is kept ahead of its shoulder as `BACK` asks */
  back: boolean;
  /** the joints turned from where they were toward that re-solve only as far as clears the arm, no further in a sub-step than this share
   * of each one's dev-checked acceleration moves it from rest (a re-solve from scratch would reset what the brakes carried: a jerk) */
  nudge?: number;
}

/** a reach as it is solved: clear by `AIR`, round the front, as far forward as it takes */
export const SOLVED = (proportions: Proportions): Keeping => ({ depth: -AIR * proportions.height, swivel: SWIVEL.steps, push: PUSH, back: true });
/** once its joints are braked to that, or a free arm as it swings: only nudged back within half the dev check's depth — a short swivel or
 * push, the joints turned toward it as little as clears the arm and within `NUDGE` — so the brakes' work is not undone in a jerk */
export const NUDGED: Keeping = { depth: DEPTH / 2, swivel: 1, push: 0.2, back: false, nudge: NUDGE };

/**
 * An arm last seen clear of the trunk, and by how much: while its points and the trunk's have moved less than half that since, it is
 * still clear — an arm part's depth moves no further than its own ends and the trunk's do, and the upper arm's, judged against its
 * shoulder's, twice that — so a hanging arm at rest is not judged again every sub-step.
 */
export class ArmClear {
  private margin = -Infinity;
  /** the depth it was judged against (`Keeping.depth`) */
  private clear = NaN;
  private readonly seen = Array.from({ length: 7 }, () => new Vector3());

  /** whether arm `side` of `pose` is still clear of `clear` as it was last seen (`saw`) */
  holds(pose: ReadonlyPose, proportions: Proportions, side: Side, clear: number): boolean {
    if (this.margin <= 0 || clear !== this.clear) return false;
    const points = pointsOf(pose, proportions, side);
    let arm = 0, trunk = 0;
    points.forEach((point, k) => {
      const moved = point.distanceTo(this.seen[k]);
      if (k < 4) arm = Math.max(arm, moved);
      else trunk = Math.max(trunk, moved);
    });
    return 2 * (arm + trunk) < this.margin;
  }

  /** arm `side` of `pose` seen `margin` (m) clear of `clear`, how deep it may be */
  saw(pose: ReadonlyPose, proportions: Proportions, side: Side, clear: number, margin: number): void {
    [this.clear, this.margin] = [clear, margin];
    pointsOf(pose, proportions, side).forEach((point, k) => this.seen[k].copy(point));
  }
}

/** an arm's shoulder, elbow, wrist and hand's end, and the trunk's hips, chest and neck, as `armDepth` reads them */
function pointsOf(pose: ReadonlyPose, proportions: Proportions, side: Side): readonly Readonly<Vector3>[] {
  const elbow = pose.position(INDEX[`${side}LowerArm`]), wrist = pose.position(INDEX[`${side}Hand`]);
  _points[0] = pose.position(INDEX[`${side}UpperArm`]);
  _points[1] = elbow;
  _points[2] = wrist;
  _points[3] = _handEnd.subVectors(wrist, elbow).setLength(ARM.length * proportions.height).add(wrist);
  _points[4] = pose.position(INDEX.hips);
  _points[5] = pose.position(INDEX.chest);
  _points[6] = pose.position(INDEX.neck);
  return _points;
}

/**
 * Re-solve a colliding arm toward world-space `tip` within joint limits, minimizing forward push and elbow swivel. Return push in metres;
 * leave an infeasible pose for the dev check. Given `seen`, an arm judged clear by its bound is left as it is, and one found clear is
 * remembered there.
 */
export function keepArmOut(f: Frame, proportions: Proportions, side: Side, tip: { position: Vector3; quaternion?: Quaternion }, keeping: Keeping, seen?: ArmClear): number {
  const pose = f.current, chain = `${side}Arm`;
  if (!keeping.back && seen?.holds(pose, proportions, side, keeping.depth)) return 0;
  const shoulder = pose.position(INDEX[`${side}UpperArm`]), clear = keeping.depth;
  const upper = Math.max(clear, deepest(pose, proportions, shoulder, shoulder, ARM.upper).depth);
  const least = keeping.back ? ahead(pose, proportions, side, tip.position) : 0;
  if (least === 0) {
    const depth = armDepth(pose, proportions, side, upper, clear);
    if (depth <= clear) {
      seen?.saw(pose, proportions, side, clear, clear - depth);
      return 0;
    }
  }
  seen?.saw(pose, proportions, side, clear, 0);
  const forward = _forward.set(0, 0, 1).applyQuaternion(pose.rotation(INDEX.chest));
  const near = _elbow.copy(pose.position(INDEX[`${side}LowerArm`]));
  // (the arm as solved; every bounded candidate starts here, so search trials cannot accumulate nudges)
  const bones = pose.skeleton.chain(chain);
  bones.forEach((bone, k) => _was[k].copy(pose.local(bone)));
  const nudge = keeping.nudge;
  const best = bones.map((bone) => pose.local(bone).clone());
  let bestDepth = armDepth(pose, proportions, side, upper, clear);
  const bounded = () => {
    if (nudge === undefined) return;
    // (the joints turned from where they were toward the re-solve, each its share of the way: the least share that clears, halved in
    // on; no joint further than `nudge` of its checked acceleration takes it in a sub-step)
    let most = 1;
    bones.forEach((bone, k) => {
      _fit[k].copy(pose.local(bone));
      const accel = pose.skeleton.bones[bone].snap?.accel;
      if (accel !== undefined) most = Math.min(most, (nudge * accel * DEGREE * f.dt * f.dt) / Math.max(_fit[k].angleTo(_was[k]), 1e-9));
    });
    // (each kept within its range: a joint at the edge of it at both ends is not on the way between them — a wrist turned into a
    // corner of its range bulges out of it, the way between)
    const toward = (share: number) => bones.forEach((bone, k) => {
      const limit = pose.skeleton.limits[bone], q = _blend.copy(_was[k]).slerp(_fit[k], share);
      if (limit) clampRotation(q, limit);
      pose.setLocal(bone, q);
    });
    let out = 0, inn = most;
    toward(most);
    if (armDepth(pose, proportions, side, upper, clear) <= clear) {
      for (let k = 0; k < 10; k++) {
        const mid = (out + inn) / 2;
        toward(mid);
        if (armDepth(pose, proportions, side, upper, clear) <= clear) inn = mid;
        else out = mid;
      }
    }
    toward(inn);
  };
  const fits = (push: number) => {
    const goal = _goal.copy(tip.position).addScaledVector(forward, push);
    return swivels(proportions, shoulder, goal, near, keeping.swivel, (elbow) => {
      if (nudge !== undefined) bones.forEach((bone, k) => pose.setLocal(bone, _was[k]));
      solveChain(f, chain, { tip: { position: goal, quaternion: tip.quaternion }, pole: elbow });
      // Judge the correction the acceleration budget permits, not the full solve it cannot reach this step.
      bounded();
      const depth = armDepth(pose, proportions, side, upper, clear);
      if (depth < bestDepth) {
        bestDepth = depth;
        bones.forEach((bone, k) => best[k].copy(pose.local(bone)));
      }
      return depth <= clear;
    });
  };
  const pushed = leastPush(fits, least, Math.max(AIR * proportions.height, 0.005), keeping.push * proportions.armLength, 8, 1e-3);
  if (pushed === null) {
    // An incomplete nudge can still reduce penetration; do not throw away the best legal progress.
    bones.forEach((bone, k) => pose.setLocal(bone, nudge === undefined ? _was[k] : best[k]));
    return 0;
  }
  return pushed;
}

/** the least push from `least` that `fits` (left fitted): stepped out from `step`, doubling, then halved in on (`halvings`, to `within`); none past `most` */
function leastPush(fits: (push: number) => boolean, least: number, step: number, most: number, halvings: number, within: number): number | null {
  let lo = least, hi = least;
  for (; !fits(hi); step *= 2) {
    if (hi > least + most) return null;
    [lo, hi] = [hi, hi + step];
  }
  for (let k = 0; k < halvings && hi - lo > within; k++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  fits(hi);
  return hi;
}

/**
 * whether some elbow of arm `side`, about the shoulder–wrist line from `near` round, holds its wrist at `wrist` clear of the trunk as
 * `pose` stands it, the hand on from it along `along` (world, unit; none: along the forearm, an unbent wrist): the elbow into `pole`
 */
function holds(pose: ReadonlyPose, proportions: Proportions, side: Side, wrist: Readonly<Vector3>, near: Readonly<Vector3>, along?: Readonly<Vector3>, pole?: Vector3): boolean {
  const shoulder = pose.position(INDEX[`${side}UpperArm`]), clear = -AIR * proportions.height, length = ARM.length * proportions.height;
  const upper = Math.max(clear, deepest(pose, proportions, shoulder, shoulder, ARM.upper).depth);
  return swivels(proportions, shoulder, wrist, near, SWIVEL.steps, (elbow, end) => {
    const hand = along ? _hand.copy(along).multiplyScalar(length).add(end) : _hand.subVectors(end, elbow).setLength(length).add(end);
    if (deepest(pose, proportions, shoulder, elbow, ARM.upper).depth > upper) return false;
    if (deepest(pose, proportions, elbow, end, ARM.fore).depth > clear || deepest(pose, proportions, end, hand, ARM.hand).depth > clear) return false;
    pole?.copy(elbow);
    return true;
  });
}

/** whether arm `side` can hold its wrist at `wrist`, the hand on toward `palm` (world), clear of the trunk as `pose` stands it (`holds`) */
export function holdsClear(pose: ReadonlyPose, proportions: Proportions, side: Side, wrist: Readonly<Vector3>, palm: Readonly<Vector3>, near: Readonly<Vector3>): boolean {
  return holds(pose, proportions, side, wrist, near, _along.subVectors(palm, wrist).normalize());
}

/** Clear the world-space wrist in place and write the elbow to `pole`, with minimum swivel from `near`, the hand on from the wrist along
 * `along` (world, unit: a hand turned on the wrist) or else the forearm. Cross-body reaches stay in front; return forward push (m), or -1
 * without changing an infeasible goal.
 */
export function clearWrist(pose: ReadonlyPose, proportions: Proportions, side: Side, wrist: Vector3, near: Readonly<Vector3>, pole: Vector3, along?: Readonly<Vector3>): number {
  const forward = _forward.set(0, 0, 1).applyQuaternion(pose.rotation(INDEX.chest));
  const fits = (push: number) => holds(pose, proportions, side, _pushed.copy(wrist).addScaledVector(forward, push), near, along, pole);
  const pushed = leastPush(fits, ahead(pose, proportions, side, wrist), AIR * proportions.height, PUSH * proportions.armLength, 12, 1e-4);
  if (pushed === null) return -1;
  wrist.copy(_pushed);
  return pushed;
}

/** Search elbows about the shoulder–wrist axis, alternating sides from `near`; stop when `take` accepts one. */
function swivels(proportions: Proportions, shoulder: Readonly<Vector3>, wrist: Readonly<Vector3>, near: Readonly<Vector3>, steps: number, take: (elbow: Vector3, end: Vector3) => boolean): boolean {
  const axis = _axis.subVectors(wrist, shoulder);
  const length = Math.min(axis.length(), 0.999 * (proportions.upperArm + proportions.forearm));
  axis.normalize();
  const end = _end.copy(shoulder).addScaledVector(axis, length);
  const along = (proportions.upperArm ** 2 - proportions.forearm ** 2 + length ** 2) / (2 * length);
  const radius = Math.sqrt(Math.max(0, proportions.upperArm ** 2 - along ** 2));
  const center = _center.copy(shoulder).addScaledVector(axis, along);
  const u = _u.subVectors(near, shoulder).addScaledVector(axis, -_d.subVectors(near, shoulder).dot(axis));
  if (u.lengthSq() < 1e-12) u.set(1, 0, 0).addScaledVector(axis, -axis.x);
  u.normalize();
  const v = _v.crossVectors(axis, u);
  for (let k = 0; k <= (radius < 1e-6 ? 0 : steps); k++) {
    for (const turn of k === 0 ? [0] : [k * SWIVEL.step, -k * SWIVEL.step]) {
      const elbow = _swivel.copy(center).addScaledVector(u, radius * Math.cos(turn)).addScaledVector(v, radius * Math.sin(turn));
      if (take(elbow, end)) return true;
    }
  }
  return false;
}

/** Stage world-space cross-body or rearward goals in `out`, in front until the trunk turns. A hand on backswing first comes forward on its own side; return null when a direct reach is clear. */
export function waitingFor(pose: ReadonlyPose, proportions: Proportions, side: Side, hand: Readonly<Vector3>, goal: Readonly<Vector3>, near: Readonly<Vector3>, out: Vector3): Vector3 | null {
  const shoulder = pose.position(INDEX[`${side}UpperArm`]), turn = pose.rotation(INDEX.chest);
  const front = _wFront.set(0, 0, 1).applyQuaternion(turn), inside = _wIn.set(side === 'left' ? -1 : 1, 0, 0).applyQuaternion(turn);
  const before = _d.subVectors(goal, shoulder).dot(front), inward = _d.subVectors(goal, shoulder).dot(inside);
  const across = ahead(pose, proportions, side, goal);
  // (the hand behind on the floor's plane, as the chest faces: bowed, a hand low in front is not behind)
  const back = _d.subVectors(hand, shoulder).setY(0).dot(_wFlat.copy(front).setY(0).normalize());
  const most = REACH * (proportions.upperArm + proportions.forearm);
  if ((before > 0 || inward <= 0) && across === 0 && (Math.atan2(inward, before) <= SECTOR || goal.distanceTo(shoulder) <= most)) {
    if (inward <= 0 || back >= 0) return null;
    out.copy(hand).addScaledVector(front, WAIT * proportions.armLength - back);
  } else out.copy(goal).addScaledVector(front, before > 0 ? across : Math.max(WAIT * proportions.armLength - before, across));
  // (no further out than the arm reaches)
  const reach = _d.subVectors(out, shoulder);
  if (reach.length() > most) out.copy(shoulder).addScaledVector(reach, most / reach.length());
  clearWrist(pose, proportions, side, out, near, _waitPole);
  return out;
}

/** how far ahead (the chest's) a wrist at `wrist` must go at least to be as far ahead of arm `side`'s shoulder as `BACK` keeps it (m) */
function ahead(pose: ReadonlyPose, proportions: Proportions, side: Side, wrist: Readonly<Vector3>): number {
  const shoulder = pose.position(INDEX[`${side}UpperArm`]), turn = pose.rotation(INDEX.chest);
  // (none on its own side of the midline — behind its own hip is a hand's to reach; across it, level with the shoulder at the midline,
  // further ahead the further across)
  const inward = (side === 'left' ? -1 : 1) * _d.subVectors(wrist, shoulder).dot(_left.set(1, 0, 0).applyQuaternion(turn));
  if (inward <= proportions.shoulderHalfWidth) return 0;
  const least = BACK * proportions.shoulderHalfWidth * (1 - proportions.shoulderHalfWidth / inward);
  return Math.max(0, least - _d.subVectors(wrist, shoulder).dot(_front.set(0, 0, 1).applyQuaternion(turn)));
}

/** how far arm `side`'s upper arm, forearm and hand are in the trunk at their deepest (`deepest`), the upper arm's against `upper` */
function armDepth(pose: ReadonlyPose, proportions: Proportions, side: Side, upper: number, clear: number): number {
  const shoulder = pose.position(INDEX[`${side}UpperArm`]);
  const elbow = pose.position(INDEX[`${side}LowerArm`]);
  const wrist = pose.position(INDEX[`${side}Hand`]);
  const hand = _hand.subVectors(wrist, elbow).setLength(ARM.length * proportions.height).add(wrist);
  const upperArm = deepest(pose, proportions, shoulder, elbow, ARM.upper).depth - upper + clear;
  return Math.max(upperArm, deepest(pose, proportions, elbow, wrist, ARM.fore).depth, deepest(pose, proportions, wrist, hand, ARM.hand).depth);
}

/** how far an arm part from `a` to `b`, `radius` round (× height), is in the trunk at its deepest (m; negative: clear of it by so much), and in which capsule */
function deepest(pose: ReadonlyPose, proportions: Proportions, a: Readonly<Vector3>, b: Readonly<Vector3>, radius: number): { depth: number; capsule: string } {
  let depth = -Infinity, capsule = '';
  for (const [from, to, r] of TRUNK) {
    const d = (radius + r) * proportions.height - segmentDistance(a, b, pose.position(INDEX[from]), pose.position(INDEX[to]));
    if (d > depth) [depth, capsule] = [d, `${from}–${to}`];
  }
  return { depth, capsule };
}

/** Dev check on a final pose: neither arm's upper arm, forearm or hand more than `DEPTH` into the trunk. */
export function checkArms(pose: ReadonlyPose, proportions: Proportions, time: number, dev: Dev): void {
  for (const side of SIDES) {
    const shoulder = pose.position(INDEX[`${side}UpperArm`]), elbow = pose.position(INDEX[`${side}LowerArm`]), wrist = pose.position(INDEX[`${side}Hand`]);
    const tip = _tip.subVectors(wrist, elbow).setLength(ARM.length * proportions.height).add(wrist);
    const parts = [['UpperArm', shoulder, elbow, ARM.upper], ['LowerArm', elbow, wrist, ARM.fore], ['Hand', wrist, tip, ARM.hand]] as const;
    for (const [part, a, b, r] of parts) {
      const { depth: value, capsule } = deepest(pose, proportions, a, b, r);
      if (value > DEPTH) dev.append(time, { check: 'arm in the trunk (m)', value, limit: DEPTH, where: `${side}${part} in ${capsule}` });
    }
  }
}

/** the least distance between segments `a`–`b` and `c`–`d` (their nearest points left in `_sp`, `_sq`) */
function segmentDistance(a: Readonly<Vector3>, b: Readonly<Vector3>, c: Readonly<Vector3>, d: Readonly<Vector3>): number {
  const u = _su.subVectors(b, a), v = _sv.subVectors(d, c), w = _sw.subVectors(a, c);
  const uu = u.dot(u), vv = v.dot(v), uv = u.dot(v), uw = u.dot(w), vw = v.dot(w);
  const det = uu * vv - uv * uv;
  // (the closest points' parameters, each clamped to its segment and the other's redone for it)
  let s = det > 1e-12 ? unit((uv * vw - vv * uw) / det) : 0;
  let r = vv > 1e-12 ? unit((uv * s + vw) / vv) : 0;
  s = uu > 1e-12 ? unit((uv * r - uw) / uu) : 0;
  r = vv > 1e-12 ? unit((uv * s + vw) / vv) : 0;
  return _sp.copy(a).addScaledVector(u, s).distanceTo(_sq.copy(c).addScaledVector(v, r));
}

const DEGREE = Math.PI / 180;
const unit = (x: number) => Math.min(1, Math.max(0, x));
const _forward = new Vector3(), _left = new Vector3(), _pushed = new Vector3(), _d = new Vector3(), _tip = new Vector3(), _front = new Vector3();
const _was = [new Quaternion(), new Quaternion(), new Quaternion()], _fit = [new Quaternion(), new Quaternion(), new Quaternion()], _blend = new Quaternion();
const _waitPole = new Vector3(), _wFront = new Vector3(), _wIn = new Vector3(), _wFlat = new Vector3(), _goal = new Vector3(), _swivel = new Vector3();
const _elbow = new Vector3(), _hand = new Vector3(), _end = new Vector3(), _axis = new Vector3(), _center = new Vector3(), _u = new Vector3(), _v = new Vector3();
const _points: Readonly<Vector3>[] = [], _handEnd = new Vector3(), _along = new Vector3();
const _su = new Vector3(), _sv = new Vector3(), _sw = new Vector3(), _sp = new Vector3(), _sq = new Vector3();
