// The body over its feet: the gait's oscillations from the old core
// (a801be4:packages/core/src/gait/overlay.ts; as adapted in 738b439:packages/animate/src/humanoid/gait/posture.ts).
import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../../core/body';
import type { ReadonlyPose } from '../../core/pose';
import type { Life } from './life';
import { INDEX } from '../bones';
import { clamp, forwardOf, leftOf, lerp, minimumJerk, quatYXZ, smoothstep, wrapAngle } from '../../core/math';
import type { Proportions } from '../proportions';
import type { Carriage, Stepping } from './carriage';
import type { Side } from '../bones';
import type { Stance } from '../../core/asks';
import type { Foot } from './foot';
import { ankleFor, MAX_HEEL } from './foot';
/** the pelvis's list, the swing side dropping (rad; ~4°, Perry), and its sway over the stance foot each way (× height), walking and running */
const LIST = 0.05;
const SWAY = 0.0085;
const RUN_SWAY = 0.008;
/** the walking pelvis's dip in double support below mid-stance (× height; Orendurff 2004) */
const BOB = 0.016;
/** the thorax against the pelvis's rotation: walking it counter-rotates (2.1× the pelvis), running it turns further with it (CMU mocap) */
const COUNTER = { walk: 2.1, run: -1.3 };
/** the thorax rolls with its rotation, the forward shoulder up (rad per rad: CMU mocap) */
const THORAX_ROLL = { walk: 0.55, run: 0.14 };
/** the trunk pitches forward at each double support and back over mid-stance (rad; CMU mocap); running, forward as the stance leg compresses */
const NOD = { walk: 0.02, run: 0.06 };
/** how far the pelvis shifts back as the trunk nods forward (× height per rad): the body's centre of mass stays */
const NOD_SHIFT = 0.1;
/** the shortest an arm takes to swing from back to front (s), walking and running: the stride's phase runs no faster */
const ARM_PERIOD = { walk: 0.5, run: 0.3 };
/** how firmly the stride's phase is pulled into step with the feet (1/s) */
const ENTRAIN = 4;
/** how far the pelvis goes up for a body asked onto its toes, at most (m, default body) */
export const TIPTOE = 0.07;
/** the most a trailing foot's reach lowers the pelvis (× height): one left behind further is lifted instead */
const MOST_DROP = 0.035;
/** of a bow, the share the hips take (the pelvis tipping forward), the lower back the rest; how far the knees let the pelvis down at most (× height): a squat */
const HINGE = 0.6;
// Tuned quiet shift: unload one knee while keeping both soles planted.
const SHIFT = { share: 0.65, roll: 0.06, drop: 0.012 };
export const SQUAT = 0.38;
/** Squat translation pace (m/s², m/s), also used by the tracked-head predictor. */
export const LOWER = { accel: 3, speed: 0.6 };
/**
 * a landing foot holds the pelvis down from this far through its swing on, fully by this far, and
 * by this much less before (× height); a foot just lifted still holds it, less and less, this far through its swing
 */
const LANDING = { from: 0.1, to: 0.75, relax: 0.025 };
const LIFTED = 0.25;
/** Tuned heel-rise forecast onset (rad); follows the actual roll softly beyond it. */
const HEEL_SOFT = 0.75;
/** Walking planted reach (× leg length): a soft knee under load. */
export const REACH = 0.975;
/** Standing planted reach (× leg length): nearly extended, without a singular knee. */
export const STANDING_REACH = 0.995;
/** Landing reach (× leg length): near extension before heel loading takes in the knee. */
export const LANDING_REACH = 0.998;
/** Shared reach through heel loading (× leg length), from near extension to standing/walking. */
export const plantedReach = (bent: number, landed: number) => lerp(LANDING_REACH, lerp(STANDING_REACH, REACH, bent), smoothstep(0, 0.2, landed));

/** a light, brisk walk carries the trunk slightly forward (~3°), a run more (rad) */
const gaitLean = (walk: number, run: number) => 0.05 * walk + 0.1 * run;

