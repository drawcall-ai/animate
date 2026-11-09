import { MathUtils, Euler, Quaternion, Vector3 } from 'three';
import { clamp, headingOf, wrapAngle, yawOf } from '../kernel/math';
import { action } from '@pmndrs/timeline';
import { during, type Request } from '../kernel/requests';
import type { Frame, Behaviour } from '../kernel/frame';
import { follow, followRotation } from '../kernel/follow';
import type { Motion } from '../kernel/goal';
import { limited } from '../kernel/limits';
import { angleOf, spinOf } from '../kernel/rotation';
import type { ReadonlyBonePose } from '../kernel/bone-pose';
import type { Skeleton } from '../kernel/skeleton';
import type { Gazer } from '../species/define';
import { EYES, EYES_MOST, EyePitch } from './eyes';
import type { Self } from '../body/self';

/** Horizontal view cone (rad, ~80° each side): neck and head turn ~75°, with the eyes taking the rest. */
const IN_VIEW = 1.4;

/** whether `point` is in view of the body as it faces (from where its weight was the sub-step before) */
export function inView(self: Self, point: Readonly<Vector3>, f: Frame): boolean {
  const com = f.prev.com(_com);
  return Math.abs(wrapAngle(headingOf(point.x - com.x, point.z - com.z) - self.locomotion.facing)) < IN_VIEW;
}

/**
 * Borrow gaze only once `seen` (default: target) is visible, unless `anyway` permits it sooner — and never for a place on the body itself
 * (`own`): that rides with the body, and one on the head moves as the head turns to it, so the look chases what it moves and the hands' goal with it.
 */
export function* noticing(self: Self, request: Request, target: (f: Frame) => Readonly<Vector3>, { seen = target, anyway, own = false }: { seen?: (f: Frame) => Readonly<Vector3>; anyway?: () => boolean; own?: boolean } = {}) {
  yield* action<Frame>({ until: (f) => !own && (anyway?.() || inView(self, seen(f), f)) });
  yield* during(request, 'look', 'borrowed', looking(self, target, { motion: SHIFT }));
}

/** how fast a head may turn (rad/s², rad/s) */
type HeadMotion = Required<Pick<Motion, 'turnAccel'>> & Pick<Motion, 'turnSpeed'>;

/** the most a head turns to look about (rad/s², rad/s): a glance aside, at most */
const GLANCE = { turnAccel: 40, turnSpeed: 6 };
/**
 * the most a head turns to what the hands go for (rad/s², rad/s): a large brisk gaze shift's head, ~3400°/s² and ~340°/s at its peak
 * (recalled from Guitton & Volle 1987, J Neurophysiol 58:427, not checked against the paper)
 */
const SHIFT = { turnAccel: 60, turnSpeed: 6 };

/** Keep the eyes on a world target (rest: +Z forward, +Y up), sharing the braked head turn over the neck chain within joint limits (`shareOver`); EYES
 * takes the remainder — or, given `head`, all of a turn aside but that share, as far as the eyes' comfortable range. The history-followed
 * head turn uses headPace, capped by motion. `recentring`: the eyes re-centre in the head once the body is still under the look (a look
 * asked for; one borrowed by the hands, or idle, leaves the head where it is).
 */
