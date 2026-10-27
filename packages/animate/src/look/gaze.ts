import { Euler, Quaternion, Vector3 } from 'three';
import { clamp, headingOf, wrapAngle, smoothstep, yawOf } from '../kernel/math';
import { action } from '@pmndrs/timeline';
import { during, type Request } from '../kernel/requests';
import type { Frame, Step } from '../kernel/frame';
import { follow, followRotation } from '../kernel/follow';
import type { Motion } from '../kernel/goal';
import { limited } from '../kernel/limits';
import { spinOf } from '../kernel/rotation';
import type { ReadonlyPose } from '../kernel/pose';
import type { Poise } from '../kernel/poise';
import type { Gazer } from '../species/define';
import type { Locomotion } from '../legs/locomotion';

/** A body as its eyes see it: its gaze, where a neckless species' posture turns its head, its poise and its walk. */
export interface Looker {
  readonly gazer?: Gazer;
  look: Readonly<Vector3> | null;
  readonly poise: Poise;
  readonly locomotion: Locomotion;
  /** asks the body to come along before the head aims at `point` (a person bows to see low down) */
  lead?(pose: ReadonlyPose, point: Readonly<Vector3>): void;
}

/** Horizontal view cone (rad, ~80° each side): neck and head turn ~75°, with the eyes taking the rest. */
const IN_VIEW = 1.4;

/** whether `point` is in view of the body as it faces (from where its weight was the sub-step before) */
export function inView(self: Looker, point: Readonly<Vector3>, f: Frame): boolean {
  const com = f.prev.com(_com);
  return Math.abs(wrapAngle(headingOf(point.x - com.x, point.z - com.z) - self.locomotion.facing)) < IN_VIEW;
}

/** Borrow gaze only once `seen` (default: target) is visible, unless `anyway` permits it sooner. */
export function* noticing(self: Looker, request: Request, target: (f: Frame) => Readonly<Vector3>, { seen = target, anyway }: { seen?: (f: Frame) => Readonly<Vector3>; anyway?: () => boolean } = {}) {
  yield* action<Frame>({ until: (f) => anyway?.() || inView(self, seen(f), f) });
  yield* during(request, 'look', 'borrowed', looking(self, target, SHIFT));
}

/** how fast a head may turn (rad/s², rad/s) */
type HeadMotion = Required<Pick<Motion, 'turnAccel'>> & Pick<Motion, 'turnSpeed'>;

/** the most a head turns to look about (rad/s², rad/s): a glance aside, at most */
const GLANCE = { turnAccel: 40, turnSpeed: 6 };
/**
 * the most a head turns to what the hands go for (rad/s², rad/s): a large brisk gaze shift's head, ~3400°/s² and ~340°/s at its peak
 * (recalled from Guitton & Volle 1987, J Neurophysiol 58:427, not checked against the paper)
 */
export const SHIFT = { turnAccel: 60, turnSpeed: 6 };

