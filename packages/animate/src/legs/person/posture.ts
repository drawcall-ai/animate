// The body over its feet: the gait's oscillations.
import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../../kernel/frame';
import type { ReadonlyPose } from '../../kernel/pose';
import type { Quiet } from './quiet';
import { TRUNK_PITCH } from '../../species/humanoid/limits';
import { INDEX } from '../../species/humanoid/bones';
import { clamp, forwardOf, leftOf, lerp, quatYXZ, smoothstep, wrapAngle } from '../../kernel/math';
import { DEFAULT_HEIGHT, proportionsFor, type Proportions } from '../../species/humanoid/proportions';
import type { Stance } from '../../kernel/go';
import type { Stride } from '../../species/humanoid/humanoid';
import { strideTurn, type Turn } from './turn';
import { Inertia, type Inertial } from '../../kernel/inertia';
import { follow } from '../../kernel/follow';
/** the pelvis's list, the swing side dropping (rad; ~4°, Perry), and its sway over the stance foot each way (× height), walking and running */
const LIST = 0.05, SWAY = 0.0085, RUN_SWAY = 0.008;
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
/** of a bow, the share the hips take (the pelvis tipping forward), the lower back the rest; arched back, the pelvis tips back by that
 * share up to `ARCHED` (rad), the spine extending the rest (tuned: the hips keep the range a walk's trailing leg extends into — tipped
 * 0.15 back, a walk arched 0.25 slides its planted feet) */
const HINGE = 0.6, ARCHED = 0.08;
// Tuned quiet shift: unload one knee while keeping both soles planted.
const SHIFT = { share: 0.65, roll: 0.06, drop: 0.012 };
/** how far the knees let the pelvis down at most (m): a squat, the hip joints over the ankles, the knees folded as far as the default
 * body's let its pelvis down 0.38 of its height (tuned; 154°, a degree short of their range) — `FOLD`, the cosine between thigh and shin */
export const squatOf = (proportions: Proportions) => proportions.legLength - Math.sqrt(proportions.thigh ** 2 + proportions.shin ** 2 - 2 * proportions.thigh * proportions.shin * FOLD);
const FOLD = (({ thigh, shin, legLength }) => {
  const squatted = legLength - 0.38 * DEFAULT_HEIGHT;
  return (thigh ** 2 + shin ** 2 - squatted ** 2) / (2 * thigh * shin);
})(proportionsFor(DEFAULT_HEIGHT));
/** Squat translation pace (m/s², m/s), also used by the tracked-head predictor. */
export const LOWER = { accel: 3, speed: 0.6 };
/** Standing planted reach (× leg length): nearly extended, without a singular knee. */
export const STANDING_REACH = 0.995;

/**
 * The trunk leans forward with the pace it goes forward at (rad, the chest's; × the speed ahead up to 1 m/s), a run more: read (Thorstensson
 * et al. 1984, Acta Physiol Scand 121:9, abstract), the trunk's mean forward inclination grows from 6° walking to ~13° running fast. Tuned:
 * its hips → neck ~4.5–5° at 1.3 m/s (the chest ~9°); eased in and out within `LEANING` (rad/s², rad/s), no quicker than the stride's
 * own nod as it sets off or stops; and given up as the trunk bows or the knees bend for a reach (`BOWED`, rad; `LOWERED`, × height): the
 * bow leans it instead.
 */
const LEAN = { walk: 0.14, run: 0.15 }, LEANING = { accel: 1, speed: 0.1 }, BOWED = 0.15, LOWERED = 0.05;
/** Tuned: how far it walks (0 … 1), blended into and out of walking at 6/s, decaying exactly at a finite step `dt`. */
export const walking = (walk: number, speed: number, dt: number) => walk + (smoothstep(0.08, 0.6, speed) - walk) * (1 - Math.exp(-dt * 6));
/** the stride's phase (rad) run on at `rate` (rad/s) and pulled toward the feet's (`goal`) at `ENTRAIN` (1/s) */
export const entrain = (phase: number, goal: number, rate: number, dt: number) => phase + dt * (rate + ENTRAIN * wrapAngle(goal - phase));