export function looking(self: Self, target: (f: Frame) => Readonly<Vector3>, { motion = GLANCE, recentring = false, head }: { motion?: HeadMotion; recentring?: boolean; head?: number } = {}): Behaviour {
  const gazer = self.gazer, neck = gazer?.neck;
  if (!gazer) throw new Error('lookAt: the body has no gaze');
  if (neck === undefined && head !== undefined) throw new Error('lookAt: a head share needs a neck to turn the head (its posture turns it)');
  if (neck === undefined) return (f) => void (self.asks.look = target(f));
  /** the gaze shift under way: the most the head has had to turn since it last settled (rad) */
  let shift = 0;
  /** the last two head goals, in world rotation and in its own angles (`fick`; null: not followed in them) */
  let seen: Quaternion | null = null;
  let sighted: Vector3 | null = null;
  let seenBefore: Quaternion | null = null;
  let sightedBefore: Vector3 | null = null;
  /** the target's turn followed the sub-step before (rad/s) */
  const pursued = new Vector3();
  /** where the target was the sub-step before (null: not yet seen) */
  let aimed: Vector3 | null = null;
  const eyes = new EyePitch(gazer.range.down, gazer.pitch !== undefined, recentring);
  return (f) => {
    const pose = f.current;
    const bones = pose.skeleton.chain(neck);
    const point = target(f);
    self.gazeAsks?.(f.prev, point);
    // (a target faster than JUMP jumped: the head shifts to it, it does not pursue it; a new sight starts a gaze shift)
    const jumped = (aimed?.distanceTo(point) ?? Infinity) > JUMP * f.dt;
    if (jumped) {
      seen = null;
      seenBefore = null;
      sighted = null;
      sightedBefore = null;
      pursued.set(0, 0, 0);
      shift = 0;
    }
    // (the eyes where the final pose had them, carried on with the neck's parent: an earlier layer's head pose is not the gaze)
    const base = bones[0];
    const parent = pose.skeleton.bones[base].parent;
    const turned = pose.rotation(parent);
    const carried = _rel.copy(turned).multiply(_p.copy(f.prev.rotation(parent)).invert());
    const origin = self.headOffset.eyes(f.prev, _eyes).sub(f.prev.position(base)).applyQuaternion(carried).add(pose.position(base));
    const d = _d.subVectors(point, origin).normalize();
    if (d.lengthSq() === 0) return;
    // (upright, `upright`: the way it faces easing to the neck's parent's nearly straight up or down)
    const facing = yawOf(turned);
    const strainOf = (head: Quaternion) => strain(gazer, pose, bones, turned, head, point);
    const local = _line.copy(d).applyQuaternion(_rel.copy(turned).invert());
    const down = Math.max(0, Math.atan2(-local.y, Math.hypot(local.x, local.z)));
    const effort = Math.min(1, down / (gazer.pitch ?? Infinity));
    // (the line's pitch in the world read in the plane the head turns into for it, not the trunk's: there a line 45° aside, pitched 41°
    // down, reads 51°, so the trunk turning toward it beneath a steady look read as the line rising, the eyes gave it up and the head
    // pitched down for them — 4° in four sub-steps untying the knot, its yaw falling back 2° as the eyes, less pitched, took more aside)
    const declination = (line: Vector3) => pitchAlong(line, lineHeading(line.normalize(), facing));
    const resting = Math.min(gazer.range.down, Math.max(EYES * down * effort, gazer.range.down * effort ** 2));
    if (jumped || !seen || !aimed) eyes.sight(declination(_line.copy(d)), resting);
    else eyes.step(f.dt, declination(_line.copy(d)), declination(_line.subVectors(aimed, origin)), resting, shift >= SETTLED);
    (aimed ??= new Vector3()).copy(point);
    const way = (line: Vector3) => upright(line, lineHeading(line, facing), _whole).multiply(_p.setFromAxisAngle(X, -eyes.value));
    way(d);
    const last = bones[bones.length - 1];
    const was = _was.copy(self.headOffset.rotation(f.prev, last));
    const strained = strainOf(_whole);
    // (the head's line: the eyes take the rest of a turn aside, EYES of it and no more than EYES_MOST of what is left
    // of their range where the neck stops short — given the head's share, the rest of it, as far as all that is left of their range;
    // up or down, and over the top, the head all the way: the eyes have little to spare there)
    const aside = wrapAngle(Math.atan2(d.x, d.z) - facing);
    const room = (share: number) => share * gazer.range.side * Math.max(0, 1 - strained) * Math.sqrt(Math.max(0, 1 - (eyes.value / gazer.range.down) ** 2));
    const glance = head === undefined ? Math.min(EYES * Math.abs(aside), room(EYES_MOST)) : Math.min((1 - head) * Math.abs(aside), room(1));
    way(_line.copy(d).applyAxisAngle(Y, -Math.sign(aside) * glance));
    // Follow in world space so the trunk can move beneath a steady gaze.
    const whole = _whole;
    declinationToHead(whole, eyes, strainOf);
    // The desired look depends on the last eye position. Differentiate over two steps so alternating errors in that feedback
    // are not chased as target velocity; a steady pursuit keeps its exact speed.
    const pursuit = jumped || !seen ? _spin.set(0, 0, 0) : spinOf(seenBefore ?? seen, whole, f.dt * (seenBefore ? 2 : 1), _spin).clampLength(0, motion.turnSpeed ?? Infinity);
    if (seen) (seenBefore ??= new Quaternion()).copy(seen);
    (seen ??= new Quaternion()).copy(whole);
    const speeding = pursuit.distanceTo(pursued) / f.dt;
    pursued.copy(pursuit);
    const gap = angleOf(was, whole);
    shift = gap > shift || gap < SETTLED ? gap : shift;
    const pace = headPace(shift, motion);
    pace.accel = Math.min(motion.turnAccel, pace.accel + speeding);
    const before = _was2.copy(self.headOffset.rotation(f.prev2, last));
    const followed = followRotation(before, was, whole, { ...pace, velocity: pursuit }, f.dt, _out);
    // (followed in the head's own angles, `fick`, it keeps upright on the way: the shortest turn between two upright looks rolls it
    // mid-shift — 13–17° from aside and level across to down; but not from or to a line of sight steep up or down (`LEVEL`), where
    // those angles hardly tell a turn about the vertical from a roll)
    const level = Math.min(levelness(was), levelness(whole));
    if (level > 0) {
      const now = fick(was, _now), goal = fick(whole, _aim, now);
      const turning = jumped || !sighted ? _turning.set(0, 0, 0)
        : unwrapped(_turning.subVectors(goal, sightedBefore ?? sighted)).divideScalar(f.dt * (sightedBefore ? 2 : 1)).clampLength(0, motion.turnSpeed ?? Infinity);
      const next = follow(fick(before, _before, now), now, goal, { ...pace, velocity: turning }, f.dt, _next);
      followed.slerp(_fick.setFromEuler(_euler.set(next.x, next.y, next.z, 'YXZ')), level);
    }
    if (sighted) (sightedBefore ??= new Vector3()).copy(sighted);
    sighted = level > 0 ? fick(whole, sighted ?? new Vector3()) : null;
    if (!sighted) sightedBefore = null;
    shareOver(pose.skeleton, bones, followed.premultiply(_rel.copy(turned).invert()), (b, share) => pose.setLocal(b, share));
  };
}

