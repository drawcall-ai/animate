import { Euler, Quaternion, Vector3 } from 'three';
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
  /** Ask the body to help before aiming the head. */
  lead?(pose: ReadonlyPose, point: Readonly<Vector3>): void;
  /** Maximum downward world pitch (rad); keeps downward gaze upright and stabilised over a bow. */
  down?: number;
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
    /** looking over the top: pitched back past straight down or up rather than turned toward the target (null: not chosen yet) */
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
        const stabilised = gazer.down !== undefined;
        const bones = pose.skeleton.chain(gazer.neck);
        const point = live(target, f);
        gazer.lead?.(f.prev, point);
        // (a target faster than JUMP jumped: the head shifts to it, it does not pursue it)
        const distance = aimed?.distanceTo(point) ?? Infinity;
        const jumped = distance > JUMP * f.dt;
        (aimed ??= new Vector3()).copy(point);
        // Carry the last final eyes forward one step; an earlier layer's temporary head pose is not the gaze being overridden.
        const origin = gazer.eyes(f.prev, _eyes);
        if (gazer.down !== undefined) origin.multiplyScalar(2).sub(gazer.eyes(f.prev2, _beforeEyes));
        const d = _d.subVectors(point, origin).normalize();
        if (d.lengthSq() === 0) return;
        // upright: turned about the vertical, then pitched (+ down); looking nearly straight up or
        // down, the way it faces eases to the neck's parent's (the target's own heading flips
        // there), then the least turn that puts the eyes on the target — either turned toward it,
        // or away and pitched back over past straight down or up (a point just behind the feet)
        const parent = pose.skeleton.bones[bones[0]].parent;
        const right = _f.set(1, 0, 0).applyQuaternion(pose.rotation(parent));
        const facing = Math.atan2(-right.z, right.x);
        const ways = (line: Vector3) => {
          const vertical = smoothstep(0.1, 0.35, Math.hypot(line.x, line.z));
          const toward = wrap(Math.atan2(line.x, line.z) - facing);
          upright(line, facing + toward * vertical, _q);
          upright(line, facing + wrap(toward + Math.PI) * vertical, _o);
        };
        ways(d);
        // (of the two, first the lesser turn from the neck's parent; then the one taken kept until the
        // other, within the neck's range, leaves the eyes HYSTERESIS less of their range to turn: it
        // never alternates between them as the body sways)
        const turned = pose.rotation(parent);
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
        const eyes = Math.min(EYES * Math.abs(aside), EYES_MOST * gazer.range.side * Math.max(0, 1 - strained));
        if (!over) ways(_line.copy(d).applyAxisAngle(Y, -Math.sign(aside) * eyes));
        const goal = over ? _o : _q;
        if (gazer.down !== undefined && d.y < -0.5) downward(gazer, pose, bones, turned, facing, d, gazer.down, goal);
        const whole = stabilised ? _rel.copy(goal) : _rel.copy(turned).invert().multiply(goal);
        // (the whole turn followed once from the neck's history, then shared evenly down it, each
        // joint stopped at its range's end: the head turns at the gaze shift's pace, however many
        // joints share it — as fast as the shift is large (`headPace`), at most `motion`'s)
        const last = bones[bones.length - 1];
        const was = stabilised ? _was.copy(f.prev.rotation(last)) : relative(f.prev, parent, last, _was);
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
        const before = stabilised ? _was2.copy(f.prev2.rotation(last)) : relative(f.prev2, parent, last, _was2);
        const followed = followRotation(before, was, whole, { ...pace, velocity: pursuit }, f.dt, _out);
        if (gazer.down !== undefined) keepUpright(pose, bones, turned, facing, followed, Math.cos(gazer.down));
        if (stabilised) followed.premultiply(_rel.copy(turned).invert());
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

/** Joint limits can turn a world-upright goal over; project the solved neck back into upright posture. */
function keepUpright(pose: ReadonlyPose, bones: readonly number[], parent: Readonly<Quaternion>, facing: number, goal: Quaternion, leastUp: number) {
  const up = (q: Quaternion) => _up.set(0, 1, 0).applyQuaternion(within(pose, bones, parent, q, _within)).y;
  if (up(goal) >= leastUp) return;
  _level.setFromAxisAngle(Y, facing);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    if (up(_safe.copy(goal).slerp(_level, mid)) >= leastUp) hi = mid;
    else lo = mid;
  }
  goal.slerp(_level, hi);
}

/** An upright downward goal within the neck's ROM, with the least work left for the eyes. */
function downward(gazer: Gazer, pose: ReadonlyPose, bones: readonly number[], parent: Readonly<Quaternion>, facing: number, d: Vector3, most: number, out: Quaternion) {
  let yaw = facing;
  let least = Infinity;
  const goal = (angle: number) => _down.setFromEuler(_e.set(Math.min(most, Math.atan2(-d.y, d.x * Math.sin(angle) + d.z * Math.cos(angle))), angle, 0, 'YXZ'));
  const tryYaw = (angle: number) => {
    const cost = strain(gazer, pose, bones, parent, goal(angle), d) + 0.01 * Math.abs(angle - facing);
    if (_up.set(0, 1, 0).applyQuaternion(_actual.copy(_within).invert()).y < Math.cos(most)) return;
    if (cost < least) { least = cost; yaw = angle; }
  };
  for (let k = -6; k <= 6; k++) tryYaw(facing + k * Math.PI / 12);
  for (let step = Math.PI / 24; step > 0.005; step /= 2) {
    const center = yaw;
    tryYaw(center - step);
    tryYaw(center + step);
  }
  out.copy(goal(yaw));
}

/** how far (rad) a gazer's eyes are off `point` (world): the head's line off it, less what the eyes take of a gaze shift at most (`lookAt`) */
export function gazeOff(gazer: Gazer, pose: ReadonlyPose, point: Readonly<Vector3>): number {
  const bones = pose.skeleton.chain(gazer.neck);
  const ahead = _f.set(0, 0, 1).applyQuaternion(pose.rotation(bones[bones.length - 1]));
  return Math.max(0, ahead.angleTo(_d.subVectors(point, gazer.eyes(pose, _eyes))) - EYES_MOST * gazer.range.side);
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

/** the turn from bone `from` to bone `to` in `pose` (into `out`) */
function relative(pose: ReadonlyPose, from: number, to: number, out: Quaternion): Quaternion {
  return out.copy(pose.rotation(from)).invert().multiply(pose.rotation(to));
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

const _e = new Euler();
const _down = new Quaternion();
const _actual = new Quaternion();
const _level = new Quaternion();
const _safe = new Quaternion();
const _up = new Vector3();
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const _d = new Vector3();
const _eyes = new Vector3();
const _beforeEyes = new Vector3();
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
const _line = new Vector3();
const _spin = new Vector3();
const _was = new Quaternion();
const _was2 = new Quaternion();