/** The trunk's posture for a sub-step: the chest's world rotation, the pelvis's and the thorax's turn with the stride. */
export interface Trunk { chest: Quaternion; pelvisYaw: number; thoraxYaw: number }

/** The body upright over its legs: the root and the posture state the legs and `Posture` share. */
export interface Upright {
  p: Proportions; root: Vector3;
  /** how it strides: its `width` sways and lists the pelvis further, its `bob` bobs it further */
  stride: Stride;
  /** the root's ground velocity (m/s) */
  velocity: Vector3;
  offset: Vector3; yaw: number; walk: number; run: number; moving: boolean; stance: Stance;
  /** where the feet stood or, swinging, were to land as the sub-step began */
  feet: readonly { readonly anchor: Vector3 }[];
  pelvis: Vector3; pelvisRotation: Quaternion;
  /** neither arm free to swing: both hands hold something */
  held: boolean;
}

/** The stride as the feet have it: its phase (rad), the swing's bob and nod (0 … 1), a runner's compression, a foot's share of it standing. */
interface Cycle { phase: number; bob: number; nod: number; compression: number; stance: number }

/**
 * The walking body over its feet, posed each sub-step: the pelvis carried over the root (bobbing,
 * swaying over the stance foot, rotating with the legs, as high as the legs reach, as low as
 * asked), the thorax counter-rotating and rolling with it, the trunk nodding and bowing, and leaning into the root's acceleration as
 * the body's `inertia` has it.
 */
export class Posture {
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