/** Keep the eyes on a world target, sharing the braked head turn evenly over the neck chain within joint limits; EYES takes the remainder. */
export function looking(self: Looker, target: (f: Frame) => Readonly<Vector3>, motion: HeadMotion = GLANCE): Step {
  const gazer = self.gazer, neck = gazer?.neck;
  if (!gazer) throw new Error('lookAt: the body has no gaze');
  if (neck === undefined) return (f) => void (self.look = target(f));
  let over: boolean | null = null;
  /** the gaze shift under way: the most the head has had to turn since it last settled (rad) */
  let shift = 0;
  /** the head's goal the sub-step before (null: none yet), and in its own angles (`fick`; null: not followed in them) */
  let seen: Quaternion | null = null;
  let sighted: Vector3 | null = null;
  /** the target's turn followed the sub-step before (rad/s) */
  const pursued = new Vector3();
  /** where the target was the sub-step before (null: not yet seen) */
  let aimed: Vector3 | null = null;
  let eyePitch = 0, declination = 0;
  return (f) => {
    const pose = f.current;
    const bones = pose.skeleton.chain(neck);
    const point = target(f);
    self.lead?.(f.prev, point);
    // (a target faster than JUMP jumped: the head shifts to it, it does not pursue it; a new sight starts a gaze shift)
    const jumped = (aimed?.distanceTo(point) ?? Infinity) > JUMP * f.dt;
    if (jumped) {
      over = null;
      seen = null;
      pursued.set(0, 0, 0);
      shift = 0;
    }
    // (the eyes where the final pose had them, carried on with the neck's parent: an earlier layer's head pose is not the gaze)
    const base = bones[0];
    const parent = pose.skeleton.bones[base].parent;
    const turned = pose.rotation(parent);
    const carried = _rel.copy(turned).multiply(_p.copy(f.prev.rotation(parent)).invert());
    const origin = gazer.eyes(f.prev, _eyes).sub(f.prev.position(base)).applyQuaternion(carried).add(pose.position(base));
    const d = _d.subVectors(point, origin).normalize();
    if (d.lengthSq() === 0) return;
    // (upright, `upright`: the way it faces easing to the neck's parent's nearly straight up or down; toward the target, or away and
    // pitched back over for a point just behind the feet)
    const facing = yawOf(turned);
    const strainOf = (head: Quaternion) => strain(gazer, pose, bones, turned, head, point);
    const local = _line.copy(d).applyQuaternion(_rel.copy(turned).invert());
    const down = Math.max(0, Math.atan2(-local.y, Math.hypot(local.x, local.z)));
    const effort = Math.min(1, down / (gazer.pitch ?? Infinity));
    const worldDown = pitchAlong(d, facing);
    if (jumped || !seen) eyePitch = Math.min(gazer.range.down, Math.max(EYES * down * effort, gazer.range.down * effort ** 2));
    else if (gazer.pitch !== undefined && aimed) {
      const targetTurn = wrapAngle(worldDown - pitchAlong(_line.subVectors(aimed, origin), facing));
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
    const strained = strainOf(kept);
    if (strainOf(other) < strained - HYSTERESIS) over = !over;
    // (the head's line, the way taken: the eyes take the rest of a turn aside, EYES of it and no more than EYES_MOST of what is left
    // of their range where the neck stops short; up or down, and over the top, the head all the way: the eyes have little to spare
    // there)
    const aside = wrapAngle(Math.atan2(d.x, d.z) - facing);
    const eyes = Math.min(EYES * Math.abs(aside), EYES_MOST * gazer.range.side * Math.max(0, 1 - strained) * Math.sqrt(Math.max(0, 1 - (eyePitch / gazer.range.down) ** 2)));
    if (!over) ways(_line.copy(d).applyAxisAngle(Y, -Math.sign(aside) * eyes));
    // Follow in world space so the trunk can move beneath a steady gaze.
    const whole = _whole.copy(over ? _o : _q);
    const used = strainOf(whole);
    if (used > 1 && eyePitch > 0) {
      // A close target can consume lateral and downward eye range together. Give the head the missing declination before asking the
      // eyes beyond their ellipse.
      const best = strainOf(_full.copy(whole).multiply(_p.setFromAxisAngle(X, eyePitch)));
      if (best < used) {
        let lo = 0, hi = eyePitch;
        while (hi - lo > SETTLED) {
          const middle = (lo + hi) / 2;
          if (strainOf(_candidate.copy(whole).multiply(_p.setFromAxisAngle(X, middle))) > Math.max(EYES_MOST, best)) lo = middle;
          else hi = middle;
        }
        whole.multiply(_p.setFromAxisAngle(X, hi));
        eyePitch -= hi;
      }
    }
    // (followed at the shift's pace, `headPace`; a target moving smoothly pursued without lag, its own acceleration on top)
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
    // (followed in the head's own angles, `fick`, it keeps upright on the way: the shortest turn between two upright looks rolls it
    // mid-shift — 13–17° from aside and level across to down; but not from or to a line of sight steep up or down (`LEVEL`), where
    // those angles hardly tell a turn about the vertical from a roll)
    const level = Math.min(levelness(was), levelness(whole));
    if (level > 0) {
      const now = fick(was, _now), goal = fick(whole, _aim, now);
      const turning = jumped || !sighted ? _turning.set(0, 0, 0)
        : unwrapped(_turning.subVectors(goal, sighted)).divideScalar(f.dt).clampLength(0, motion.turnSpeed ?? Infinity);
      const next = follow(fick(before, _before, now), now, goal, { ...pace, velocity: turning }, f.dt, _next);
      followed.slerp(_fick.setFromEuler(_euler.set(next.x, next.y, next.z, 'YXZ')), level);
    }
    sighted = level > 0 ? fick(whole, sighted ?? new Vector3()) : null;
    const share = _share.identity().slerp(followed.premultiply(_rel.copy(turned).invert()), 1 / bones.length);
    for (const b of bones) pose.setLocal(b, limited(pose.skeleton, b, _goal.copy(share)));
  };
}

/** Upper-body aim, with the gait's counter-rotation and balance preserved: the trunk turned and pitched toward `at`, a sub-step.
 * Recalled: Epic Games, Unreal Engine “Aim Offset”: additive aim over the spine and neck. Tuned torso shares: 65% yaw, 25% pitch; the
 * base shares them over spine/chest, gaze handles neck/head/eyes. Pitch recruits less trunk so looking down does not become a bow. */
export function aiming(self: Looker, at: (f: Frame) => Readonly<Vector3>): Step {
  const gazer = self.gazer;
  if (!gazer) throw new Error('lookAt: the body has no gaze');
  return (f) => {
    const direction = at(f).clone().sub(gazer.eyes(f.prev, new Vector3()));
    const yaw = wrapAngle(Math.atan2(direction.x, direction.z) - self.locomotion.facing);
    const pitch = -Math.atan2(direction.y, Math.hypot(direction.x, direction.z));
    // (derived: two 25° axial joint ranges, leaving 5° for gait counter-rotation; taken up at once, as an aim offset follows the look:
    // the trunk's joints alone pace it, a player's flick turned within them, not at a squat's pace)
    self.poise.add({ twist: Math.max(-Math.PI / 4, Math.min(Math.PI / 4, 0.65 * yaw)), twistRate: Infinity, bow: 0.25 * pitch });
  };
}

/** how much of a gaze shift the eyes take (the head turns the rest: 70–80% of a large shift), and how much of their comfortable range at most */
const EYES = 0.25;
const EYES_MOST = 0.3;
/** a gaze shift is over once the head is this near where it goes (rad): the next sets its own pace */
const SETTLED = (2 * Math.PI) / 180;
/** how fast a target moves at most and is still pursued (m/s): faster, it jumped (5 cm in a 60 Hz step) */
const JUMP = 3;
/** how much less strained (of the eyes' range) the other way round must be for the head to change to it */
const HYSTERESIS = 0.3;
/** a head's peak speed in a gaze shift (its main sequence): `least` (rad/s) and `slope` more per radian of the shift — 100°/s and
 * 2.3°/s per degree, so 150°/s for 20°, 300°/s for 90° (recalled, not checked: Guitton & Volle 1987, head peaks 100–350°/s growing
 * ~2.3°/s per degree in large shifts; read: in active tasks head speeds of ~90–180°/s, Freedman 2008's review via its summary.
 * Self-paced shifts can be slower: Bayer & Zimmermann 2024, R Soc Open Sci 11:231545, read, the head 18.8° at 37°/s — a body looking
 * at what it works on is not idling) */
const HEAD_SEQUENCE = { least: 1.75, slope: 2.3 };
/** the pace of a head turning a gaze shift of `shift` (rad): its peak speed as the shift is large (`HEAD_SEQUENCE`), and the
 * acceleration that gets it there (`BELL`) — within `motion`'s */
function headPace(shift: number, motion: HeadMotion): { accel: number; speed: number } {
  const speed = Math.min(motion.turnSpeed ?? Infinity, HEAD_SEQUENCE.least + HEAD_SEQUENCE.slope * shift);
  return { speed, accel: Math.min(motion.turnAccel, Math.max((BELL * speed * speed) / Math.max(shift, 1e-3), BRAKE)) };
}

/** the least acceleration a head turns with (rad/s²): what brings it to rest on a target that moves on */
const BRAKE = 4;
/** how briskly the head gets up to its peak: 1.5 v² / shift reaches it a third of the way, holds it a third and brakes the last (a bell
 * flattened a little: the eyes' line gets there within ~0.6 s of a large shift's start) */
const BELL = 1.5;

/** how much of the eyes' range (1: all of it) the head, turned toward `goal` (world) from `parent`'s turn shared evenly over the neck's
 * `bones` each within its limit, leaves them to look at `point` (world) */
function strain(gazer: Gazer, pose: ReadonlyPose, bones: readonly number[], parent: Readonly<Quaternion>, goal: Quaternion, point: Readonly<Vector3>): number {
  const last = bones[bones.length - 1];
  const offset = gazer.eyes(pose, _eyeOffset).sub(pose.position(last)).applyQuaternion(_rel.copy(pose.rotation(last)).invert());
  // (the head's turn down the neck, the eyes' origin carried from the chain's base to the head's under it)
  const share = _share.identity().slerp(_rel.copy(parent).invert().multiply(goal), 1 / bones.length);
  const turn = _within.copy(parent);
  const origin = _eyeOrigin.copy(pose.position(bones[0]));
  for (const b of bones) {
    if (b !== bones[0]) origin.add(_offset.copy(pose.skeleton.bones[b].offset).applyQuaternion(turn));
    turn.multiply(limited(pose.skeleton, b, _goal.copy(share)));
  }
  origin.add(offset.applyQuaternion(turn));
  const local = _l.copy(point).sub(origin).applyQuaternion(_rel.copy(turn).invert());
  const side = Math.atan2(local.x, local.z);
  const down = Math.atan2(-local.y, Math.hypot(local.x, local.z));
  return Math.hypot(side / gazer.range.side, down / (down > 0 ? gazer.range.down : gazer.range.up));
}

/** how far (0–1) a head turned `q` (world) looks level enough to be followed in its own angles (`LEVEL`) */
function levelness(q: Readonly<Quaternion>): number {
  const line = _tl.set(0, 0, 1).applyQuaternion(q);
  return smoothstep(LEVEL[0], LEVEL[1], Math.hypot(line.x, line.z));
}

/** how much of a line of sight is horizontal (the cosine of its pitch) where a head is followed in its own angles, from none to all:
 * from 75° to 60° up or down (tuned) */
const LEVEL = [0.25, 0.5];

/** `q` (world) in a head's own angles, Fick's gimbal: turned about the vertical, pitched (+ down) about its side axis, then rolled
 * about its line — (pitch, yaw, roll), into `out`, each angle wound as near `near` as it goes. A head turns so, its roll kept small
 * (Fick's strategy: Glenn & Vilis 1992, J Neurophysiol 68:309; head roll within a few degrees in walking and turning: Pozzo, Berthoz &
 * Lefort 1990, Exp Brain Res 82:97 — both recalled, not checked against the papers): each angle followed on its own, it stays upright
 * between upright looks, and upright its angular speed is the speed of its angles. */
function fick(q: Readonly<Quaternion>, out: Vector3, near?: Readonly<Vector3>): Vector3 {
  _euler.setFromQuaternion(q, 'YXZ');
  out.set(_euler.x, _euler.y, _euler.z);
  return near ? unwrapped(out.sub(near)).add(near) : out;
}

/** each angle of `v` wrapped into (−π, π] */
function unwrapped(v: Vector3): Vector3 {
  return v.set(wrapAngle(v.x), wrapAngle(v.y), wrapAngle(v.z));
}

/** how far `line` points down (rad, + down) in the vertical plane turned `yaw`, past straight down for a line behind it */
const pitchAlong = (line: Vector3, yaw: number) => Math.atan2(-line.y, line.x * Math.sin(yaw) + line.z * Math.cos(yaw));

/** looking along `d` (unit), turned `yaw` about the vertical and pitched in that plane (`pitchAlong`), then turned the least way onto
 * `d` (off that plane only where the yaw eased off its heading: nearly straight up or down), into `out` */
function upright(d: Vector3, yaw: number, out: Quaternion): Quaternion {
  out.setFromAxisAngle(Y, yaw).multiply(_p.setFromAxisAngle(X, pitchAlong(d, yaw)));
  return out.premultiply(_p.setFromUnitVectors(_l.set(0, 0, 1).applyQuaternion(out), d));
}

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const _euler = new Euler();
const [_com, _d, _eyes, _l, _line, _spin, _tl, _now, _aim, _turning, _before, _next, _offset, _eyeOffset, _eyeOrigin] = Array.from({ length: 15 }, () => new Vector3());
const [_q, _o, _p, _rel, _share, _goal, _out, _within, _was, _was2, _fick, _whole, _full, _candidate] = Array.from({ length: 14 }, () => new Quaternion());
