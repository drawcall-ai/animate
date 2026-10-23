// The body over its feet: the gait's oscillations.
import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../../core/body';
import type { ReadonlyPose } from '../../core/pose';
import type { Life } from './life';
import { INDEX } from '../bones';
import { clamp, forwardOf, leftOf, lerp, quatYXZ, smoothstep, wrapAngle } from '../../core/math';
import { DEFAULT_HEIGHT, proportionsFor, type Proportions } from '../proportions';
import type { Stance } from '../../core/asks';
import type { Foot } from './foot';
import { strideTurn, type Turn } from './turn';
import { Inertia, type Inertial } from '../../core/inertia';
import { follow } from '../../core/follow';
/** the pelvis's list, the swing side dropping (rad; ~4°, Perry), and its sway over the stance foot each way (× height), walking and running */
const LIST = 0.05;
const SWAY = 0.0085;
const RUN_SWAY = 0.008;
/** the walking pelvis's dip in double support below mid-stance (× height, of the default body's: × its legs; Orendurff 2004) */
const BOB = 0.016;
/** the trunk pitches forward at each double support and back over mid-stance (rad; CMU mocap); running, forward as the stance leg compresses */
const NOD = { walk: 0.02, run: 0.06 };
/**
 * Running, the pelvis tips forward this much further (rad), room for the hip to extend behind: recalled (Novacheck 1998, Gait Posture
 * 7:77), anterior pelvic tilt grows with speed, ~5° walking to ~15° running; tuned 0.25 (the walking tilt not taken up: a walk keeps
 * the pelvis as it stands). The thorax keeps its own lean over it: the lower back takes the difference.
 */
const TILT = 0.25;
/** how far the pelvis shifts back as the trunk nods forward (× height per rad): the body's centre of mass stays */
const NOD_SHIFT = 0.1;
/** how firmly the stride's phase is pulled into step with the feet (1/s) */
const ENTRAIN = 4;
/** how far the pelvis goes up for a body asked onto its toes, at most (m, default body) */
export const TIPTOE = 0.07;
/** the most a trailing foot's reach lowers the pelvis (× height, of the default body's: × its legs): one left behind further is lifted instead */
const MOST_DROP = 0.035;
/** of a bow, the share the hips take (the pelvis tipping forward), the lower back the rest */
const HINGE = 0.6;
// Tuned quiet shift: unload one knee while keeping both soles planted.
const SHIFT = { share: 0.65, roll: 0.06, drop: 0.012 };
/** how far the knees let the pelvis down at most (m): a squat, the hip joints over the ankles, the knees folded as far as the default
 * body's let its pelvis down 0.38 of its height (tuned; 154°, a degree short of their range) — `FOLD`, the cosine between thigh and shin */
export const squatOf = (p: Proportions) => p.legLength - Math.sqrt(p.thigh ** 2 + p.shin ** 2 - 2 * p.thigh * p.shin * FOLD);
const FOLD = (({ thigh, shin, legLength }) => (thigh ** 2 + shin ** 2 - (legLength - 0.38 * DEFAULT_HEIGHT) ** 2) / (2 * thigh * shin))(proportionsFor(DEFAULT_HEIGHT));
/** Squat translation pace (m/s², m/s), also used by the tracked-head predictor. */
export const LOWER = { accel: 3, speed: 0.6 };
/** Walking planted reach (× leg length): a soft knee under load. */
export const REACH = 0.975;
/** Standing planted reach (× leg length): nearly extended, without a singular knee. */
export const STANDING_REACH = 0.995;

/**
 * The trunk leans forward with the pace it goes forward at (rad, the chest's; × the speed ahead up to 1 m/s), a run more: read (Thorstensson
 * et al. 1984, Acta Physiol Scand 121:9, abstract), the trunk's mean forward inclination grows from 6° walking to ~13° running fast. Tuned:
 * its hips → neck ~4.5–5° at 1.3 m/s (the chest ~9°); eased in and out within `LEANING` (rad/s², rad/s), no quicker than the stride's own nod as it sets off
 * or stops; and given up as the trunk bows or the knees bend for a reach (`BOWED`, rad; `LOWERED`, × height): the bow leans it instead.
 */
const LEAN = { walk: 0.14, run: 0.15 }, LEANING = { accel: 1, speed: 0.1 }, BOWED = 0.15, LOWERED = 0.05;

