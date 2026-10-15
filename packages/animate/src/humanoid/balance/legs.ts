// The legs under the carried pelvis: from the old core (a801be4:packages/core/src/gait/roll.ts,
// limbs/legs.ts; as adapted in 738b439:packages/animate/src/humanoid/gait/roll.ts,
// procedures/step.ts, procedures/legs.ts).
import { Quaternion, Vector3 } from 'three';
import type { Dev } from '../../core/dev';
import type { Frame } from '../../core/body';
import { solveChain } from '../../core/chain';
import { clampRotation, coordinatesOf } from '../../core/limits';
import type { ReadonlyPose } from '../../core/pose';
import { INDEX, SIDES, type Side } from '../bones';
import { forwardOf, leftOf, lerp, minimumJerk, smoothstep, softplus, wrapAngle } from '../math';
import type { Humanoid } from '../humanoid';
import type { Proportions } from '../proportions';
import type { Carriage, Swing } from './carriage';
import { ankleFor, ballOf, footRotation, heelOf, swingHump, swingProgress, toeTipOf, type Foot } from './foot';

/** time over which the foot rolls flat about the heel after heel strike (s) */
const HEEL_ROCKER = 0.12;
/**
 * How far the ankle dorsiflexes (the shank tilting forward over the foot, rad) before the heel
 * comes up: standing, the range's end (~35°); walking, the calf holds it at ~11° and the heel rises
 * from mid-stance on; running at ~26° (Perry 1992; CMU mocap).
 */
const HEEL_OFF = { stand: 0.62, walk: 0.19, run: 0.45 };
/** push-off: how much further the ankle plantarflexes by toe-off (rad): to ~15° past neutral walking, ~25° running */
const PUSH = { walk: 0.46, run: 0.88 };
/** how far a planted leg reaches, at most (× its length): a little short of straight walking, all but straight standing */
export const REACH = 0.975;
export const STANDING_REACH = 0.995;
/** the most a planted heel rises (rad) */
export const MAX_HEEL = 1.05;
/** how far the ankle flexes up (rad) */
export const DORSIFLEXION = (40 * Math.PI) / 180;
/** the swinging ankle holds its push-off through the start of the swing, then returns to just past neutral (rad), over this share of it */
const SWING_ANKLE = 0.06;
const SWING_RETURN = [0.1, 0.45] as const;
/** how long the foot's speed at lift-off carries on into the swing (s, time constant), and the swing path's own pace off the floor (its slope at 0) */
const LIFT_BLEND = 0.06;
const SWING_START = 0.34;
/** how long the foot's roll at toe-off carries on into the swing (s, time constant) */
const ROLL_ON = 0.05;
/** time constant for the knee to release axial twist when the ankle no longer needs it (s) */
const TWIST_RELEASE = 0.05;
/** the share of the swing from which the foot turns toes-up into the heel strike */
const STRIKE_TURN = 0.5;
/** the sole's clearance over the floor through the swing (m), coming in over this share of it */
const SOLE_CLEARANCE = 0.012;
const CLEARING = 0.2;
/** the share of the swing over which the leg's reach is taken in after lift-off, and given back before landing */
const REACH_IN = 0.25;
/** the share of a step from standing's swing over which the foot's rise comes in */
const FLAT_LIFT = 0.3;
/** the share of the swing over which the toes relax from the floor into line with the foot */
const TOES_RELAX = 0.3;
/** how far a swinging leg reaches, at most (× its length): all but straight lifting and landing, a runner's less in between */
const LANDING_REACH = 0.998;
const SWING_REACH = 0.93;
/** how far a leg reaches at most (× its length) */
const STRAIGHT = 0.999;
/** how far to its own side of the standing foot a swinging ankle passes, at least (m, default body) */
const SWING_PAST = 0.06;

/** a leg's chain */
export const legOf = (side: Side) => (side === 'left' ? 'leftLeg' : 'rightLeg');

/** the shank's forward tilt over a foot heading `yaw` as `pose` has the leg (rad, + the knee ahead of the ankle) */
export function shankTilt(pose: ReadonlyPose, side: Side, yaw: number): number {
  const shin = _v.subVectors(pose.position(INDEX[`${side}LowerLeg`]), pose.position(INDEX[`${side}Foot`]));
  return Math.atan2(shin.x * Math.sin(yaw) + shin.z * Math.cos(yaw), shin.y);
}

/**
 * How a planted foot `s` is rolled (+ toes up, − heel up): landed on the heel, it rolls flat; its
 * heel rises once the shank tilts past what the ankle allows, more as it pushes off (walking
 * through the double support, running through the stance's second half); up onto the ball whenever
 * the leg could not otherwise reach the hip as it is carried.
 */
