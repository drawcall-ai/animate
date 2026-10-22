import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../core/body';
import { solveChain } from '../core/chain';
import type { Dev } from '../core/dev';
import type { ReadonlyPose } from '../core/pose';
import { INDEX, SIDES, type Side } from './bones';
import type { Proportions } from './proportions';

// An arm keeps out of its own trunk. The trunk is two capsules up the spine, from the hips to the chest and on to the neck, and the arm
// three (radii × height: a lean adult's girths, Winter's, as examples/test/clearance.ts measures them; the hand reaching on from
// the wrist along the forearm, Drillis & Contini).

const TRUNK = [['hips', 'chest', 0.06], ['chest', 'neck', 0.045]] as const;
const ARM = { upper: 0.026, fore: 0.022, hand: 0.013, length: 0.08 };
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
/** the share of the arm's length a wrist goal is judged at, out of reach (as `ChainTip` lets a tip out) */
const REACH = 0.98;
/** the elbow's swivels tried about the shoulder–wrist line, each way (`SWIVEL.steps` of `SWIVEL.step` rad) */
const SWIVEL = { steps: 4, step: Math.PI / 12 };

/** How firmly `keepArmOut` keeps an arm out of the trunk. */
export interface Keeping {
  /** how far into the trunk it may be (m; negative: clear of it by so much) */
  depth: number;
  /** how far the elbow may swivel each way (steps of `SWIVEL.step`) */
  swivel: number;
  /** how much further forward than `BACK` asks the wrist may be pushed (× the arm's length) */
  push: number;
  /** whether a hand across the midline is kept ahead of its shoulder as `BACK` asks */
  back: boolean;
}

/** a reach as it is solved: clear by `AIR`, round the front, as far forward as it takes */
export const SOLVED = (p: Proportions): Keeping => ({ depth: -AIR * p.height, swivel: SWIVEL.steps, push: PUSH, back: true });
/** once its joints are braked to that, or a free arm as it swings: only nudged back within half the dev check's depth — a short
 * swivel or push, so the brakes' work is not undone in one sub-step (a bigger correction would be a jerk of the joints) */
export const NUDGED: Keeping = { depth: DEPTH / 2, swivel: 1, push: 0.2, back: false };

/**
 * Arm `side` as posed this sub-step, its wrist going to `tip` (world), kept out of its own trunk as `keeping` asks: left as it is if
 * it is clear, else re-solved — the joints within their ranges — to the goal pushed forward (the chest's) as little as lets an elbow
 * swivelled as little as needs clear it. Nowhere clear within the push allowed, it stays as it was: the dev check says so. Returns how
 * far the goal was pushed (m): what the trunk turning takes up.
 */