/** The inherited 6/s blend into and out of walking, with exact decay at finite dt. */
export const walking = (walk: number, speed: number, dt: number) => walk + (smoothstep(0.08, 0.6, speed) - walk) * (1 - Math.exp(-dt * 6));

/** The inherited foot-clock entrainment, shared by both public phase conversions. */
export const entrain = (phase: number, goal: number, rate: number, dt: number) => phase + dt * (rate + ENTRAIN * wrapAngle(goal - phase));

/** The trunk's posture for a sub-step: the chest's world rotation, the pelvis's and the thorax's turn with the stride. */
export interface Trunk {
  chest: Quaternion;
  pelvisYaw: number;
  thoraxYaw: number;
}

/** The body upright over its legs: the root and the posture state the legs and `Posture` share. */
export interface Upright {
  p: Proportions;
  root: Vector3;
  /** the root's ground velocity (m/s) */
  velocity: Vector3;
  offset: Vector3;
  yaw: number;
  walk: number;
  run: number;
  moving: boolean;
  stance: Stance;
  feet: readonly Foot[];
  pelvis: Vector3;
  pelvisRotation: Quaternion;
  /** neither arm free to swing: both hands hold something */
  held: boolean;
}

/** The stride as the feet have it: its phase (rad), the swing's bob and nod (0 … 1), a runner's compression, a foot's share of it standing. */
export interface Cycle {
  phase: number;
  bob: number;
  nod: number;
  compression: number;
  stance: number;
}

/**
 * The walking body over its feet, posed each sub-step: the pelvis carried over the root (bobbing,
 * swaying over the stance foot, rotating with the legs, as high as the legs reach, as low as
 * asked), the thorax counter-rotating and rolling with it, the trunk nodding and bowing, and leaning into the root's acceleration as
 * the body's `inertia` has it.
 */
export class Posture {
  /** the stride's phase (rad): 0 as the left foot lifts, π as the right does */
  phase = 0;
  /** a runner's leg compression through stance (0 … 1) */
  private comp = 0;
  private readonly weight = new Vector3();
  private offset: Vector3 | null = null;
  readonly quiet = new Vector3();
  private readonly turn: Turn = { pelvis: 0, thorax: 0, roll: 0 };
  private readonly leans = [0, 0];
  private readonly inertia: Inertia | null;

  constructor(inertia?: Inertial) {
    this.inertia = inertia ? new Inertia(inertia) : null;
  }