export function plantedPitch(f: Frame<unknown>, c: Carriage, s: number): number {
  const st = c.steps[s];
  const foot = c.feet[s];
  if (st.plantedTime < HEEL_ROCKER && st.landPitch !== 0) return st.landPitch * (1 - smoothstep(0, HEEL_ROCKER, st.plantedTime));
  const t = c.timing();
  const other = c.steps[1 - s];
  const trailing = !other.swing && other.plantedTime < st.plantedTime;
  const walkPush = trailing ? smoothstep(0, t.doubleSupport, other.plantedTime) * (1 - smoothstep(0.25, 0.45, other.plantedTime)) : 0;
  const runPush = smoothstep(0.45, 1, st.plantedTime / t.stance);
  const limit = lerp(lerp(HEEL_OFF.stand, HEEL_OFF.walk, c.walk), HEEL_OFF.run, t.run);
  const ankle = limit - lerp(PUSH.walk * walkPush, PUSH.run * runPush, t.run) * c.walk;
  const pitch = Math.max(-MAX_HEEL, Math.min(0, ankle - shankTilt(f.prev, st.side, foot.yaw)));
  const hip = c.hip(st.side, _hip);
  const reach = lerp(STANDING_REACH, REACH, c.bent) * c.p.legLength;
  if (hip.distanceTo(ankleFor(c.p, st.side, foot.position, foot.yaw, pitch, _a)) <= reach) return pitch;
  let lo = -MAX_HEEL;
  let hi = pitch;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (hip.distanceTo(ankleFor(c.p, st.side, foot.position, foot.yaw, mid, _a)) > reach) hi = mid;
    else lo = mid;
  }
  return lo;
}

/** a swing taking off now: from where the foot is (as the last pose has it, heading `fromYaw`), toward its landing `to`, the hip carried at `velocity` */
export function liftOff(f: Frame<unknown>, side: Side, fromYaw: number, to: Readonly<Vector3>, hip: Readonly<Vector3>, velocity: Readonly<Vector3>, swing: Pick<Swing, 'duration' | 'lift' | 'strike' | 'standing'>): Swing {
  const bone = INDEX[`${side}Foot`];
  const from = f.prev.position(bone).clone();
  const q = f.prev.rotation(bone);
  const fwd = _v.set(0, 0, 1).applyQuaternion(q);
  const pitch = Math.atan2(fwd.y, Math.hypot(fwd.x, fwd.z));
  // (the foot rolling up off the floor rolls on a moment; it leaves the floor at the speed it had)
  const spin = _spin.copy(q).multiply(_q.copy(f.prev2.rotation(bone)).invert());
  // (the short way round: q and −q are one rotation)
  if (spin.w < 0) spin.set(-spin.x, -spin.y, -spin.z, -spin.w);
  const rate = (2 * Math.atan2(_a.set(spin.x, spin.y, spin.z).dot(leftOf(fromYaw, _b)), spin.w)) / f.dt;
  const liftVelocity = new Vector3()
    .subVectors(from, f.prev2.position(bone))
    .divideScalar(f.dt)
    .addScaledVector(_a.subVectors(to, from).setY(0), -SWING_START / swing.duration);
  return {
    ...swing,
    from,
    fromYaw,
    progress: 0,
    liftAnkle: pitch + shankTilt(f.prev, side, fromYaw),
    liftRate: -rate,
    liftToes: Math.max(0, pitch),
    liftVelocity,
    hip: hip.clone(),
    hipLanding: hip.clone().addScaledVector(velocity, swing.duration),
  };
}

/** A foot's place for the leg to reach: the ankle and the foot's and toes' world rotations. */
export interface FootPose {
  ankle: Vector3;
  foot: Quaternion;
  toes: Quaternion;
}

/**
 * Where a swinging foot is: along an arc to its landing (rising early as the knee flexes, clearing
 * the floor, past the standing foot to its own side; the ankle carrying its push-off back to
 * neutral, then turning toes-up into the heel strike), into `out`.
 */
