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
}

/** how fast a head turns to look (rad/s², rad/s): a brisk gaze shift */
export const GLANCE = { turnAccel: 40, turnSpeed: 6 };

/**
 * The gazer's eyes on `target` (world), the head upright (rest: facing +Z, +Y up), every sub-step,
 * endless: the turn from the neck's parent shared evenly over the neck chain's bones, each within
 * its limit and turned on from its history at `motion`'s pace.
 */
export function lookAt<W>(gazer: Gazer, target: Live<Vector3, W>, motion: Required<Pick<Motion, 'turnAccel'>> & Pick<Motion, 'turnSpeed'> = GLANCE): Behaviour<W> {
  const turn = { accel: motion.turnAccel, speed: motion.turnSpeed };
  return function* () {
    yield* action<Frame<W>>({
      update: (f) => {
        const pose = f.current;
        const bones = pose.skeleton.chain(gazer.neck);
        const d = _d.subVectors(live(target, f), gazer.eyes(pose, _eyes));
        const across = Math.hypot(d.x, d.z);
        if (across + Math.abs(d.y) < 1e-6) return;
        // upright: turned about the vertical, then pitched (+ down); looking nearly straight up or
        // down, the way it faces is the neck's parent's (the target's own heading flips there), and
        // it pitches in that plane (past straight down for a target below and behind)
        const parent = pose.skeleton.bones[bones[0]].parent;
        const turned = pose.rotation(parent);
        const ahead = _f.set(0, 0, 1).applyQuaternion(turned);
        const facing = Math.atan2(ahead.x, ahead.z);
        const vertical = smoothstep(0.1, 0.35, across / d.length());
        // (turned toward the target's heading, or away from it pitched back over past straight
        // down or up: of the two, the nearer the parent's turn)
        const toward = wrap(Math.atan2(d.x, d.z) - facing);
        upright(d, facing + toward * vertical, _q);
        upright(d, facing + wrap(toward + Math.PI) * vertical, _o);
        if (_o.angleTo(turned) < _q.angleTo(turned)) _q.copy(_o);
        const rel = _rel.copy(pose.rotation(parent)).invert().multiply(_q);
        const share = _share.identity().slerp(rel, 1 / bones.length);
        for (const b of bones) {
          const limit = pose.skeleton.limits[b];
          const goal = _goal.copy(share);
          if (limit) clampRotation(goal, limit);
          const q = followRotation(f.prev2.local(b), f.prev.local(b), goal, turn, f.dt, _out);
          if (limit) clampRotation(q, limit);
          pose.setLocal(b, q);
        }
      },
    });
  };
}

/** looking along `d` turned `yaw` about the vertical, then pitched in that plane (+ down, past straight down for `d` behind it), into `out` */
function upright(d: Vector3, yaw: number, out: Quaternion): Quaternion {
  const pitch = Math.atan2(-d.y, d.x * Math.sin(yaw) + d.z * Math.cos(yaw));
  return out.setFromAxisAngle(Y, yaw).multiply(_p.setFromAxisAngle(X, pitch));
}

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const _d = new Vector3();
const _eyes = new Vector3();
const _q = new Quaternion();
const _p = new Quaternion();
const _o = new Quaternion();
const _f = new Vector3();
const wrap = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};
const _rel = new Quaternion();
const _share = new Quaternion();
const _goal = new Quaternion();
const _out = new Quaternion();