  /** the pelvis's goal into `c.pelvis` / `c.pelvisRotation` and the trunk's into `out`; `lower` (m) and `bow` (rad) as balance has them */
  carry(f: Pick<Frame, 'prev' | 'dt'>, c: Upright, asks: { lower: number; bow: number; twist: number }, out: Trunk, life: Pick<Life, 'drift' | 'breath' | 'onto'>, cycle: Cycle, height: (standing: number, floor: number, tiptoe: number) => number) {
    const { lower, bow, twist } = asks;
    const { onto } = life;
    const { p } = c;
    // (the legs set how far the pelvis rises and falls: as they would for the default body of their length)
    const H = p.height, L = DEFAULT_HEIGHT * p.legs;
    const dt = f.dt;
    const walk = c.walk;
    const run = c.run;
    const fwd = forwardOf(c.yaw, _f);
    const left = leftOf(c.yaw, _l);

    // the pelvis and the thorax turned with the stride, the thorax rolling with its turn
    const ahead = _v.subVectors(f.prev.position(INDEX.leftFoot), f.prev.position(INDEX.rightFoot)).dot(fwd);
    const { pelvis: pelvisYaw, thorax: thoraxYaw, roll: thoraxRoll } = strideTurn(ahead, p.legs, walk, run, c.held, this.turn);
    const { bob, nod: nodPhase, compression: comp } = cycle;
    const stride = this.phase = cycle.phase;
    let roll = -LIST * Math.sin(stride) * (1 - run) * walk;
    // (over the stance foot at its mid-stance: walking a quarter stride on from the other's lift, as a walk has it; running, its stance
    // short, half the swing on — π(1 − stance share))
    const side = -lerp(SWAY, RUN_SWAY, run) * H * Math.sin(stride + run * (Math.PI / 2 - Math.PI * (1 - cycle.stance))) * walk;
    // inverted-pendulum bob: lowest in double support; running, the leg compresses through stance
    const walkLift = -(0.001 + BOB * (1 - bob)) * L * walk;
    this.comp += (comp - this.comp) * Math.min(1, 40 * dt);
    const lift = lerp(walkLift, -(0.025 + 0.03 * this.comp) * L, run);
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
    const onward = smoothstep(0, 1, Math.max(0, c.velocity.dot(fwd)));
    const pace = follow(this.leans[0], this.leans[1], lerp(LEAN.walk * walk, LEAN.run, run) * onward, LEANING, dt);
    [this.leans[0], this.leans[1]] = [this.leans[1], pace];
    // (given up at once as a bow or a squat comes in — as smoothly as they come — not after it: the bow leans it instead)
    const forward = pace * (1 - smoothstep(0, BOWED, bow)) * (1 - smoothstep(0, LOWERED * H, lower));
    quatYXZ(c.yaw + pelvisYaw + c.stance.blade, 0.5 * nod + hingeOf(p, lower) * bow + TILT * run, roll, c.pelvisRotation);
    const standing = p.hipHeight - c.stance.crouch - lower + lift - SHIFT.drop * p.scale * Math.abs(shifted);
    pelvis.y = height(standing, standing - MOST_DROP * L, smoothstep(0, TIPTOE * p.scale, -lower));

    // the trunk: the thorax counter-rotating and rolling, leaning (with the gait, against a load, into the root's acceleration),
    // nodding and bowing
    this.inertia?.step(c.velocity, c.yaw, dt);
    const lean = this.inertia ?? { pitch: 0, roll: 0 };
    quatYXZ(c.yaw + thoraxYaw + c.stance.blade, forward + nod + bow - loadLean(f.prev, p, fwd) + life.breath + lean.pitch, thoraxRoll + lean.roll, out.chest);
    out.chest.multiply(_twist.setFromAxisAngle(UP, twist));
    [out.pelvisYaw, out.thoraxYaw] = [pelvisYaw, thoraxYaw];
  }

  /** The old controller follows the CoM; its pelvis offset is measured from the completed pose. */
  center(f: Frame): Vector3 {
    const offset = f.prev.com(_o).sub(f.prev.position(0)).negate().setY(0);
    // Under-relax the pose-to-CoM feedback rather than apply the full knee response again.
    return (this.offset ??= offset.clone()).lerp(offset, 0.95);
  }

}

/** Recalled staging: tuck the pelvis under in a deep squat, leaving hip flexion for the knees; the lumbar and thoracic joints take the bow. */
const hingeOf = (p: Proportions, lower: number) => lerp(HINGE, -0.2, smoothstep(0, squatOf(p), lower));

/** Posture needed to bring a shoulder within hand reach. */
export function handLowering(p: Proportions, request: { ahead: number; lateral: number; height: number; reach: number; bowLimit: number }): { lower: number; bow: number } {
  const { ahead, lateral, height, reach, bowLimit } = request;
  const lever = bowLever(p, p.shoulderHeight);
  const plane = Math.sqrt(Math.max(0, reach ** 2 - lateral ** 2));
  const up = height - p.shoulderHeight + lever;
  const distance = Math.hypot(ahead, up);
  const angle = distance > 0 ? Math.acos(clamp((distance ** 2 + lever ** 2 - plane ** 2) / (2 * distance * lever), -1, 1)) : Math.PI;
  // A reachable high forward target also recruits the shoulder. Beyond that arc, rise first;
  // bowing toward an unreachable overhead target lowers the shoulder and chases the deficit,
  // and toward one out of reach to the side brings it no nearer: the turn and the step do.
  const bow = plane > 0 && (height < p.shoulderHeight || distance < lever + plane)
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
  const deepBow = Math.acos(1 - clamp((drop - squatOf(p)) / lever, 0, 1));
  // A small vertical reach recruits bow before the knees reach their deep-squat reserve.
  const bow = Math.min(MOST_BOW, Math.max(aheadBow, deepBow, 0.05 * smoothstep(0, squatOf(p), drop)));
  const lower = clamp(drop - lever * (1 - Math.cos(bow)), 0, squatOf(p));
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



const UP = new Vector3(0, 1, 0);
const _twist = new Quaternion();
const _f = new Vector3();
const _l = new Vector3();
const _v = new Vector3();
const _o = new Vector3();
