import { Quaternion, Vector3 } from 'three';
import { clamp, lerp, wrapAngle, smoothstep } from './math';
import { seeded, seedOf } from './random';
import { when } from './when';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import type { Body, Frame } from './body';
import { followRotation } from './follow';
import { live, type Behaviour, type Live, type Motion } from './goal';
import { clampRotation } from './limits';
import { spinOf } from './rotation';
import type { ReadonlyPose } from './pose';
import { request } from './asks';

/** What looks: a chain of the skeleton from the neck's base up to the head, and where its eyes are. */
export interface Gazer {
  /** the chain that turns the head; without one, the species' posture turns it toward where the eyes are asked (`asks.look`) */
  neck?: string;
  /** the point the eyes look from (world), into `out` */
  eyes(pose: ReadonlyPose, out: Vector3): Vector3;
  /** how far the eyes turn in the head comfortably (rad): what a head short of its target leaves them */
  range: { down: number; up: number; side: number };
  /** Comfortable cervical flexion (rad); unbounded for a chain without a posture preference. */
  pitch?: number;
  /** Ask the body to help before aiming the head. */
  lead?(body: Body, pose: ReadonlyPose, point: Readonly<Vector3>): void;
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
 * The body's eyes (`Species.gaze`) on `target` (world), the head upright (rest: facing +Z, +Y up), every sub-step,
 * endless. The head turns most of the way and the eyes the rest (a quarter, a few degrees at most:
 * a large shift ends with the eyes a little off the head's line). The neck's whole turn is followed
 * from its history as fast as the gaze shift is large (the head's main sequence: a small look
 * slowly, a large one briskly, a bell either way), at most at `motion`'s pace, and shared evenly
 * over the neck chain's bones, each within its limit.
 */
export function lookAt(body: Body, target: Live<Vector3>, motion: Required<Pick<Motion, 'turnAccel'>> & Pick<Motion, 'turnSpeed'> = GLANCE): Behaviour {
  const gazer = body.gazer, neck = gazer?.neck;
  if (!gazer) throw new Error('lookAt: the body has no gaze');
  if (neck === undefined) return function* () {
    yield* action<Frame>({ update: (f) => void (body.asks.look = live(target, f)) });
  };
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
    let eyePitch = 0, declination = 0;
    yield* action<Frame>({
      update: (f) => {
        const pose = f.current;
        const bones = pose.skeleton.chain(neck);
        const point = live(target, f);
        gazer.lead?.(body, f.prev, point);
        // (a target faster than JUMP jumped: the head shifts to it, it does not pursue it)
        const distance = aimed?.distanceTo(point) ?? Infinity;
        const jumped = distance > JUMP * f.dt;
        if (jumped) {
          // A new sight starts a gaze shift; pursuit and branch history belong to the old one.
          over = null;
          seen = null;
          pursued.set(0, 0, 0);
          shift = 0;
        }
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
        const down = Math.max(0, Math.atan2(-local.y, Math.hypot(local.x, local.z)));
        const effort = Math.min(1, down / (gazer.pitch ?? Infinity));
        const worldDown = Math.atan2(-d.y, d.x * Math.sin(facing) + d.z * Math.cos(facing));
        if (jumped || !seen) eyePitch = Math.min(gazer.range.down, Math.max(EYES * down * effort, gazer.range.down * effort ** 2));
        else if (gazer.pitch !== undefined && aimed) {
          const before = _line.subVectors(aimed, origin);
          const targetTurn = wrapAngle(worldDown - Math.atan2(-before.y, before.x * Math.sin(facing) + before.z * Math.cos(facing)));
          const change = wrapAngle(worldDown - declination);
          // Moving eyes absorb body travel; target pursuit keeps the usual eye/head share.
          const share = clamp(change - (1 - EYES) * targetTurn, Math.min(EYES * change, change), Math.max(EYES * change, change));
          eyePitch = clamp(eyePitch + share, 0, gazer.range.down);
        }
        declination = worldDown;
        (aimed ??= new Vector3()).copy(point);
        const ways = (line: Vector3) => {
          const vertical = smoothstep(0.1, 0.35, Math.hypot(line.x, line.z));
          const toward = wrapAngle(Math.atan2(line.x, line.z) - facing);
          upright(line, facing + toward * vertical, _q);
          upright(line, facing + wrapAngle(toward + Math.PI) * vertical, _o);
          _q.multiply(_p.setFromAxisAngle(X, -eyePitch));
          _o.multiply(_p);
        };
        ways(d);
        const last = bones[bones.length - 1];
        const was = _was.copy(f.prev.rotation(last));
        // Acquire from the final head history once; earlier gaze layers cannot choose the branch.
        over ??= _o.angleTo(was) < _q.angleTo(was);
        const [kept, other] = over ? [_o, _q] : [_q, _o];
        const strained = strain(gazer, pose, bones, turned, kept, point);
        if (strain(gazer, pose, bones, turned, other, point) < strained - HYSTERESIS) over = !over;
        // (the head's line, the way taken: the eyes take the rest of a turn aside, EYES of it from
        // where the neck's parent faces and no more than EYES_MOST of what is left of their range
        // where the neck stops short — a large shift ends with the eyes a little off the head's
        // line; up or down, and looking over the top, the head all the way: the neck pitches
        // nearer its stops, and the eyes have little to spare there)
        const aside = wrapAngle(Math.atan2(d.x, d.z) - facing);
        const eyes = Math.min(EYES * Math.abs(aside), EYES_MOST * gazer.range.side * Math.max(0, 1 - strained) * Math.sqrt(Math.max(0, 1 - (eyePitch / gazer.range.down) ** 2)));
        if (!over) ways(_line.copy(d).applyAxisAngle(Y, -Math.sign(aside) * eyes));
        // Follow in world space so the trunk can move beneath a steady gaze.
        const whole = _whole.copy(over ? _o : _q);
        const used = strain(gazer, pose, bones, turned, whole, point);
        if (used > 1 && eyePitch > 0) {
          // A close target can consume lateral and downward eye range together.
          // Give the head the missing declination before asking the eyes beyond their ellipse.
          const full = _full.copy(whole).multiply(_p.setFromAxisAngle(X, eyePitch));
          const best = strain(gazer, pose, bones, turned, full, point);
          if (best < used) {
            let lo = 0, hi = eyePitch;
            while (hi - lo > SETTLED) {
              const middle = (lo + hi) / 2;
              const candidate = _candidate.copy(whole).multiply(_p.setFromAxisAngle(X, middle));
              if (strain(gazer, pose, bones, turned, candidate, point) > Math.max(EYES_MOST, best)) lo = middle;
              else hi = middle;
            }
            whole.multiply(_p.setFromAxisAngle(X, hi));
            eyePitch -= hi;
          }
        }
        // (the whole turn followed once from the neck's history, then shared evenly down it, each
        // joint stopped at its range's end: the head turns at the gaze shift's pace, however many
        // joints share it — as fast as the shift is large (`headPace`), at most `motion`'s)
        // (a target moving smoothly is pursued: its own turn followed without lag, at most at
        // `motion`'s speed; and as it speeds up or slows, the head with it: its own acceleration on
        // top of the shift's)
        const pursuit = jumped || !seen ? _spin.set(0, 0, 0) : spinOf(seen, whole, f.dt, _spin).clampLength(0, motion.turnSpeed ?? Infinity);
        (seen ??= new Quaternion()).copy(whole);
        const speeding = pursuit.distanceTo(pursued) / f.dt;
        pursued.copy(pursuit);
        const gap = was.angleTo(whole);
        shift = gap > shift || gap < SETTLED ? gap : shift;
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

/** How `withGaze` leads with the eyes. */
export interface GazeOptions {
  /** with `first`, seconds more before the task sets off */
  lead?: number;
  /** bow at least this much (rad) */
  bow?: number;
  /** the task waits until the eyes are there */
  first?: boolean;
}

/**
 * `task` with the eyes on `at`. With `first: true`, `task` sets off once they are within 1° of comfortable eye range or after 1.2 s, and
 * a moment more, `lead` s (default 0.1–0.3 s, seeded by where `at` is) — the eyes reach what the
 * hand goes for ~0.5 s before it (Land & Hayhoe 2001) — and they stay till it ends. For a point
 * further below the eyes than the neck pitches the head, the body bows to see it (asking the base),
 * or at least `bow` (rad: work at the waist, the eyes over the hands). By default
 * `task` sets off at once (the eyes on what the hands already work). Put it after the
 * base (its `lookAt` overrides `lookAround`'s).
 */
export function withGaze(h: Body, at: Live<Vector3>, task: Behaviour, options: GazeOptions = {}): Behaviour {
  const { bow = 0, first = false } = options;
  return function* () {
    yield* parallel<Frame>(
      'race',
      function* () {
        if (first) yield* gazeLead(h, at, options.lead)();
        yield* task();
      },
      lookAt(h, at, SHIFT),
      action<Frame>({ update: () => request(h.asks, { bow }) }),
    );
  };
}

/** Wait for the current gaze before starting a task; does not own or move the eyes. */
export function gazeLead(h: Body, at: Live<Vector3>, seconds = NaN): Behaviour {
  const gazer = h.gazer;
  if (!gazer) throw new Error('gazeLead: the body has no gaze');
  return function* () {
    let lead = seconds;
    yield* when((f, _, time) => {
      const point = live(at, f);
      if (Number.isNaN(lead)) lead = lerp(LEAD[0], LEAD[1], seeded(seedOf(Math.round(point.x * 1000), Math.round(point.y * 1000), Math.round(point.z * 1000)))());
      // (a gaze without a neck chain — its posture turns the head — gives the time it takes a head to turn)
      return time > LONGEST || (gazer.neck !== undefined && gazeOff(gazer, f.prev, point) < ARRIVED);
    });
    yield* when(timePassed(lead, 'seconds'));
  };
}

/** the eyes have got where they look: within this of it (rad, 1°), or looked toward it this long (s: a point the head cannot turn to); and how long after that a task they lead sets off (s) */
const ARRIVED = Math.PI / 180;
const LONGEST = 1.2;
const LEAD = [0.1, 0.3];

/** Upper-body aim, with the gait's counter-rotation and balance preserved.
 * Recalled: Epic Games, Unreal Engine “Aim Offset”: additive aim over the spine and neck.
 * Tuned torso shares: 65% yaw, 25% pitch; the base shares them over spine/chest,
 * gaze handles neck/head/eyes. Pitch recruits less trunk so looking down does not become a bow.
 */
export function aimAt(h: Body, at: Live<Vector3>): Behaviour {
  const gazer = h.gazer;
  if (!gazer) throw new Error('aimAt: the body has no gaze');
  return function* () {
    yield* parallel<Frame>('all', lookAt(h, at, SHIFT), action<Frame>({ update: (f) => {
      const direction = live(at, f).clone().sub(gazer.eyes(f.prev, new Vector3()));
      const yaw = wrapAngle(Math.atan2(direction.x, direction.z) - h.locomotion.facing);
      const pitch = -Math.atan2(direction.y, Math.hypot(direction.x, direction.z));
      // Derived: two 25° axial joint ranges, leaving 5° for gait counter-rotation.
      request(h.asks, { twist: Math.max(-Math.PI / 4, Math.min(Math.PI / 4, 0.65 * yaw)), bow: 0.25 * pitch });
    } }));
  };
}

/** how far (rad) a gazer's eyes are off `point` (world): the head's line off it, less what the eyes take of a gaze shift at most (`lookAt`) */
export function gazeOff(gazer: Gazer, pose: ReadonlyPose, point: Readonly<Vector3>): number {
  if (gazer.neck === undefined) throw new Error('gazeOff: the gaze has no neck');
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
 * turn shared over the neck's `bones` each within its limit, leaves them to look at `point` (world)
 */
function strain(gazer: Gazer, pose: ReadonlyPose, bones: readonly number[], parent: Readonly<Quaternion>, goal: Quaternion, point: Readonly<Vector3>): number {
  const last = bones[bones.length - 1];
  const offset = gazer.eyes(pose, _eyeOffset).sub(pose.position(last)).applyQuaternion(_rel.copy(pose.rotation(last)).invert());
  const turn = within(pose, bones, parent, goal, _within, _eyeOrigin.copy(pose.position(bones[0])));
  _eyeOrigin.add(offset.applyQuaternion(turn));
  const local = _l.copy(point).sub(_eyeOrigin).applyQuaternion(_rel.copy(turn).invert());
  const side = Math.atan2(local.x, local.z);
  const down = Math.atan2(-local.y, Math.hypot(local.x, local.z));
  return Math.hypot(side / gazer.range.side, down / (down > 0 ? gazer.range.down : gazer.range.up));
}

/** The head's turn (world, into `out`) toward `goal` from `parent`'s, shared evenly over the neck's `bones`, each within its limit.
 * Given `at`, advance it from the chain's base to the head's origin under that turn. */
function within(pose: ReadonlyPose, bones: readonly number[], parent: Readonly<Quaternion>, goal: Quaternion, out: Quaternion, at?: Vector3): Quaternion {
  const share = _share.identity().slerp(_rel.copy(parent).invert().multiply(goal), 1 / bones.length);
  out.copy(parent);
  for (const b of bones) {
    if (at && b !== bones[0]) at.add(_offset.copy(pose.skeleton.bones[b].offset).applyQuaternion(out));
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

const _offset = new Vector3();

const _eyeOffset = new Vector3();
const _eyeOrigin = new Vector3();

const _full = new Quaternion();
const _candidate = new Quaternion();
