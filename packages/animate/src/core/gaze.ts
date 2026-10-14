import { Quaternion, Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import type { Frame } from './body';
import { followRotation } from './follow';
import { live, type Behaviour, type Live, type Motion } from './goal';
import { clampRotation } from './limits';
import type { ReadonlyPose } from './pose';

/** What looks: a chain of the skeleton from the neck's base up to the head, and where its eyes are. */
export interface Gazer {
  /** the chain that turns the head */
  neck: string;
  /** the point the eyes look from (world), into `out` */
  eyes(pose: ReadonlyPose, out: Vector3): Vector3;
  /** how far the eyes turn in the head comfortably (rad): what a head short of its target leaves them */
  range: { down: number; up: number; side: number };
}

/** how fast a head turns to look about (rad/s², rad/s): a glance aside */
export const GLANCE = { turnAccel: 40, turnSpeed: 6 };
/**
 * how fast a head turns to what the hands go for (rad/s², rad/s): a large gaze shift's head,
 * ~3400°/s² and ~340°/s at its peak (recalled from Guitton & Volle 1987, J Neurophysiol 58:427,
 * not checked against the paper; head peaks in large shifts grow ~2.3°/s per degree of the
 * shift, 100–350°/s)
 */
export const SHIFT = { turnAccel: 60, turnSpeed: 6 };

/**
 * The gazer's eyes on `target` (world), the head upright (rest: facing +Z, +Y up), every sub-step,
 * endless: the turn from the neck's parent shared evenly over the neck chain's bones, each within
 * its limit and turned on from its history at `motion`'s pace.
 */
export function lookAt<W>(gazer: Gazer, target: Live<Vector3, W>, motion: Required<Pick<Motion, 'turnAccel'>> & Pick<Motion, 'turnSpeed'> = GLANCE): Behaviour<W> {
  const turn = { accel: motion.turnAccel, speed: motion.turnSpeed };
  return function* () {
    /** looking over the top: pitched back past straight down or up rather than turned toward the target (null: not chosen yet) */
    let over: boolean | null = null;
    yield* action<Frame<W>>({
      update: (f) => {
        const pose = f.current;
        const bones = pose.skeleton.chain(gazer.neck);
        const d = _d.subVectors(live(target, f), gazer.eyes(pose, _eyes)).normalize();
        if (d.lengthSq() === 0) return;
        // upright: turned about the vertical, then pitched (+ down); looking nearly straight up or
        // down, the way it faces eases to the neck's parent's (the target's own heading flips
        // there), then the least turn that puts the eyes on the target — either turned toward it,
        // or away and pitched back over past straight down or up (a point just behind the feet)
        const parent = pose.skeleton.bones[bones[0]].parent;
        const ahead = _f.set(0, 0, 1).applyQuaternion(pose.rotation(parent));
        const facing = Math.atan2(ahead.x, ahead.z);
        const vertical = smoothstep(0.1, 0.35, Math.hypot(d.x, d.z));
        const toward = wrap(Math.atan2(d.x, d.z) - facing);
        upright(d, facing + toward * vertical, _q);
        upright(d, facing + wrap(toward + Math.PI) * vertical, _o);
        // (of the two, first the lesser turn from the neck's parent; then the one taken kept until the
        // other, within the neck's range, leaves the eyes HYSTERESIS less of their range to turn: it
        // never alternates between them as the body sways)
        const turned = pose.rotation(parent);
        over ??= _o.angleTo(turned) < _q.angleTo(turned);
        const [kept, other] = over ? [_o, _q] : [_q, _o];
        if (strain(gazer, pose, bones, turned, other, d) < strain(gazer, pose, bones, turned, kept, d) - HYSTERESIS) over = !over;
        // (the turn from the neck's parent shared evenly down the neck, followed once from the
        // first bone's history: every joint turns at `motion`'s pace, stopped at its range's end)
        const share = _share.identity().slerp(_rel.copy(turned).invert().multiply(over ? _o : _q), 1 / bones.length);
        const first = pose.skeleton.limits[bones[0]];
        if (first) clampRotation(share, first);
        const followed = followRotation(f.prev2.local(bones[0]), f.prev.local(bones[0]), share, turn, f.dt, _out);
        for (const b of bones) {
          const limit = pose.skeleton.limits[b];
          const local = _goal.copy(followed);
          if (limit) clampRotation(local, limit);
          pose.setLocal(b, local);
        }
      },
    });
  };
}

/** how much less of the eyes' range (share of it) the other way of looking at a point must leave them to be taken */
const HYSTERESIS = 0.3;

/**
 * how much of the eyes' range (1: all of it) the head, turned toward `goal` (world) from `parent`'s
 * turn shared over the neck's `bones` each within its limit, leaves them to look along `d` (unit)
 */
function strain(gazer: Gazer, pose: ReadonlyPose, bones: readonly number[], parent: Readonly<Quaternion>, goal: Quaternion, d: Vector3): number {
  const l = _l.copy(d).applyQuaternion(within(pose, bones, parent, goal, _within).invert());
  const side = Math.atan2(l.x, l.z);
  const down = Math.atan2(-l.y, Math.hypot(l.x, l.z));
  const { range } = gazer;
  return Math.hypot(side / range.side, down / (down > 0 ? range.down : range.up));
}

/** the head's turn (world, into `out`) toward `goal` from `parent`'s, the turn shared evenly over the neck's `bones`, each within its limit */
function within(pose: ReadonlyPose, bones: readonly number[], parent: Readonly<Quaternion>, goal: Quaternion, out: Quaternion): Quaternion {
  const share = _share.identity().slerp(_rel.copy(parent).invert().multiply(goal), 1 / bones.length);
  out.copy(parent);
  for (const b of bones) {
    const limit = pose.skeleton.limits[b];
    const local = _goal.copy(share);
    if (limit) clampRotation(local, limit);
    out.multiply(local);
  }
  return out;
}

/**
 * looking along `d` (unit), turned `yaw` about the vertical and pitched in that plane (+ down, past
 * straight down for `d` behind it), then turned the least way onto `d` (off that plane only where
 * the yaw eased off its heading: nearly straight up or down), into `out`
 */
function upright(d: Vector3, yaw: number, out: Quaternion): Quaternion {
  const pitch = Math.atan2(-d.y, d.x * Math.sin(yaw) + d.z * Math.cos(yaw));
  out.setFromAxisAngle(Y, yaw).multiply(_p.setFromAxisAngle(X, pitch));
  return out.premultiply(_p.setFromUnitVectors(_l.set(0, 0, 1).applyQuaternion(out), d));
}

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const _d = new Vector3();
const _eyes = new Vector3();
const _q = new Quaternion();
const _p = new Quaternion();
const _o = new Quaternion();
const _f = new Vector3();
const _l = new Vector3();
const wrap = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};
const _rel = new Quaternion();
const _share = new Quaternion();
const _goal = new Quaternion();
const _out = new Quaternion();
const _within = new Quaternion();