/**
 * A close target can consume lateral and downward eye range together. Past their ellipse, the head takes the declination back
 * until the eyes are within their comfortable share of it (EYES_MOST) again.
 */
function declinationToHead(whole: Quaternion, eyes: EyePitch, strainOf: (head: Quaternion) => number): void {
  const used = strainOf(whole);
  if (used <= 1 || eyes.value <= 0) return;
  const best = strainOf(_full.copy(whole).multiply(_p.setFromAxisAngle(X, eyes.value)));
  if (best >= used) return;
  let lo = 0, hi = eyes.value;
  while (hi - lo > SETTLED) {
    const middle = (lo + hi) / 2;
    if (strainOf(_candidate.copy(whole).multiply(_p.setFromAxisAngle(X, middle))) > Math.max(EYES_MOST, best)) lo = middle;
    else hi = middle;
  }
  whole.multiply(_p.setFromAxisAngle(X, hi));
  eyes.value -= hi;
}

/**
 * `turn` (in the neck's parent's frame) shared over the neck's `bones`, base first: each takes an even share of what the bones before it
 * left, within its own limit, so what a limit cuts off goes on up the chain (a neck whose base hardly turns leaves the turn to the head),
 * `each` given each bone's share (local) in turn
 */
function shareOver(skeleton: Skeleton, bones: readonly number[], turn: Readonly<Quaternion>, each: (bone: number, share: Quaternion) => void): void {
  takeOver(skeleton, bones, cutToNeck(skeleton, bones, _left.copy(turn)), each);
}