/** The inherited 6/s blend into and out of walking, with exact decay at finite dt. */
export const walking = (walk: number, speed: number, dt: number) => walk + (smoothstep(0.08, 0.6, speed) - walk) * (1 - Math.exp(-dt * 6));

/** The inherited foot-clock entrainment, shared by both public phase conversions. */
export const entrain = (phase: number, goal: number, rate: number, dt: number) => phase + dt * (rate + ENTRAIN * wrapAngle(goal - phase));

/** The trunk's posture for a sub-step: the chest's world rotation, the thorax's gait swing. */
export interface Trunk {
  chest: Quaternion;
  thoraxYaw: number;
}

/** The body upright over its legs: root and posture state shared by both leg controllers. */
export interface Upright {
  p: Proportions;
  root: Vector3;
  offset: Vector3;
  yaw: number;
  walk: number;
  run: number;
  moving: boolean;
  stance: Stance;
  feet: readonly Foot[];
  pelvis: Vector3;
  pelvisRotation: Quaternion;
}

export interface Supported extends Upright {
  bent: number;
  velocity: Vector3;
  steps: readonly { side: Side; plantedTime: number; landPitch: number; roll: readonly number[];
    swing: Pick<NonNullable<Stepping['swing']>, 'from' | 'fromYaw' | 'duration' | 'progress' | 'strike'> | null }[];
  hip(side: Side, out: Vector3): Vector3;
}

type CycleSource = Pick<Carriage, 'run' | 'clock' | 'lastLift' | 'lastLiftAt' | 'steps' | 'timing'>;

export interface Cycle {
  phase: number;
  bob: number;
  nod: number;
  compression: number;
}

/**
 * The walking body over its feet, posed each sub-step: the pelvis carried over the root (bobbing,
 * swaying over the stance foot, rotating with the legs, as high as the legs reach, as low as
 * asked), the thorax counter-rotating and rolling with it, the trunk nodding and bowing.
 */
export class Posture {
  /** the stride's phase (rad): 0 as the left foot lifts, π as the right does */
  phase = 0;
  /** a runner's leg compression through stance (0 … 1) */
  private comp = 0;
  private readonly weight = new Vector3();
  private offset: Vector3 | null = null;
  readonly quiet = new Vector3();