export function keepArmOut(f: Frame, p: Proportions, side: Side, tip: { position: Vector3; quaternion?: Quaternion }, keeping: Keeping): number {
  const pose = f.current, chain = `${side}Arm`;
  const shoulder = pose.position(INDEX[`${side}UpperArm`]), clear = keeping.depth;
  const upper = Math.max(clear, inTrunk(pose, p, shoulder, shoulder, ARM.upper));
  const least = keeping.back ? ahead(pose, p, side, tip.position) : 0;
  if (least === 0 && armDepth(pose, p, side, upper, clear) <= clear) return 0;
  const forward = _forward.set(0, 0, 1).applyQuaternion(pose.rotation(INDEX.chest));
  const near = _elbow.copy(pose.position(INDEX[`${side}LowerArm`]));
  // (the arm as solved, to put back if nothing clears)
  const bones = pose.skeleton.chain(chain);
  bones.forEach((bone, k) => _was[k].copy(pose.local(bone)));
  const fits = (push: number) => {
    const goal = _goal.copy(tip.position).addScaledVector(forward, push);
    return swivels(p, shoulder, goal, near, keeping.swivel, (elbow) => {
      solveChain(f, chain, { tip: { position: goal, quaternion: tip.quaternion }, pole: elbow });
      return armDepth(pose, p, side, upper, clear) <= clear;
    });
  };
  // (the least push that fits: stepped out further and further till it does, then halved in on it)
  let lo = least, hi = least;
  for (let step = Math.max(AIR * p.height, 0.005); !fits(hi); step *= 2) {
    if (hi > least + keeping.push * p.armLength) {
      bones.forEach((bone, k) => pose.setLocal(bone, _was[k]));
      return 0;
    }
    [lo, hi] = [hi, hi + step];
  }
  for (let k = 0; k < 8 && hi - lo > 1e-3; k++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  fits(hi);
  return hi;
}

/**
 * Wrist goal `wrist` (world) of arm `side`, moved in place out of the way of its own trunk as `pose` holds it, and an elbow for it into
 * `pole`: a hand across the midline goes round the front of the trunk, not the back — the further across, the further forward it is
 * kept (`BACK`) — and of the arms reaching it, or it pushed forward (the chest's) as little as needs, the one with the elbow swivelled
 * least from `near`, all three parts clear of the trunk by `AIR`. Returns how far it was pushed (m); clear nowhere within `PUSH` arm's
 * lengths further forward, -1, and it stays.
 */
export function clearWrist(pose: ReadonlyPose, p: Proportions, side: Side, wrist: Vector3, near: Readonly<Vector3>, pole: Vector3): number {
  const shoulder = pose.position(INDEX[`${side}UpperArm`]), clear = -AIR * p.height;
  const forward = _forward.set(0, 0, 1).applyQuaternion(pose.rotation(INDEX.chest));
  const upper = Math.max(clear, inTrunk(pose, p, shoulder, shoulder, ARM.upper));
  const fits = (push: number) => {
    const at = _pushed.copy(wrist).addScaledVector(forward, push);
    return swivels(p, shoulder, at, near, SWIVEL.steps, (elbow, end) => {
      const hand = _hand.subVectors(end, elbow).setLength(ARM.length * p.height).add(end);
      if (inTrunk(pose, p, shoulder, elbow, ARM.upper) > upper || inTrunk(pose, p, elbow, end, ARM.fore) > clear || inTrunk(pose, p, end, hand, ARM.hand) > clear) return false;
      pole.copy(elbow);
      return true;
    });
  };
  // (the least push that fits: stepped out further and further till it does, then halved in on it)
  const lo0 = ahead(pose, p, side, wrist);
  let lo = lo0, hi = lo;
  for (let step = AIR * p.height; !fits(hi); step *= 2) {
    if (hi > lo0 + PUSH * p.armLength) return -1;
    [lo, hi] = [hi, hi + step];
  }
  for (let k = 0; k < 12 && hi - lo > 1e-4; k++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  fits(hi);
  wrist.copy(_pushed);
  return hi;
}

/**
 * The elbows an arm from `shoulder` reaching toward `wrist` (as far as it reaches, to `end`) may have, swivelled about the line
 * between them from `near` out each way in turn (`steps` of `SWIVEL.step` each way), given to `take` until it takes one: whether it did.
 */
function swivels(p: Proportions, shoulder: Readonly<Vector3>, wrist: Readonly<Vector3>, near: Readonly<Vector3>, steps: number, take: (elbow: Vector3, end: Vector3) => boolean): boolean {
  const axis = _axis.subVectors(wrist, shoulder);
  const length = Math.min(axis.length(), 0.999 * (p.upperArm + p.forearm));
  axis.normalize();
  const end = _end.copy(shoulder).addScaledVector(axis, length);
  const along = (p.upperArm ** 2 - p.forearm ** 2 + length ** 2) / (2 * length);
  const radius = Math.sqrt(Math.max(0, p.upperArm ** 2 - along ** 2));
  const center = _center.copy(shoulder).addScaledVector(axis, along);
  const u = _u.subVectors(near, shoulder).addScaledVector(axis, -_d.subVectors(near, shoulder).dot(axis));
  if (u.lengthSq() < 1e-12) u.set(1, 0, 0).addScaledVector(axis, -axis.x);
  u.normalize();
  const v = _v.crossVectors(axis, u);
  for (let k = 0; k <= (radius < 1e-6 ? 0 : steps); k++) {
    for (const turn of k === 0 ? [0] : [k * SWIVEL.step, -k * SWIVEL.step]) {
      if (take(_swivel.copy(center).addScaledVector(u, radius * Math.cos(turn)).addScaledVector(v, radius * Math.sin(turn)), end)) return true;
    }
  }
  return false;
}

/**
 * Where arm `side`'s hand, at `hand` (world), waits on its way to `goal` (world), into `out`; none (null) once it may set off straight
 * for it. A goal toward the other side behind the shoulder's front plane, out of reach further round than `SECTOR`, or across the
 * midline less far ahead than `BACK` asks waits for the body to turn: the hand waits in front, the goal brought forward (the chest's) to `WAIT` of the
 * arm's length ahead of that plane, within reach. A goal toward the other side with the hand still behind that plane (a free arm on
 * its backswing) waits for the hand to come forward on its own side, `WAIT` ahead of the plane. Either clear of the trunk, the elbow
 * near `near`: people turn first, the hand coming round in front.
 */
export function waitingFor(pose: ReadonlyPose, p: Proportions, side: Side, hand: Readonly<Vector3>, goal: Readonly<Vector3>, near: Readonly<Vector3>, out: Vector3): Vector3 | null {
  const shoulder = pose.position(INDEX[`${side}UpperArm`]), turn = pose.rotation(INDEX.chest);
  const front = _wFront.set(0, 0, 1).applyQuaternion(turn), inside = _wIn.set(side === 'left' ? -1 : 1, 0, 0).applyQuaternion(turn);
  const before = _d.subVectors(goal, shoulder).dot(front), inward = _d.subVectors(goal, shoulder).dot(inside), across = ahead(pose, p, side, goal);
  // (the hand behind on the floor's plane, as the chest faces: bowed, a hand low in front is not behind)
  const back = _d.subVectors(hand, shoulder).setY(0).dot(_wFlat.copy(front).setY(0).normalize()), most = REACH * (p.upperArm + p.forearm);
  if ((before > 0 || inward <= 0) && across === 0 && (Math.atan2(inward, before) <= SECTOR || goal.distanceTo(shoulder) <= most)) {
    if (inward <= 0 || back >= 0) return null;
    out.copy(hand).addScaledVector(front, WAIT * p.armLength - back);
  } else out.copy(goal).addScaledVector(front, before > 0 ? across : Math.max(WAIT * p.armLength - before, across));
  // (no further out than the arm reaches)
  const reach = _d.subVectors(out, shoulder);
  if (reach.length() > most) out.copy(shoulder).addScaledVector(reach, most / reach.length());
  clearWrist(pose, p, side, out, near, _waitPole);
  return out;
}

/** how far ahead (the chest's) a wrist at `wrist` must go at least to be as far ahead of arm `side`'s shoulder as `BACK` keeps it (m) */
function ahead(pose: ReadonlyPose, p: Proportions, side: Side, wrist: Readonly<Vector3>): number {
  const shoulder = pose.position(INDEX[`${side}UpperArm`]), turn = pose.rotation(INDEX.chest);
  // (none on its own side of the midline — behind its own hip is a hand's to reach; across it, level with the shoulder at the midline,
  // further ahead the further across)
  const inward = (side === 'left' ? -1 : 1) * _d.subVectors(wrist, shoulder).dot(_left.set(1, 0, 0).applyQuaternion(turn));
  if (inward <= p.shoulderHalfWidth) return 0;
  const least = BACK * p.shoulderHalfWidth * (1 - p.shoulderHalfWidth / inward);
  return Math.max(0, least - _d.subVectors(wrist, shoulder).dot(_front.set(0, 0, 1).applyQuaternion(turn)));
}

/** how far arm `side`'s upper arm, forearm and hand are in the trunk as `pose` holds them, at their deepest (m; negative: clear by so much), the upper arm's measured against `upper` as the others' against `clear` */
function armDepth(pose: ReadonlyPose, p: Proportions, side: Side, upper: number, clear: number): number {
  const shoulder = pose.position(INDEX[`${side}UpperArm`]), elbow = pose.position(INDEX[`${side}LowerArm`]), wrist = pose.position(INDEX[`${side}Hand`]);
  const hand = _hand.subVectors(wrist, elbow).setLength(ARM.length * p.height).add(wrist);
  return Math.max(inTrunk(pose, p, shoulder, elbow, ARM.upper) - upper + clear, inTrunk(pose, p, elbow, wrist, ARM.fore), inTrunk(pose, p, wrist, hand, ARM.hand));
}

/** how far (m) an arm part from `a` to `b`, `radius` round (× height), is in the trunk as `pose` holds it, at its deepest (negative: clear of it by so much), and in which capsule */
function inTrunk(pose: ReadonlyPose, p: Proportions, a: Readonly<Vector3>, b: Readonly<Vector3>, radius: number): number {
  return deepest(pose, p, a, b, radius).depth;
}

function deepest(pose: ReadonlyPose, p: Proportions, a: Readonly<Vector3>, b: Readonly<Vector3>, radius: number): { depth: number; capsule: string } {
  let depth = -Infinity, capsule = '';
  for (const [from, to, r] of TRUNK) {
    const d = (radius + r) * p.height - segmentDistance(a, b, pose.position(INDEX[from]), pose.position(INDEX[to]));
    if (d > depth) [depth, capsule] = [d, `${from}–${to}`];
  }
  return { depth, capsule };
}

/** Dev check on a final pose: neither arm's upper arm, forearm or hand more than `DEPTH` into the trunk. */
export function checkArms(pose: ReadonlyPose, p: Proportions, time: number, dev: Dev): void {
  for (const side of SIDES) {
    const shoulder = pose.position(INDEX[`${side}UpperArm`]), elbow = pose.position(INDEX[`${side}LowerArm`]), wrist = pose.position(INDEX[`${side}Hand`]);
    const tip = _tip.subVectors(wrist, elbow).setLength(ARM.length * p.height).add(wrist);
    const parts = [['UpperArm', shoulder, elbow, ARM.upper], ['LowerArm', elbow, wrist, ARM.fore], ['Hand', wrist, tip, ARM.hand]] as const;
    for (const [part, a, b, r] of parts) {
      const { depth: value, capsule } = deepest(pose, p, a, b, r);
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

const unit = (x: number) => Math.min(1, Math.max(0, x));
const _forward = new Vector3(), _left = new Vector3(), _pushed = new Vector3(), _d = new Vector3(), _tip = new Vector3();
const _was = [new Quaternion(), new Quaternion(), new Quaternion()];
const _waitPole = new Vector3(), _wFront = new Vector3(), _wIn = new Vector3(), _wFlat = new Vector3();
const _front = new Vector3(), _goal = new Vector3(), _swivel = new Vector3(), _elbow = new Vector3(), _hand = new Vector3(), _end = new Vector3(), _axis = new Vector3(), _center = new Vector3(), _u = new Vector3(), _v = new Vector3(), _pole = new Vector3();
const _su = new Vector3(), _sv = new Vector3(), _sw = new Vector3(), _sp = new Vector3(), _sq = new Vector3();