/** `left` taken over `bones`, base first, each an even share of what the bones before it left, within its own limit: `left` what none took */
function takeOver(skeleton: Skeleton, bones: readonly number[], left: Quaternion, each?: (bone: number, share: Quaternion) => void): Quaternion {
  bones.forEach((b, k) => {
    const share = limited(skeleton, b, _goal.identity().slerp(left, 1 / (bones.length - k)));
    left.premultiply(_taken.copy(share).invert());
    each?.(b, share);
  });
  return left;
}

/**
 * `turn` with its yaw and roll, Fick's (a pitch past straight up or down kept as one), cut to as much of each as `bones` take on their own. A
 * limit cuts a swing and a twist: left to it, a turn past the neck stops its twist and keeps its swing toward the bearing it stopped short
 * of, which on a head turned that far is a roll: ear to shoulder for what is low behind it.
 */
function cutToNeck(skeleton: Skeleton, bones: readonly number[], turn: Quaternion): Quaternion {
  _euler.setFromQuaternion(turn, 'YXZ');
  let { x: pitch, y: yaw, z: roll } = _euler;
  if (Math.abs(roll) > Math.PI / 2) [yaw, pitch, roll] = [yaw + Math.PI, Math.PI - pitch, roll - Math.sign(roll) * Math.PI];
  // (as level as those angles still tell a turn about the vertical from a roll: see `LEVEL`)
  const level = levelness(turn);
  if (level === 0) return turn;
  yaw = wrapAngle(yaw);
  const reachedYaw = reachOf(skeleton, bones, Y, yaw), reachedRoll = reachOf(skeleton, bones, Z, roll);
  // (nothing to cut: the turn as it is, not a round trip through its angles)
  if (Math.abs(reachedYaw - yaw) + Math.abs(reachedRoll - roll) < WITHIN) return turn;
  return turn.slerp(_cut.setFromEuler(_euler.set(pitch, reachedYaw, reachedRoll, 'YXZ')), level);
}

/** as much of a turn `angle` about `axis` as `bones` take, each within its limit */
function reachOf(skeleton: Skeleton, bones: readonly number[], axis: Vector3, angle: number): number {
  const left = takeOver(skeleton, bones, _r.setFromAxisAngle(axis, angle));
  return angle - 2 * Math.atan2(left.dot(_axis.set(axis.x, axis.y, axis.z, 0)), left.w);
}

/** Upper-body aim, with the gait's counter-rotation and balance preserved: the trunk turned `share` of the bearing to `at` (at most 45°)
 * and pitched `PITCHED` × `share` of its pitch, a sub-step. Recalled: Epic Games, Unreal Engine “Aim Offset”: additive aim over the spine
 * and neck; the base shares it over spine/chest, gaze handles neck/head/eyes. */
export function aiming(self: Self, at: (f: Frame) => Readonly<Vector3>, share: number): Behaviour {
  if (!self.gazer) throw new Error('lookAt: the body has no gaze');
  return (f) => {
    const direction = at(f).clone().sub(self.headOffset.eyes(f.prev, new Vector3()));
    const yaw = wrapAngle(Math.atan2(direction.x, direction.z) - self.locomotion.facing);
    const pitch = -Math.atan2(direction.y, Math.hypot(direction.x, direction.z));
    // (derived: two 25° axial joint ranges, leaving 5° for gait counter-rotation; turned at the head's pace, the head riding on it: a point
    // passing behind the body has it come round from 45° one way to 45° the other as the bearing wraps, over a quarter second)
    self.asks.add({ twist: clamp(share * yaw, -Math.PI / 4, Math.PI / 4), twistRate: TWISTING, bow: PITCHED * share * pitch });
  };
}

/** how fast an aiming trunk turns its share at most (rad/s): no quicker than the head it carries turns (`GLANCE`), so a view turning up to
 * ~9 rad/s has a 0.65 share keep up with it */
const TWISTING = GLANCE.turnSpeed;

/** Tuned: an aiming trunk takes this much less of its pitch than of its bearing (25% of the pitch at 65% of the bearing), so looking
 * down does not become a bow */
const PITCHED = 0.25 / 0.65;

/** a gaze shift is over once the head is this near where it goes (rad): the next sets its own pace */
const SETTLED = (2 * Math.PI) / 180;
/** how fast a target moves at most and is still pursued (m/s): faster, it jumped (5 cm in a 60 Hz step) */
const JUMP = 3;
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