  /** the pelvis's goal into `c.pelvis` / `c.pelvisRotation` and the trunk's into `out`; `lower` (m) and `bow` (rad) as balance has them */
  carry(f: Pick<Frame, 'prev' | 'dt'>, c: Upright, asks: { lower: number; bow: number; twist: number }, out: Trunk, life: Pick<Life, 'drift' | 'breath' | 'onto'>, cycle: Cycle, height: (standing: number, floor: number, tiptoe: number) => number) {
    const { lower, bow, twist } = asks;
    const { onto } = life;
    const { p } = c;
    const H = p.height;
    const dt = f.dt;
    const walk = c.walk;
    const run = c.run;
    const fwd = forwardOf(c.yaw, _f);
    const left = leftOf(c.yaw, _l);

    // pelvic rotation: walking, the swinging leg's hip travels forward with it; running, the other way
    const ahead = _v.subVectors(f.prev.position(INDEX.leftFoot), f.prev.position(INDEX.rightFoot)).dot(fwd);
    const pelvisYaw = -0.09 * Math.tanh(1.2 * ahead) * walk * lerp(1, -1, run);
    const chestYaw = lerp(COUNTER.walk, COUNTER.run, run) * pelvisYaw;
    const thoraxYaw = pelvisYaw - chestYaw;
    const thoraxRoll = -lerp(THORAX_ROLL.walk, THORAX_ROLL.run, run) * thoraxYaw;
    const { bob, nod: nodPhase, compression: comp } = cycle;
    const stride = this.phase = cycle.phase;
    let roll = -LIST * Math.sin(stride) * (1 - run) * walk;
    const side = -lerp(SWAY, RUN_SWAY, run) * H * Math.sin(stride) * walk;
    // inverted-pendulum bob: lowest in double support; running, the leg compresses through stance
    const walkLift = -(0.001 + BOB * (1 - bob)) * H * walk;
    this.comp += (comp - this.comp) * Math.min(1, 40 * dt);
    const lift = lerp(walkLift, -(0.025 + 0.03 * this.comp) * H, run);
    const nod = lerp(NOD.walk * (nodPhase - 0.2), NOD.run * (this.comp * this.comp - 0.35), run) * walk;
    const shift = -NOD_SHIFT * nod * H;

    // the pelvis where it puts the centre of mass over the root (its ground point, swayed, shifted
    // back under a nod), as high as the legs reach, and as low as asked
    const pelvis = c.pelvis.copy(c.root).add(c.offset).addScaledVector(left, side).addScaledVector(fwd, shift);
    this.quiet.copy(left).multiplyScalar(life.drift.x * p.scale).addScaledVector(fwd, life.drift.z * p.scale);
    const weight = _v.set(0, 0, 0);
    if (onto && !c.moving) {
      weight.addVectors(c.feet[0].position, c.feet[1].position).multiplyScalar(0.5);
      weight.subVectors(c.feet[onto === 'left' ? 0 : 1].position, weight).multiplyScalar(SHIFT.share);
    }
    this.weight.lerp(weight, 1 - Math.exp(-dt));
    pelvis.add(this.quiet.add(this.weight));
    // The unloaded knee unlocks as that side of the pelvis drops, with both feet planted.
    const shifted = this.weight.dot(left) / Math.max(p.hipHalfWidth, 1e-6);
    roll += SHIFT.roll * shifted;
    quatYXZ(c.yaw + pelvisYaw + c.stance.blade, 0.5 * nod + hingeOf(p, lower) * bow, roll, c.pelvisRotation);
    const standing = p.hipHeight - c.stance.crouch - lower + lift - SHIFT.drop * p.scale * Math.abs(shifted);
    pelvis.y = height(standing, standing - MOST_DROP * H, smoothstep(0, TIPTOE * p.scale, -lower));

    // the trunk: the thorax counter-rotating and rolling, leaning, nodding and bowing
    quatYXZ(c.yaw + thoraxYaw + c.stance.blade, gaitLean(walk, run) + nod + bow - loadLean(f.prev, p, fwd) + life.breath, thoraxRoll, out.chest);
    out.chest.multiply(_twist.setFromAxisAngle(UP, twist));
    out.thoraxYaw = thoraxYaw;
  }

  /** The old controller follows the CoM; its pelvis offset is measured from the completed pose. */
  center(f: Frame): Vector3 {
    const offset = f.prev.com(_o).sub(f.prev.position(0)).negate().setY(0);
    // Under-relax the pose-to-CoM feedback rather than apply the full knee response again.
    return (this.offset ??= offset.clone()).lerp(offset, 0.95);
  }

  /** A prediction owns its filter state; planning must not advance the live posture. */
  forecast(): Posture {
    const copy = new Posture();
    copy.comp = this.comp;
    copy.weight.copy(this.weight);
    return copy;
  }

  /** Old controller's cycle, preserving its lift entrainment and swing-shaped bob. */
  cycle(c: CycleSource, dt: number): Cycle {
    let bob = 0, nod = 1, compression = 0;
    for (const s of c.steps) {
      if (!s.swing) continue;
      bob = Math.sin(Math.PI * s.swing.progress);
      nod = Math.cos(2 * Math.PI * s.swing.progress);
    }
    const t = c.timing();
    if (c.run > 0) for (const s of c.steps) if (!s.swing) compression = Math.max(compression, Math.sin(Math.PI * clamp(s.plantedTime / t.stance, 0, 1)));
    const period = Math.max(c.timing().step, lerp(ARM_PERIOD.walk, ARM_PERIOD.run, c.run));
    const lifted = (c.lastLift === 0 ? 0 : Math.PI) + (Math.PI * (c.clock - c.lastLiftAt)) / period;
    this.phase = entrain(this.phase, lifted, Math.PI / period, dt);
    return { phase: this.phase, bob, nod, compression };
  }
}