export function swingPose(f: Frame<unknown>, c: Carriage, s: number, out: FootPose): FootPose {
  const st = c.steps[s];
  const w = st.swing;
  if (!w) throw new Error(`the ${st.side} foot is not swinging`);
  const p = c.p;
  const foot = c.feet[s];
  const run = c.run;
  const k = w.progress;
  const e = swingProgress(k);
  const land = ankleFor(p, st.side, foot.position, foot.yaw, w.strike, _land);
  const ankle = out.ankle.lerpVectors(w.from, land, e);
  // (leaving the floor at the speed it was moving at, then on its path)
  const t = k * w.duration;
  ankle.addScaledVector(w.liftVelocity, (1 - run) * t * Math.exp(-t / LIFT_BLEND));
  // (a runner's foot is carried along by the leg from the hip as it swings)
  const hip = c.hip(st.side, _hip);
  const carried = run * smoothstep(0, 0.3, k) * (1 - smoothstep(0.45, 1, k));
  if (carried > 0) ankle.lerp(_a.subVectors(w.from, w.hip).lerp(_b.subVectors(land, w.hipLanding), e).add(hip), carried);
  ankle.y += w.lift * swingHump(k, run) * (w.standing ? smoothstep(0, FLAT_LIFT, k) : 1);
  const yaw = w.fromYaw + wrapAngle(foot.yaw - w.fromYaw) * e;
  // past the standing foot with room, out to its own side as the body faces
  const left = leftOf(c.yaw, _l);
  const lateral = _a.subVectors(ankle, f.prev.position(INDEX[`${c.steps[1 - s].side}Foot`])).dot(left) * st.sign;
  ankle.addScaledVector(left, st.sign * softplus(SWING_PAST * p.scale - lateral, 0.01 * p.scale) * Math.sin(Math.PI * k) * (1 - 0.5 * run));
  // the ankle returns from its push-off, then the foot turns toes-up into the heel strike
  const tilt = shankTilt(f.prev, st.side, yaw);
  const rolled = w.liftAnkle + w.liftRate * ROLL_ON * (1 - Math.exp(-t / ROLL_ON));
  const angle = lerp(rolled, SWING_ANKLE, minimumJerk((k - SWING_RETURN[0]) / (SWING_RETURN[1] - SWING_RETURN[0])));
  const pitch = w.standing ? w.strike * smoothstep(STRIKE_TURN, 1, k) : Math.min(lerp(angle - tilt, w.strike, smoothstep(STRIKE_TURN, 1, k)), DORSIFLEXION - tilt);
  const toes = lerp(w.liftToes, pitch, smoothstep(0, TOES_RELAX, k));
  // the sole never goes through the floor, and clears it by a little through the swing
  footRotation(yaw, pitch, out.foot);
  footRotation(yaw, toes, out.toes);
  const ball = ballOf(p, st.side, _a).applyQuaternion(out.foot);
  const tip = toeTipOf(p, _b).sub(ballOf(p, st.side, _l)).applyQuaternion(out.toes).add(ball).y;
  const heel = heelOf(p, _a).applyQuaternion(out.foot).y;
  const low = ankle.y + Math.min(tip, heel) - (foot.position.y - p.ankleHeight);
  ankle.y += softplus(SOLE_CLEARANCE * Math.sin(Math.PI * k) - low, 0.004) * smoothstep(0, CLEARING, k);
  // never out of the leg's reach: taken in from the floor and given back to it
  const reach = lerp(LANDING_REACH, SWING_REACH, run * smoothstep(0, 0.2, k) * (1 - smoothstep(0.6, 1, k))) * p.legLength;
  ankle.lerp(withinReach(hip, _a.copy(ankle), reach), smoothstep(0, REACH_IN, k) * (1 - smoothstep(1 - REACH_IN, 1, k)));
  return out;
}

/** a planted foot's pose: flat where it stands, rolled by `pitch`; the toes in line on its heel, flat on the floor under its ball */
export function plantedPose(p: Proportions, side: Side, foot: Foot, pitch: number, out: FootPose): FootPose {
  ankleFor(p, side, foot.position, foot.yaw, pitch, out.ankle);
  footRotation(foot.yaw, pitch, out.foot);
  footRotation(foot.yaw, Math.max(0, pitch), out.toes);
  return out;
}

/** leg `side` solved down to `pose` (its knee bent over the toes), the toes turned to it */
export function solveLeg(f: Frame<unknown>, c: Carriage, side: Side, pose: FootPose) {
  const hip = c.hip(side, _hip);
  // (the foot's heading by its sideways axis, which its pitch leaves level: a foot rolled up onto its toes points nearly down)
  const across = _v.set(1, 0, 0).applyQuaternion(pose.foot);
  const pole = kneePole(side, Math.atan2(-across.z, across.x), c.yaw + c.stance.blade, hip, pose.ankle, _pole).multiplyScalar(c.p.thigh).add(hip);
  // Preserve knee twist through lift-off and ankle-limit crossings; re-splitting it jumps the shin.
  // (never pulled quite straight: a straight knee bends either way on the slightest wobble)
  const ankle = withinReach(hip, _a.copy(pose.ankle), STRAIGHT * c.p.legLength);
  const knee = INDEX[`${side}LowerLeg`];
  const limit = f.prev.skeleton.limits[knee];
  // The distal segment points down, opposite the knee limit's +y twist axis.
  const twist = limit ? -coordinatesOf(f.prev.local(knee), limit).value[2] * Math.exp(-f.dt / TWIST_RELEASE) : 0;
  solveChain(f, legOf(side), { tip: { position: ankle, quaternion: pose.foot }, pole, twist });
  const foot = INDEX[`${side}Foot`];
  const toes = INDEX[`${side}Toes`];
  const local = _q.copy(f.current.rotation(foot)).invert().multiply(pose.toes);
  const range = f.current.skeleton.limits[toes];
  if (range) clampRotation(local, range);
  f.current.setLocal(toes, local);
}