  /** the pelvis's goal into `upright.pelvis` / `upright.pelvisRotation` and the trunk's into `out`; `lower` (m), `bow`, `twist` and `lean`
   * (rad, sideways: + its left side up) as balance has them */
  carry(f: Pick<Frame, 'prev' | 'dt'>, upright: Upright, asks: { lower: number; bow: number; twist: number; lean: number }, out: Trunk, life: Pick<Quiet, 'drift' | 'breath' | 'onto'>, cycle: Cycle) {
    const { lower, bow, twist, lean: bent } = asks, { onto } = life, { p: proportions, walk, run } = upright, dt = f.dt;
    // (the legs set how far the pelvis rises and falls: as they would for the default body of their length)
    const H = proportions.height, L = DEFAULT_HEIGHT * proportions.legs;
    const fwd = forwardOf(upright.yaw, _f), left = leftOf(upright.yaw, _l);

    // the pelvis and the thorax turned with the stride, the thorax rolling with its turn
    const ahead = _v.subVectors(f.prev.position(INDEX.leftFoot), f.prev.position(INDEX.rightFoot)).dot(fwd);
    const { pelvis: pelvisYaw, thorax: thoraxYaw, roll: thoraxRoll } = strideTurn(ahead, proportions.legs, walk, run, upright.held, this.turn);
    const { bob, nod: nodPhase, compression: comp, phase: stride } = cycle;
    const wide = upright.stride.width ?? 1;
    let roll = -LIST * wide * Math.sin(stride) * (1 - run) * walk;
    // (over the stance foot at its mid-stance: walking a quarter stride on from the other's lift, as a walk has it; running, its stance
    // short, half the swing on — π(1 − stance share))
    const side = -lerp(SWAY, RUN_SWAY, run) * wide * H * Math.sin(stride + run * (Math.PI / 2 - Math.PI * (1 - cycle.stance))) * walk;
    // inverted-pendulum bob: lowest in double support; running, the leg compresses through stance
    const walkLift = -(0.001 + BOB * (upright.stride.bob ?? 1) * (1 - bob)) * L * walk;
    this.comp += (comp - this.comp) * Math.min(1, 40 * dt);
    const lift = lerp(walkLift, -(0.025 + 0.03 * this.comp) * L, run);
    const nod = lerp(NOD.walk * (nodPhase - 0.2), NOD.run * (this.comp * this.comp - 0.35), run) * walk;
    const shift = -NOD_SHIFT * nod * H;

    // the pelvis where it puts the centre of mass over the root (its ground point, swayed, shifted
    // back under a nod), as high as the legs reach, and as low as asked
    const pelvis = upright.pelvis.copy(upright.root).add(upright.offset).addScaledVector(left, side).addScaledVector(fwd, shift);
    this.quiet.copy(left).multiplyScalar(life.drift.x * proportions.scale).addScaledVector(fwd, life.drift.z * proportions.scale);
    const weight = _v.set(0, 0, 0);
    if (onto && !upright.moving) {
      weight.addVectors(upright.feet[0].anchor, upright.feet[1].anchor).multiplyScalar(0.5);
      weight.subVectors(upright.feet[onto === 'left' ? 0 : 1].anchor, weight).multiplyScalar(SHIFT.share);
    }
    this.weight.lerp(weight, 1 - Math.exp(-dt));
    pelvis.add(this.quiet.add(this.weight));
    // The unloaded knee unlocks as that side of the pelvis drops, with both feet planted.
    const shifted = this.weight.dot(left) / Math.max(proportions.hipHalfWidth, 1e-6);
    roll += SHIFT.roll * shifted;
    const onward = smoothstep(0, 1, Math.max(0, upright.velocity.dot(fwd)));
    const pace = follow(this.leans[0], this.leans[1], lerp(LEAN.walk * walk, LEAN.run, run) * onward, LEANING, dt);
    [this.leans[0], this.leans[1]] = [this.leans[1], pace];
    // (given up at once as a bow or a squat comes in — as smoothly as they come — not after it: the bow leans it instead)
    const forward = pace * (1 - smoothstep(0, BOWED, bow)) * (1 - smoothstep(0, LOWERED * H, lower));
    // A tucked pelvis must still leave the spine and chest enough flexion for the requested bow.
    const tilt = 0.5 * nod + pelvisTilt(proportions, lower, bow) + TILT * run;
    quatYXZ(upright.yaw + pelvisYaw + upright.stance.blade, tilt, roll, upright.pelvisRotation);
    pelvis.y = proportions.hipHeight - upright.stance.crouch - lower + lift - SHIFT.drop * proportions.scale * Math.abs(shifted);

    // the trunk: the thorax counter-rotating and rolling, leaning (with the gait, against a load, into the root's acceleration),
    // nodding, bowing and bent sideways
    this.inertia?.step(upright.velocity, upright.yaw, dt);
    const lean = this.inertia ?? { pitch: 0, roll: 0 };
    const pitch = forward + nod + bow - loadLean(f.prev, proportions, fwd) + life.breath + lean.pitch;
    quatYXZ(upright.yaw + thoraxYaw + upright.stance.blade, pitch, thoraxRoll + lean.roll + bent, out.chest);
    out.chest.multiply(_twist.setFromAxisAngle(UP, twist));
    [out.pelvisYaw, out.thoraxYaw] = [pelvisYaw, thoraxYaw];
  }

  /** where the root (the centre of mass a planner follows) leaves the pelvis, read off the last final pose */
  center(f: Frame): Vector3 {
    const offset = f.prev.com(_o).sub(f.prev.position(0)).negate().setY(0);
    // Under-relax the pose-to-CoM feedback rather than apply the full knee response again.
    return (this.offset ??= offset.clone()).lerp(offset, 0.95);
  }
}

/** Recalled staging: tuck the pelvis under in a deep squat, leaving hip flexion for the knees; the lumbar and thoracic joints take the bow. */
const hingeOf = (proportions: Proportions, lower: number) => lerp(HINGE, -0.2, smoothstep(0, squatOf(proportions), lower));
/** how far (rad, + forward) the pelvis tips for a bow of `bow` let down `lower` (m) */
const pelvisTilt = (proportions: Proportions, lower: number, bow: number) => bow < 0
  ? Math.max(hingeOf(proportions, lower) * bow, -ARCHED)
  : Math.max(hingeOf(proportions, lower) * bow, bow - TRUNK_PITCH * Math.PI / 180);

/** Shoulder height at a given squat and bow, using the articulated trunk rather than a single lever. */
export function shoulderHeight(proportions: Proportions, lower: number, bow: number): number {
  const tilt = pelvisTilt(proportions, lower, bow), offsets = proportions.offsets;
  const height = (offset: Vector3, pitch: number) => offset.y * Math.cos(pitch) - offset.z * Math.sin(pitch);
  return proportions.hipHeight - lower + height(offsets.spine, tilt) + height(offsets.chest, (tilt + bow) / 2)
    + height(offsets.leftShoulder, bow) + height(offsets.leftUpperArm, bow);
}

