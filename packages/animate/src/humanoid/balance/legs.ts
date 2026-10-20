// The legs under the carried pelvis: from the old core (a801be4:packages/core/src/gait/roll.ts,
// limbs/legs.ts; as adapted in 738b439:packages/animate/src/humanoid/gait/roll.ts,
// procedures/step.ts, procedures/legs.ts).
import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../../core/body';
import { solveChain, type ChainGoal } from '../../core/chain';
import { follow } from '../../core/follow';
import { clampRotation, coordinatesOf } from '../../core/limits';
import type { ReadonlyPose } from '../../core/pose';
import { INDEX, SIDES, type Side } from '../bones';
import { forwardOf, leftOf, lerp, minimumJerk, smoothstep, softMin, softplus, wrapAngle } from '../../core/math';
import type { Proportions } from '../proportions';
import type { Carriage, Swing } from './carriage';
import { LANDING_REACH, plantedReach } from './posture';
import { ankleFor, ballOf, MAX_HEEL, footRotation, heelOf, swingHump, swingProgress, type Foot } from './foot';

/** how fast a planted foot rolls (rad/s², rad/s), within the ankle's range */
const ROLL = { accel: 300, speed: 8 };

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
/** how far the ankle flexes up (rad) */
const DORSIFLEXION = (40 * Math.PI) / 180;
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
const SWING_REACH = 0.93;
/** Tuned soft reach onset, and straight-knee singularity reserve (fractions of reach). */
const SWING_SOFT = 0.97;
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

/** The shortest hip–ankle span permitted by the knee's flexion limit. */
export const foldedReach = (p: Proportions, bend: number) => Math.sqrt(p.thigh ** 2 + p.shin ** 2 + 2 * p.thigh * p.shin * Math.cos(bend));

/** Follow heel loading into the ankle's stance roll; the leg solve enforces its joint range. */
export function rollFoot(f: Frame, c: Carriage, s: number): number {
  const st = c.steps[s];
  const goal = plantedPitch(f, c, s);
  // Derived finite difference: follow the moving roll goal without a cadence-dependent lag.
  const velocity = st.rollGoal === null ? 0 : (goal - st.rollGoal) / f.dt;
  st.rollGoal = goal;
  st.roll = [st.roll[1], follow(st.roll[0], st.roll[1], goal, { ...ROLL, velocity }, f.dt)];
  return st.roll[1];
}

/**
 * How a planted foot `s` is rolled (+ toes up, − heel up): landed on the heel, it rolls flat; its
 * heel rises once the shank tilts past what the ankle allows, more as it pushes off (walking
 * through the double support, running through the stance's second half).
 */
function plantedPitch(f: Frame, c: Carriage, s: number): number {
  const st = c.steps[s];
  const foot = c.feet[s];
  const strike = st.landPitch;
  const t = c.timing();
  const other = c.steps[1 - s];
  const trailing = !other.swing && other.plantedTime < st.plantedTime;
  const walkPush = trailing ? smoothstep(0, t.doubleSupport, other.plantedTime) * (1 - smoothstep(0.25, 0.45, other.plantedTime)) : 0;
  const runPush = smoothstep(0.45, 1, st.plantedTime / t.stance);
  const limit = lerp(lerp(HEEL_OFF.stand, HEEL_OFF.walk, c.walk), HEEL_OFF.run, t.run);
  const ankle = limit - lerp(PUSH.walk * walkPush, PUSH.run * runPush, t.run) * c.walk;
  return Math.max(-MAX_HEEL, lerp(strike, Math.min(0, ankle - shankTilt(f.prev, st.side, foot.yaw)), smoothstep(0, HEEL_ROCKER, st.plantedTime)));
}

