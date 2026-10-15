import { Quaternion, Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import type { Frame } from './body';
import { followRotation } from './follow';
import { live, type Behaviour, type Live, type Motion } from './goal';
import { clampRotation } from './limits';
import { spinOf } from './rotation';
import type { ReadonlyPose } from './pose';

/** What looks: a chain of the skeleton from the neck's base up to the head, and where its eyes are. */
export interface Gazer {
  /** the chain that turns the head */
  neck: string;
  /** the point the eyes look from (world), into `out` */
  eyes(pose: ReadonlyPose, out: Vector3): Vector3;
  /** how far the eyes turn in the head comfortably (rad): what a head short of its target leaves them */
  range: { down: number; up: number; side: number };
  /** Comfortable cervical flexion (rad); unbounded for a chain without a posture preference. */
  pitch?: number;
  /** Ask the body to help before aiming the head. */
  lead?(pose: ReadonlyPose, point: Readonly<Vector3>): void;
}

/** the most a head turns to look about (rad/s², rad/s): a glance aside, at most */
export const GLANCE = { turnAccel: 40, turnSpeed: 6 };
/**
 * the most a head turns to what the hands go for (rad/s², rad/s): a large brisk gaze shift's head,
 * ~3400°/s² and ~340°/s at its peak (recalled from Guitton & Volle 1987, J Neurophysiol 58:427,
 * not checked against the paper)
 */
export const SHIFT = { turnAccel: 60, turnSpeed: 6 };

/**
 * The gazer's eyes on `target` (world), the head upright (rest: facing +Z, +Y up), every sub-step,
 * endless. The head turns most of the way and the eyes the rest (a quarter, a few degrees at most:
 * a large shift ends with the eyes a little off the head's line). The neck's whole turn is followed
 * from its history as fast as the gaze shift is large (the head's main sequence: a small look
 * slowly, a large one briskly, a bell either way), at most at `motion`'s pace, and shared evenly
 * over the neck chain's bones, each within its limit.
 */
export function lookAt<W>(gazer: Gazer, target: Live<Vector3, W>, motion: Required<Pick<Motion, 'turnAccel'>> & Pick<Motion, 'turnSpeed'> = GLANCE): Behaviour<W> {
  return function* () {
    let over: boolean | null = null;
    /** the gaze shift under way: the most the head has had to turn since it last settled (rad) */
    let shift = 0;
    /** the head's goal the sub-step before (null: none yet) */
    let seen: Quaternion | null = null;
    /** the target's turn followed the sub-step before (rad/s) */
    const pursued = new Vector3();
    /** where the target was the sub-step before (null: not yet seen) */
    let aimed: Vector3 | null = null;
    yield* action<Frame<W>>({
      update: (f) => {
        const pose = f.current;
        const bones = pose.skeleton.chain(gazer.neck);
        const point = live(target, f);
        gazer.lead?.(f.prev, point);
        // (a target faster than JUMP jumped: the head shifts to it, it does not pursue it)
        const distance = aimed?.distanceTo(point) ?? Infinity;
        const jumped = distance > JUMP * f.dt;
        (aimed ??= new Vector3()).copy(point);
        // Carry the last final eyes forward one step; an earlier layer's temporary head pose is not the gaze being overridden.
        const base = bones[0];
        const parentBone = pose.skeleton.bones[base].parent;
        const carried = _rel.copy(pose.rotation(parentBone)).multiply(_p.copy(f.prev.rotation(parentBone)).invert());
        const origin = gazer.eyes(f.prev, _eyes).sub(f.prev.position(base)).applyQuaternion(carried).add(pose.position(base));
        const d = _d.subVectors(point, origin).normalize();
        if (d.lengthSq() === 0) return;
        // upright: turned about the vertical, then pitched (+ down); looking nearly straight up or
        // down, the way it faces eases to the neck's parent's (the target's own heading flips
        // there), then the least turn that puts the eyes on the target — either turned toward it,
        // or away and pitched back over past straight down or up (a point just behind the feet)
        const parent = pose.skeleton.bones[bones[0]].parent;
        const right = _f.set(1, 0, 0).applyQuaternion(pose.rotation(parent));
        const facing = Math.atan2(-right.z, right.x);
        const turned = pose.rotation(parent);
        const local = _line.copy(d).applyQuaternion(_rel.copy(turned).invert());
        // Preferred eye declination saves neck flexion; upward shifts retain the eyes' pursuit range.
        const down = Math.max(0, Math.atan2(-local.y, Math.hypot(local.x, local.z)));
        const effort = Math.min(1, down / (gazer.pitch ?? Infinity));
        const eyePitch = Math.min(gazer.range.down, Math.max(EYES * down * effort, gazer.range.down * effort ** 2));
        const ways = (line: Vector3) => {
          const vertical = smoothstep(0.1, 0.35, Math.hypot(line.x, line.z));
          const toward = wrap(Math.atan2(line.x, line.z) - facing);
          upright(line, facing + toward * vertical, _q);
          upright(line, facing + wrap(toward + Math.PI) * vertical, _o);
          _q.multiply(_p.setFromAxisAngle(X, -eyePitch));
          _o.multiply(_p);
        };
        ways(d);
        over ??= _o.angleTo(turned) < _q.angleTo(turned);
        const [kept, other] = over ? [_o, _q] : [_q, _o];
        const strained = strain(gazer, pose, bones, turned, kept, d);
        if (strain(gazer, pose, bones, turned, other, d) < strained - HYSTERESIS) over = !over;
        // (the head's line, the way taken: the eyes take the rest of a turn aside, EYES of it from
        // where the neck's parent faces and no more than EYES_MOST of what is left of their range
        // where the neck stops short — a large shift ends with the eyes a little off the head's
        // line; up or down, and looking over the top, the head all the way: the neck pitches
        // nearer its stops, and the eyes have little to spare there)
        const aside = wrap(Math.atan2(d.x, d.z) - facing);
        const eyes = Math.min(EYES * Math.abs(aside), EYES_MOST * gazer.range.side * Math.max(0, 1 - strained) * Math.sqrt(Math.max(0, 1 - (eyePitch / gazer.range.down) ** 2)));
        if (!over) ways(_line.copy(d).applyAxisAngle(Y, -Math.sign(aside) * eyes));
        // Follow in world space so the trunk can move beneath a steady gaze.
        const whole = _whole.copy(over ? _o : _q);
        // (the whole turn followed once from the neck's history, then shared evenly down it, each
        // joint stopped at its range's end: the head turns at the gaze shift's pace, however many
        // joints share it — as fast as the shift is large (`headPace`), at most `motion`'s)
        const last = bones[bones.length - 1];
        const was = _was.copy(f.prev.rotation(last));
        const gap = was.angleTo(whole);
        shift = gap > shift || gap < SETTLED ? gap : shift;
        // (a target moving smoothly is pursued: its own turn followed without lag, at most at
        // `motion`'s speed; and as it speeds up or slows, the head with it: its own acceleration on
        // top of the shift's)
        const pursuit = jumped || !seen ? _spin.set(0, 0, 0) : spinOf(seen, whole, f.dt, _spin).clampLength(0, motion.turnSpeed ?? Infinity);
        (seen ??= new Quaternion()).copy(whole);
        const speeding = pursuit.distanceTo(pursued) / f.dt;
        pursued.copy(pursuit);
        const pace = headPace(shift, motion);
        pace.accel = Math.min(motion.turnAccel, pace.accel + speeding);
        const before = _was2.copy(f.prev2.rotation(last));
        const followed = followRotation(before, was, whole, { ...pace, velocity: pursuit }, f.dt, _out);
        followed.premultiply(_rel.copy(turned).invert());
        const share = _share.identity().slerp(followed, 1 / bones.length);
        for (const b of bones) {
          const limit = pose.skeleton.limits[b];
          const local = _goal.copy(share);
          if (limit) clampRotation(local, limit);
          pose.setLocal(b, local);
        }
      },
    });
  };
}

/** how far (rad) a gazer's eyes are off `point` (world): the head's line off it, less what the eyes take of a gaze shift at most (`lookAt`) */
export function gazeOff(gazer: Gazer, pose: ReadonlyPose, point: Readonly<Vector3>): number {
  const bones = pose.skeleton.chain(gazer.neck);
  const head = pose.rotation(bones[bones.length - 1]);
  const d = _d.subVectors(point, gazer.eyes(pose, _eyes)).applyQuaternion(_rel.copy(head).invert());
  const off = Math.atan2(Math.hypot(d.x, d.y), d.z);
  const side = Math.atan2(d.x, d.z) / gazer.range.side;
  const pitch = Math.atan2(-d.y, Math.hypot(d.x, d.z));
  const used = Math.hypot(side, pitch / (pitch > 0 ? gazer.range.down : gazer.range.up));
  return used > 1 ? off * (1 - 1 / used) : 0;
}

/** how much of a gaze shift the eyes take (the head turns the rest: 70–80% of a large shift), and how much of their comfortable range at most */
const EYES = 0.25;
const EYES_MOST = 0.3;
/** a gaze shift is over once the head is this near where it goes (rad): the next sets its own pace */
const SETTLED = (2 * Math.PI) / 180;
/** how fast a target moves at most and is still pursued (m/s): faster, it jumped (5 cm in a 60 Hz step) */
const JUMP = 3;
/**
 * a head's peak speed in a gaze shift (its main sequence): `least` (rad/s) and `slope` more per
 * radian of the shift — 100°/s and 2.3°/s per degree, so 150°/s for 20°, 300°/s for 90° (recalled,
 * not checked: Guitton & Volle 1987, head peaks 100–350°/s growing ~2.3°/s per degree in large
 * shifts; read: in active tasks head speeds of ~90–180°/s, Freedman 2008's review via its summary.
 * Self-paced shifts can be slower: Bayer & Zimmermann 2024, R Soc Open Sci 11:231545, read, the
 * head 18.8° at 37°/s — a body looking at what it works on is not idling)
 */
const HEAD_SEQUENCE = { least: 1.75, slope: 2.3 };
/**
 * the pace of a head turning a gaze shift of `shift` (rad): its peak speed as the shift is large
 * (`HEAD_SEQUENCE`), and the acceleration that gets it there (`BELL`) — within `motion`'s
 */
function headPace(shift: number, motion: Required<Pick<Motion, 'turnAccel'>> & Pick<Motion, 'turnSpeed'>): { accel: number; speed: number } {
  const speed = Math.min(motion.turnSpeed ?? Infinity, HEAD_SEQUENCE.least + HEAD_SEQUENCE.slope * shift);
  return { speed, accel: Math.min(motion.turnAccel, Math.max((BELL * speed * speed) / Math.max(shift, 1e-3), BRAKE)) };
}

/** the least acceleration a head turns with (rad/s²): what brings it to rest on a target that moves on */
const BRAKE = 4;
/** how briskly the head gets up to its peak: 1.5 v² / shift reaches it a third of the way, holds it a third and brakes the last (a bell flattened a little: the eyes' line gets there within ~0.6 s of a large shift's start) */
const BELL = 1.5;

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
const _line = new Vector3();
const _spin = new Vector3();
const _was = new Quaternion();
const _was2 = new Quaternion();

const _whole = new Quaternion();

const _o = new Quaternion();
const HYSTERESIS = 0.3;