/**
 * Where a leg's knee bends (a direction, into `out`): over the toes (the foot's heading `yaw`
 * blended with the body's `facing`); a leg raised forward bends with the knee up, one raised out
 * sideways carries it along. (From the old core's kneePole.)
 */
function kneePole(side: Side, yaw: number, facing: number, hip: Vector3, ankle: Vector3, out: Vector3): Vector3 {
  // (halfway round from the facing to the foot's heading: a sum of the two would vanish for a foot turned far round)
  forwardOf(facing + 0.5 * wrapAngle(yaw - facing), out);
  const leg = _leg.subVectors(ankle, hip).normalize();
  const outward = _out.crossVectors(UP, out).multiplyScalar(side === 'left' ? 1 : -1);
  const abducted = Math.max(0, leg.dot(outward));
  out.y = 0.15 + 2.5 * Math.max(0, leg.dot(out) + 0.2);
  return out.applyQuaternion(_arc.setFromUnitVectors(DOWN, _v.set(0, -Math.sqrt(1 - abducted * abducted), 0).addScaledVector(outward, abducted))).normalize();
}

/** `ankle` drawn into the leg's reach (`reach` m) from the hip joint `hip`, softly from `soft` of it on */
function withinReach(hip: Readonly<Vector3>, ankle: Vector3, reach: number, soft = 0.97): Vector3 {
  const d = _d.subVectors(ankle, hip);
  const l = d.length();
  const from = soft * reach;
  if (l <= from) return ankle;
  const span = reach - from;
  return ankle.copy(hip).addScaledVector(d, (from + span * Math.tanh((l - from) / span)) / l);
}

const UP = new Vector3(0, 1, 0);
const DOWN = new Vector3(0, -1, 0);
const _v = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _l = new Vector3();
const _d = new Vector3();
const _hip = new Vector3();
const _land = new Vector3();
const _pole = new Vector3();
const _leg = new Vector3();
const _out = new Vector3();
const _q = new Quaternion();
const _spin = new Quaternion();
const _arc = new Quaternion();

/** Read the final planted foot, allowing its roll about the heel or ball, never the solve's goal. */
export function checkFeet<W>(h: Humanoid<W>, f: Frame<W>, dev: Dev): void {
  if (f.time <= f.dt) return;
  SIDES.forEach((side, s) => {
    const foot = h.feet[s];
    if (foot.phase !== 'planted') return;
    const bone = INDEX[`${side}Foot`];
    const q = f.prev.rotation(bone);
    const forward = new Vector3(0, 0, 1).applyQuaternion(q);
    const pitch = Math.atan2(forward.y, Math.hypot(forward.x, forward.z));
    const slide = (pivot: Vector3) => {
      const actual = f.prev.point(bone, pivot, new Vector3());
      const anchor = pivot.clone().applyQuaternion(footRotation(foot.yaw, 0)).add(foot.position);
      return Math.hypot(actual.x - anchor.x, actual.z - anchor.z);
    };
    const heel = heelOf(h.proportions);
    const ball = ballOf(h.proportions, side);
    const value = Math.abs(pitch) < 0.05 ? Math.max(slide(heel), slide(ball)) : slide(pitch > 0 ? heel : ball);
    if (value > 0.01) dev.append(f.time - f.dt, { check: 'planted foot slide (m)', value, limit: 0.01, where: `${side}Foot` });
    const sole = (['Heel', 'BigToe', 'SmallToe'] as const).map((name) => {
      const point = h.rig.points[`${side}${name}`];
      return f.prev.point(point.bone, point.at, new Vector3()).y;
    });
    const sink = foot.position.y - h.proportions.ankleHeight - Math.min(...sole);
    if (sink > 0.01) dev.append(f.time - f.dt, { check: 'planted foot sink (m)', value: sink, limit: 0.01, where: `${side}Foot` });
  });
}