/** a swing taking off now: from where the foot is (as the last pose has it, heading `fromYaw`), toward its landing `to`, the hip carried at `velocity` */
export function liftOff(f: Frame, side: Side, fromYaw: number, to: Readonly<Vector3>, hip: Readonly<Vector3>, velocity: Readonly<Vector3>, swing: Pick<Swing, 'duration' | 'lift' | 'strike' | 'standing'>): Swing {
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
export function swingPose(f: Frame, c: Carriage, s: number, out: FootPose): FootPose {
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
  footRotation(yaw, pitch, out.foot);
  const goal = legGoal(f, c, st.side, out);
  // Predict the shank before asking the free ankle to relax on it.
  solveChain(f, legOf(st.side), { ...goal, tip: { position: goal.tip.position } });
  const local = _q.copy(f.prev.local(INDEX[`${st.side}Foot`])).slerp(_spin.setFromAxisAngle(_v.set(1, 0, 0), -SWING_ANKLE), smoothstep(0, SWING_RETURN[1], k));
  out.foot.slerp(_spin.copy(f.current.rotation(INDEX[`${st.side}LowerLeg`])).multiply(local), 1 - smoothstep(STRIKE_TURN, 1, k));
  // A heel strike blended onto a deeply bent leg must still fit its ankle.
  const shank = f.current.rotation(INDEX[`${st.side}LowerLeg`]);
  const ankleRange = f.current.skeleton.limits[INDEX[`${st.side}Foot`]];
  const ankleTurn = _q.copy(shank).invert().multiply(out.foot);
  if (ankleRange) clampRotation(ankleTurn, ankleRange);
  out.foot.copy(shank).multiply(ankleTurn);
  const toes = _q.copy(f.prev.local(INDEX[`${st.side}Toes`])).slerp(_spin.identity(), smoothstep(0, TOES_RELAX, k));
  const toeRange = f.current.skeleton.limits[INDEX[`${st.side}Toes`]];
  if (toeRange) clampRotation(toes, toeRange);
  out.toes.copy(out.foot).multiply(toes);
  // The constrained ankle may land at a different pitch: keep its heel on the same anchor.
  const heelRise = heelOf(p, _a).applyQuaternion(footRotation(foot.yaw, w.strike, _q)).y - heelOf(p, _b).applyQuaternion(out.foot).y;
  ankle.y += heelRise * minimumJerk((k - STRIKE_TURN) / (1 - STRIKE_TURN));
  // Clear the actual three sole landmarks after planning the ankle and toes.
  const ball = ballOf(p, st.side, _a).applyQuaternion(out.foot).y;
  const heel = heelOf(p, _a).applyQuaternion(out.foot).y;
  const big = _b.copy(p.sole.bigToe).setX(p.sole.bigToe.x * st.sign).applyQuaternion(out.toes).y + ball;
  const small = _b.copy(p.sole.smallToe).setX(p.sole.smallToe.x * st.sign).applyQuaternion(out.toes).y + ball;
  const soft = 0.004 * Math.sin(Math.PI * k) ** 2 + Number.EPSILON;
  const low = ankle.y + softMin(heel, softMin(big, small, soft), soft) - (foot.position.y - p.ankleHeight);
  // sin³ has zero value, speed and acceleration at both contacts; the clearance cannot kick the sole.
  ankle.y += softplus(SOLE_CLEARANCE * Math.sin(Math.PI * k) ** 3 * smoothstep(0, CLEARING, k) - low, soft);
  // never out of the leg's reach: taken in from the floor and given back to it
  const reach = lerp(LANDING_REACH, SWING_REACH, run * smoothstep(0, 0.2, k) * (1 - smoothstep(0.6, 1, k))) * p.legLength;
  ankle.lerp(withinReach(hip, _a.copy(ankle), reach, SWING_SOFT), minimumJerk(k / REACH_IN) * (1 - minimumJerk((k - 1 + REACH_IN) / REACH_IN)));
  return out;
}

/** a planted foot's pose: flat where it stands, rolled by `pitch`; the toes in line on its heel, flat on the floor under its ball */
export function plantedPose(p: Proportions, side: Side, foot: Foot, pitch: number, out: FootPose): FootPose {
  ankleFor(p, side, foot.position, foot.yaw, pitch, out.ankle);
  footRotation(foot.yaw, pitch, out.foot);
  footRotation(foot.yaw, Math.max(0, pitch), out.toes);
  return out;
}

/** The shared hip, knee and ankle constraints for a leg pose. */
function legGoal(f: Frame, c: Carriage, side: Side, pose: FootPose): ChainGoal {
  const hip = c.hip(side, _hip);
  const across = _v.set(1, 0, 0).applyQuaternion(pose.foot);
  const pole = kneePole(side, Math.atan2(-across.z, across.x), c.yaw + c.stance.blade, hip, pose.ankle, _pole).multiplyScalar(c.p.thigh).add(hip);
  const ankle = withinReach(hip, _a.copy(pose.ankle), STRAIGHT * c.p.legLength, STRAIGHT);
  const knee = INDEX[`${side}LowerLeg`];
  const limit = f.prev.skeleton.limits[knee];
  const swing = c.steps[side === 'left' ? 0 : 1].swing;
  const release = swing ? Math.exp(-f.dt / TWIST_RELEASE) : 1;
  // The distal segment points down, opposite the knee limit's +y twist axis.
  const twist = limit ? -coordinatesOf(f.prev.local(knee), limit).value[2] * release : 0;
  return { tip: { position: ankle, quaternion: pose.foot }, pole, twist };
}

/** leg `side` solved down to the foot's pose, with toes turned to their world goal */
export function solveLeg(f: Frame, c: Carriage, side: Side, pose: FootPose) {
  solveChain(f, legOf(side), legGoal(f, c, side, pose));
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
function withinReach(hip: Readonly<Vector3>, ankle: Vector3, reach: number, soft: number): Vector3 {
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

/** Authoritative reach bound from applied hips and final foot goals; posture.reachLimit only plans the carriage. */
export function pelvisHeight(f: Frame, c: Carriage, feet: readonly FootPose[]): number {
  let floor = -Infinity;
  let ceiling = Infinity;
  SIDES.forEach((side, s) => {
    const hip = f.current.position(INDEX[`${side}UpperLeg`]);
    const ankle = feet[s].ankle;
    // A free ankle needs 5° of knee reserve to align before landing.
    const reserve = c.steps[s].swing ? 5 * Math.PI / 180 : 0;
    const bend = (f.current.skeleton.limits[INDEX[`${side}LowerLeg`]]?.swing[1][1] ?? Math.PI) - reserve;
    const span2 = foldedReach(c.p, bend) ** 2;
    const across2 = (hip.x - ankle.x) ** 2 + (hip.z - ankle.z) ** 2;
    const below = c.pelvis.y - hip.y;
    floor = Math.max(floor, ankle.y + Math.sqrt(Math.max(0, span2 - across2)) + below);
    const reach = (c.steps[s].swing ? LANDING_REACH : plantedReach(c.bent, c.steps[s].plantedTime)) * c.p.legLength;
    const loading = c.steps[s].swing ? minimumJerk((c.steps[s].swing.progress - 1 + REACH_IN) / REACH_IN) : 1;
    ceiling = Math.min(ceiling, lerp(c.pelvis.y, ankle.y + Math.sqrt(Math.max(0, reach ** 2 - across2)) + below, loading));
  });
  return Math.max(floor, Math.min(c.pelvis.y, ceiling));
}