/** Posture needed to bring a shoulder within hand reach. */
export function handLowering(proportions: Proportions, request: { ahead: number; lateral: number; height: number; reach: number; bowLimit: number }): { lower: number; bow: number } {
  const { ahead, lateral, height, reach, bowLimit } = request;
  const lever = bowLever(proportions, proportions.shoulderHeight);
  const plane = Math.sqrt(Math.max(0, reach ** 2 - lateral ** 2));
  const up = height - proportions.shoulderHeight + lever;
  const distance = Math.hypot(ahead, up);
  const angle = distance > 0 ? Math.acos(clamp((distance ** 2 + lever ** 2 - plane ** 2) / (2 * distance * lever), -1, 1)) : Math.PI;
  // A reachable high forward target also recruits the shoulder. Beyond that arc, rise first;
  // bowing toward an unreachable overhead target lowers the shoulder and chases the deficit,
  // and toward one out of reach to the side brings it no nearer: the turn and the step do.
  const bow = plane > 0 && (height < proportions.shoulderHeight || distance < lever + plane)
    ? clamp(Math.atan2(ahead, up) - angle, 0, bowLimit) : 0;
  // A sideways approach is closed by steps and trunk turns, rather than a squat.
  const across = Math.min(Math.hypot(ahead - lever * Math.sin(bow), lateral), Math.max(0.5 * proportions.armLength, proportions.shoulderHeight - height));
  const below = Math.sqrt(Math.max(0, reach ** 2 - across ** 2));
  const drop = height > proportions.shoulderHeight
    ? Math.min(0, proportions.shoulderHeight + below - height)
    : Math.max(lever * (1 - Math.cos(bow)), proportions.shoulderHeight - height - below);
  return lowered(proportions, lever, drop, bow);
}

/** Posture needed to lower the eyes toward a target. */
export function lowering(proportions: Proportions, request: { drop: number; ahead: number; height: number }): { lower: number; bow: number } {
  const { drop, ahead, height } = request;
  const lever = bowLever(proportions, height);
  const bow = Math.min(Math.asin(clamp(ahead / lever, 0, 1)), Math.acos(1 - clamp(drop / lever, 0, 1)));
  return lowered(proportions, lever, drop, bow);
}

function lowered(proportions: Proportions, lever: number, drop: number, aheadBow: number) {
  const deepBow = Math.acos(1 - clamp((drop - squatOf(proportions)) / lever, 0, 1));
  // A small vertical reach recruits bow before the knees reach their deep-squat reserve.
  const bow = Math.min(MOST_BOW, Math.max(aheadBow, deepBow, 0.05 * smoothstep(0, squatOf(proportions), drop)));
  const lower = clamp(drop - lever * (1 - Math.cos(bow)), 0, squatOf(proportions));
  // Discard the sub-ulp residual from inverse trig followed by its forward projection.
  return { lower: drop < 0 ? Math.max(drop, -TIPTOE * proportions.scale) : lower <= Number.EPSILON * proportions.height ? 0 : lower, bow };
}

export const bowLever = (proportions: Proportions, height: number) => 0.8 * (height - proportions.hipHeight);
// Tuned comfortable bow ceiling, independent of the neck joint range.
export const MOST_BOW = 60 * Math.PI / 180;

/** Counter the hand-carried moment with the trunk, before centring the full loaded CoM with the pelvis. */
function loadLean(pose: ReadonlyPose, proportions: Proportions, forward: Readonly<Vector3>): number {
  const hips = pose.position(0);
  let moment = 0, mass = 0;
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
  return clamp(Math.atan2(moment, mass * (proportions.eyeHeight - proportions.hipHeight) * 0.8), -0.18, 0.18);
}
const UP = new Vector3(0, 1, 0), _twist = new Quaternion(), _f = new Vector3(), _l = new Vector3(), _v = new Vector3(), _o = new Vector3();