/** Recalled staging: tuck the pelvis under in a deep squat, leaving hip flexion for the knees; the lumbar and thoracic joints take the bow. */
const hingeOf = (p: Proportions, lower: number) => lerp(HINGE, -0.2, smoothstep(0, SQUAT * p.height, lower));

/** Posture needed to bring a shoulder within hand reach. */
export function handLowering(p: Proportions, request: { ahead: number; lateral: number; height: number; reach: number; bowLimit: number }): { lower: number; bow: number } {
  const { ahead, lateral, height, reach, bowLimit } = request;
  const lever = bowLever(p, p.shoulderHeight);
  const plane = Math.sqrt(Math.max(0, reach ** 2 - lateral ** 2));
  const up = height - p.shoulderHeight + lever;
  const distance = Math.hypot(ahead, up);
  const angle = distance > 0 ? Math.acos(clamp((distance ** 2 + lever ** 2 - plane ** 2) / (2 * distance * lever), -1, 1)) : Math.PI;
  // A reachable high forward target also recruits the shoulder. Beyond that arc, rise first;
  // bowing toward an unreachable overhead target lowers the shoulder and chases the deficit.
  const bow = height < p.shoulderHeight || distance < lever + plane
    ? clamp(Math.atan2(ahead, up) - angle, 0, bowLimit) : 0;
  // A sideways approach is closed by steps and trunk turns, rather than a squat.
  const across = Math.min(Math.hypot(ahead - lever * Math.sin(bow), lateral), Math.max(0.5 * p.armLength, p.shoulderHeight - height));
  const below = Math.sqrt(Math.max(0, reach ** 2 - across ** 2));
  const drop = height > p.shoulderHeight ? Math.min(0, p.shoulderHeight + below - height) : Math.max(lever * (1 - Math.cos(bow)), p.shoulderHeight - height - below);
  return lowered(p, lever, drop, bow);
}

/** Posture needed to lower the eyes toward a target. */
export function lowering(p: Proportions, request: { drop: number; ahead: number; height: number }): { lower: number; bow: number } {
  const { drop, ahead, height } = request;
  const lever = bowLever(p, height);
  const bow = Math.min(Math.asin(clamp(ahead / lever, 0, 1)), Math.acos(1 - clamp(drop / lever, 0, 1)));
  return lowered(p, lever, drop, bow);
}

function lowered(p: Proportions, lever: number, drop: number, aheadBow: number) {
  const deepBow = Math.acos(1 - clamp((drop - SQUAT * p.height) / lever, 0, 1));
  // A small vertical reach recruits bow before the knees reach their deep-squat reserve.
  const bow = Math.min(MOST_BOW, Math.max(aheadBow, deepBow, 0.05 * smoothstep(0, SQUAT * p.height, drop)));
  const lower = clamp(drop - lever * (1 - Math.cos(bow)), 0, SQUAT * p.height);
  // Discard the sub-ulp residual from inverse trig followed by its forward projection.
  return { lower: drop < 0 ? Math.max(drop, -TIPTOE * p.scale) : lower <= Number.EPSILON * p.height ? 0 : lower, bow };
}

export const bowLever = (p: Proportions, height: number) => 0.8 * (height - p.hipHeight);
// Tuned comfortable bow ceiling, independent of the neck joint range.
export const MOST_BOW = 60 * Math.PI / 180;