/** how much of the eyes' range (1: all of it) the head, turned toward `goal` (world) from `parent`'s turn shared over the neck's
 * `bones` each within its limit, leaves them to look at `point` (world) */
function strain(gazer: Gazer, pose: ReadonlyBonePose, bones: readonly number[], parent: Readonly<Quaternion>, goal: Quaternion, point: Readonly<Vector3>): number {
  const last = bones[bones.length - 1];
  const offset = gazer.eyes(pose, _eyeOffset).sub(pose.position(last)).applyQuaternion(_rel.copy(pose.rotation(last)).invert());
  // (the head's turn down the neck, the eyes' origin carried from the chain's base to the head's under it)
  const turn = _within.copy(parent);
  const origin = _eyeOrigin.copy(pose.position(bones[0]));
  shareOver(pose.skeleton, bones, _rel.copy(parent).invert().multiply(goal), (b, share) => {
    if (b !== bones[0]) origin.add(_offset.copy(pose.skeleton.bones[b].offset).applyQuaternion(turn));
    turn.multiply(share);
  });
  origin.add(offset.applyQuaternion(turn));
  const local = _l.copy(point).sub(origin).applyQuaternion(_rel.copy(turn).invert());
  const side = Math.atan2(local.x, local.z);
  const down = Math.atan2(-local.y, Math.hypot(local.x, local.z));
  return Math.hypot(side / gazer.range.side, down / (down > 0 ? gazer.range.down : gazer.range.up));
}

/** how far (0–1) a head turned `q` (world) looks level enough to be followed in its own angles (`LEVEL`) */
function levelness(q: Readonly<Quaternion>): number {
  const line = _tl.set(0, 0, 1).applyQuaternion(q);
  return MathUtils.smoothstep(Math.hypot(line.x, line.z), LEVEL[0], LEVEL[1]);
}

/** how much of a line of sight is horizontal (the cosine of its pitch) where a head is followed in its own angles, from none to all:
 * from 83° to 70° up or down (tuned: as steep as they still tell a turn about the vertical from a roll, short of a look past straight
 * down, where they turn round and roll over; from 75°, a shift off a knot 80° down went the shortest way and came up rolled 5–6°) */
const LEVEL = [0.12, 0.35];

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

/** the heading a head turns to to look along `line` (unit) from a trunk facing `facing`: the line's own, as far as it has one — one passing
 * straight down under the eyes swings its heading round in a moment, and the eyes' own pitch, reset at each new sight, would make it
 * jump too: judged by either, a squat over a box snapped the head ~450°/s */
function lineHeading(line: Vector3, facing: number): number {
  const vertical = MathUtils.smoothstep(Math.hypot(line.x, line.z), 0.1, 0.35);
  return facing + wrapAngle(Math.atan2(line.x, line.z) - facing) * vertical;
}

/** looking along `d` (unit) unrolled: turned `yaw` about the vertical and pitched in that plane (`pitchAlong`), into `out`. Where the yaw
 * eased off `d`'s heading (nearly straight up or down) the eyes take the little left aside: turned the least way onto `d` instead, the
 * head rolled by as much as the yaw eased off, plain to see once the eyes' pitch is taken back off it (9° looking at a knot 80° down) */
function upright(d: Vector3, yaw: number, out: Quaternion): Quaternion {
  return out.setFromAxisAngle(Y, yaw).multiply(_p.setFromAxisAngle(X, pitchAlong(d, yaw)));
}

/** how little (rad) a neck may fall short of a turn's yaw and roll for it to take the turn as it is */
const WITHIN = 1e-6;
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const _r = new Quaternion(), _axis = new Quaternion(), _cut = new Quaternion();
const _euler = new Euler();
const [_com, _d, _eyes, _l, _line, _spin, _tl, _now, _aim, _turning, _before, _next, _offset, _eyeOffset, _eyeOrigin] = Array.from({ length: 15 }, () => new Vector3());
const [_p, _rel, _left, _taken, _goal, _out, _within, _was, _was2, _fick, _whole, _full, _candidate] = Array.from({ length: 13 }, () => new Quaternion());