/** Counter the hand-carried moment with the trunk, before centring the full loaded CoM with the pelvis. */
function loadLean(pose: ReadonlyPose, p: Proportions, forward: Readonly<Vector3>): number {
  const hips = pose.position(0);
  let moment = 0;
  let mass = 0;
  pose.skeleton.bones.forEach((bone, i) => {
    const load = pose.load(i);
    // The counter-moment comes from the trunk above the hips, not the whole body.
    if (i === INDEX.spine || i === INDEX.chest || i === INDEX.neck || i === INDEX.head) mass += bone.mass;
    if (!load.mass || (i !== INDEX.leftHand && i !== INDEX.rightHand)) return;
    const at = pose.point(i, load.at, _v).sub(hips);
    moment += load.mass * (at.x * forward.x + at.z * forward.z);
  });
  // Read: Anderson et al. 2007, doi:10.1080/00140130701403005, Fig. 5: anterior
  // loads produce trunk extension. Tuned effective trunk CoM lever (80% of its height),
  // capped at 10.3 degrees; the study is not an 8 kg dose-response law.
  return clamp(Math.atan2(moment, mass * (p.eyeHeight - p.hipHeight) * 0.8), -0.18, 0.18);
}

/**
 * Planning bound before pelvis following/rotation; legs.pelvisHeight enforces the final geometry.
 * The highest the pelvis may be (over its ground point) with every foot still in its
 * leg's reach: a planted foot (a trailing one up on its ball, and every one as far as `tiptoe` asks
 * it up, 0 … 1; and not below `floor`), a landing one
 * in the late swing (fading in, against the hip as it will be on landing).
 */
export function reachLimit(c: Supported, floor: number, tiptoe: number): number {
  const p = c.p;
  const fwd = forwardOf(c.yaw, _f);
  let limit = Infinity;
  c.steps.forEach((st, s) => {
    const foot = c.feet[s];
    const hip = c.hip(st.side, _hip);
    const below = c.pelvis.y - hip.y;
    const planted = (at: Vector3, yaw: number, landed: number, strike: number) => {
      // (fading from the landing's: a trailing foot's heel rises, a landed one rolls flat)
      const behind = -((at.x - hip.x) * fwd.x + (at.z - hip.z) * fwd.z);
      const extra = Math.max(0, -HEEL_SOFT - st.roll[1]);
      const raised = -HEEL_SOFT - extra * minimumJerk(extra / (MAX_HEEL - HEEL_SOFT));
      const heel = lerp(strike * (1 - smoothstep(0, 0.15, landed)), raised, Math.max(tiptoe, smoothstep(0, 0.1, behind)));
      const reach = plantedReach(c.bent, landed) * p.legLength;
      const top = highest(hip, ankleFor(p, st.side, at, yaw, heel, _ankle), reach) + below;
      return lerp(top, Math.max(top, floor), smoothstep(0.05, 0.15, behind));
    };
    const w = st.swing;
    if (!w) {
      limit = Math.min(limit, planted(foot.position, foot.yaw, st.plantedTime, st.landPitch));
      return;
    }
    // (a foot just lifted lets the pelvis go gradually; a runner's at once)
    if (w.progress < LIFTED * (1 - c.run)) limit = Math.min(limit, planted(w.from, w.fromYaw, Infinity, st.landPitch) + LANDING.relax * p.height * smoothstep(0, LIFTED, w.progress));
    if (w.progress < LANDING.from) return;
    // (as it will hold the pelvis once landed: against the hip as it will be then)
    hip.addScaledVector(c.velocity, (1 - w.progress) * w.duration);
    limit = Math.min(limit, planted(foot.position, foot.yaw, 0, w.strike) + LANDING.relax * p.height * (1 - smoothstep(LANDING.from, LANDING.to, w.progress)));
  });
  return limit;
}

/** the highest the hip joint (at `hip`'s x, z) can be with the leg (`reach` long) still reaching `ankle` */
function highest(hip: Readonly<Vector3>, ankle: Vector3, reach: number): number {
  const h2 = reach * reach - ((hip.x - ankle.x) ** 2 + (hip.z - ankle.z) ** 2);
  return ankle.y + Math.sqrt(Math.max(1e-4, h2));
}

const UP = new Vector3(0, 1, 0);
const _twist = new Quaternion();
const _f = new Vector3();
const _l = new Vector3();
const _v = new Vector3();
const _o = new Vector3();
const _hip = new Vector3();
const _ankle = new Vector3();
