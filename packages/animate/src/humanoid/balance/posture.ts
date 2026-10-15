// The body over its feet: the gait's oscillations from the old core
// (a801be4:packages/core/src/gait/overlay.ts; as adapted in 738b439:packages/animate/src/humanoid/gait/posture.ts).
import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../../core/body';
import type { ReadonlyPose } from '../../core/pose';
import { INDEX, SIDES } from '../bones';
import { clamp, forwardOf, leftOf, lerp, quatYXZ, smoothstep, softMin, softplus, wrapAngle } from '../../core/math';
import type { Proportions } from '../proportions';
import type { Carriage } from './carriage';
import { ankleFor } from './foot';
import { REACH, STANDING_REACH } from './legs';

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
const SQUAT = 0.25;
/**
 * a landing foot holds the pelvis down from this far through its swing on, fully by this far, and
 * by this much less before (× height); a foot just lifted still holds it, less and less, this far through its swing
 */
const LANDING = { from: 0.1, to: 0.75, relax: 0.025 };
const LIFTED = 0.25;
/** how far the pelvis is carried within its legs' reach (× their length): a planted one's walking, and one landing (all but straight: the old core's) */
const PELVIS_REACH = { planted: REACH, landing: 0.998 };

/** a light, brisk walk carries the trunk slightly forward (~3°), a run more (rad) */
const gaitLean = (walk: number, run: number) => 0.05 * walk + 0.1 * run;

/** The trunk's posture for a sub-step: the chest's world rotation, the thorax's gait swing. */
export interface Trunk {
  chest: Quaternion;
  thoraxYaw: number;
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

  /** the pelvis's goal into `c.pelvis` / `c.pelvisRotation` and the trunk's into `out`; `lower` (m) and `bow` (rad) as balance has them */
  carry(f: Frame<unknown>, c: Carriage, lower: number, bow: number, out: Trunk) {
    const { p } = c;
    const H = p.height;
    const dt = f.dt;
    const walk = c.walk;
    const run = c.run;
    const t = c.timing();
    const fwd = forwardOf(c.yaw, _f);
    const left = leftOf(c.yaw, _l);

    // pelvic rotation: walking, the swinging leg's hip travels forward with it; running, the other way
    const ahead = _v.subVectors(f.prev.position(INDEX.leftFoot), f.prev.position(INDEX.rightFoot)).dot(fwd);
    const pelvisYaw = -0.09 * Math.tanh(1.2 * ahead) * walk * lerp(1, -1, run);
    const chestYaw = lerp(COUNTER.walk, COUNTER.run, run) * pelvisYaw;
    const thoraxYaw = pelvisYaw - chestYaw;
    const thoraxRoll = -lerp(THORAX_ROLL.walk, THORAX_ROLL.run, run) * thoraxYaw;
    let bob = 0;
    let nodPhase = 1;
    for (const s of c.steps) {
      if (!s.swing) continue;
      bob = Math.sin(Math.PI * s.swing.progress);
      nodPhase = Math.cos(2 * Math.PI * s.swing.progress);
    }
    // pelvic list and sway: one sinusoid a stride, in step with the feet
    const stride = this.stride(c, dt);
    const roll = -LIST * Math.sin(stride) * (1 - run) * walk;
    const side = -lerp(SWAY, RUN_SWAY, run) * H * Math.sin(stride) * walk;
    // inverted-pendulum bob: lowest in double support; running, the leg compresses through stance
    const walkLift = -(0.001 + BOB * (1 - bob)) * H * walk;
    let comp = 0;
    if (run > 0) for (const s of c.steps) if (!s.swing) comp = Math.max(comp, Math.sin(Math.PI * clamp(s.plantedTime / t.stance, 0, 1)));
    this.comp += (comp - this.comp) * Math.min(1, 40 * dt);
    const lift = lerp(walkLift, -(0.025 + 0.03 * this.comp) * H, run);
    const nod = lerp(NOD.walk * (nodPhase - 0.2), NOD.run * (this.comp * this.comp - 0.35), run) * walk;
    const shift = -NOD_SHIFT * nod * H;

    // the pelvis where it puts the centre of mass over the root (its ground point, swayed, shifted
    // back under a nod), as high as the legs reach, and as low as asked
    const offset = offsetOf(f.prev, p, _o);
    const pelvis = c.pelvis.copy(c.root).add(offset).addScaledVector(left, side).addScaledVector(fwd, shift);
    quatYXZ(c.yaw + pelvisYaw + c.stance.blade, 0.5 * nod + hingeOf(p, lower) * bow, roll, c.pelvisRotation);
    const standing = p.hipHeight - c.stance.crouch - lower + lift;
    pelvis.y = softMin(standing, reachLimit(c, standing - MOST_DROP * H, smoothstep(0, TIPTOE * p.scale, -lower)), 0.015);

    // the trunk: the thorax counter-rotating and rolling, leaning, nodding and bowing
    quatYXZ(c.yaw + thoraxYaw + c.stance.blade, gaitLean(walk, run) + nod + bow, thoraxRoll, out.chest);
    out.thoraxYaw = thoraxYaw;
  }

  /** the stride's phase, advanced by `dt`: it runs at the steps' pace, pulled toward each lift as it comes */
  private stride(c: Carriage, dt: number): number {
    const period = Math.max(c.timing().step, lerp(ARM_PERIOD.walk, ARM_PERIOD.run, c.run));
    const lifted = (c.lastLift === 0 ? 0 : Math.PI) + (Math.PI * (c.clock - c.lastLiftAt)) / period;
    this.phase += dt * (Math.PI / period + ENTRAIN * wrapAngle(lifted - this.phase));
    return this.phase;
  }
}

/** of a bow, the share the hips take (the pelvis tipping forward), let down `lower` by the knees: squatting, the pelvis tips back under, half of it going to the lower back */
const hingeOf = (p: Proportions, lower: number) => HINGE * (1 - 0.5 * smoothstep(0, SQUAT * p.height, lower));

/**
 * How a standing body brings its shoulders down by `drop` (m): the trunk bows (at the hips and the
 * lower back) for the first of it, the knees bend for the rest, smoothly into and out of the squat's
 * ends; past the squat, the trunk bows further (738b439:procedures/bow.ts, `lowering`). What to ask
 * `balance`: `lower` (m) and `bow` (rad).
 */
export function lowering(p: Proportions, drop: number): { lower: number; bow: number } {
  const H = p.height;
  const first = softMin(drop, FIRST_BOW * H, BEND * H);
  const lower = softMin(softplus(drop - first - BEND * H, BEND * H), SQUAT * H, BEND * H);
  // (the bow that brings the shoulders down the rest, as far as a trunk bows)
  let [lo, hi] = [0, MOST_BOW];
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (bowDrop(p, lower, mid) < drop - lower) lo = mid;
    else hi = mid;
  }
  return { lower, bow: lo };
}

/** how far the trunk's bow takes the shoulders down before the knees bend, and over how much of the drop they start and stop (× height); the furthest the trunk bows (rad) */
const FIRST_BOW = 0.08;
const BEND = 0.02;
const MOST_BOW = 1.6;

/**
 * How far a bow of `bow` (rad) brings the shoulders down (m), let down `lower` by the knees: the
 * pelvis tipping its share, the lower back and the thorax half the rest each.
 */
function bowDrop(p: Proportions, lower: number, bow: number): number {
  const hinge = hingeOf(p, lower) * bow;
  const { spine, chest, leftShoulder } = p.offsets;
  const height = (a: number, b: number, c: number) => chest.y * Math.cos(a) + spine.y * Math.cos(b) + leftShoulder.y * Math.cos(c);
  // (the spine's origin rides the pelvis, the chest's the lower back, the shoulders' the thorax)
  return height(0, 0, 0) - height(hinge, hinge + (bow - hinge) / 2, bow);
}

/**
 * the pelvis's horizontal offset from the centre of mass in `pose` (into `out`), the legs' segments
 * counted on the straight line from each hip to its ankle: what the feet's placing and the upper
 * body carry off the pelvis, not how far the knees bend (a pelvis carried lower bends them forward,
 * which would carry it further back)
 */
function offsetOf(pose: ReadonlyPose, p: Proportions, out: Vector3): Vector3 {
  const hips = pose.position(0);
  out.set(0, 0, 0);
  let mass = 0;
  pose.skeleton.bones.forEach((b, i) => {
    if (b.mass === 0) return;
    const along = LEGS.get(i);
    const at = along === undefined ? pose.point(i, b.com, _v) : _v.lerpVectors(pose.position(along.hip), pose.position(along.ankle), along.share(p));
    out.addScaledVector(at.sub(hips), b.mass);
    mass += b.mass;
  });
  return out.divideScalar(-mass).setY(0);
}

/** each leg segment's centre of mass on its hip–ankle line: as a share of the way (Dempster: thigh 0.433, shank 0.433 of theirs; the foot at the ankle) */
const LEGS = new Map(
  SIDES.flatMap((s) => {
    const leg = { hip: INDEX[`${s}UpperLeg`], ankle: INDEX[`${s}Foot`] };
    return [
      [INDEX[`${s}UpperLeg`], { ...leg, share: (p: Proportions) => (0.433 * p.thigh) / p.legLength }],
      [INDEX[`${s}LowerLeg`], { ...leg, share: (p: Proportions) => (p.thigh + 0.433 * p.shin) / p.legLength }],
      [INDEX[`${s}Foot`], { ...leg, share: () => 1 }],
    ] as const;
  }),
);

/**
 * The highest the pelvis may be (as planned, over its ground point) with every foot still in its
 * leg's reach: a planted foot (a trailing one up on its ball, and every one as far as `tiptoe` asks
 * it up, 0 … 1; and not below `floor`), a landing one
 * in the late swing (fading in, against the hip as it will be on landing).
 */
function reachLimit(c: Carriage, floor: number, tiptoe: number): number {
  const p = c.p;
  const fwd = forwardOf(c.yaw, _f);
  let limit = Infinity;
  c.steps.forEach((st, s) => {
    const foot = c.feet[s];
    const hip = c.hip(st.side, _hip);
    const below = c.pelvis.y - hip.y;
    const planted = (at: Vector3, yaw: number, landed: number) => {
      // (fading from the landing's: a trailing foot's heel rises, a landed one rolls flat)
      const behind = -((at.x - hip.x) * fwd.x + (at.z - hip.z) * fwd.z);
      const heel = lerp(st.landPitch * (1 - smoothstep(0, 0.15, landed)), -0.75, Math.max(tiptoe, smoothstep(0, 0.1, behind)));
      const stands = lerp(STANDING_REACH, PELVIS_REACH.planted, c.bent);
      const reach = lerp(PELVIS_REACH.landing, stands, smoothstep(0, 0.2, landed)) * p.legLength;
      const top = highest(hip, ankleFor(p, st.side, at, yaw, heel, _ankle), reach) + below;
      return lerp(top, Math.max(top, floor), smoothstep(0.05, 0.15, behind));
    };
    const w = st.swing;
    if (!w) {
      limit = Math.min(limit, planted(foot.position, foot.yaw, st.plantedTime));
      return;
    }
    // (a foot just lifted lets the pelvis go gradually; a runner's at once)
    if (w.progress < LIFTED * (1 - c.run)) limit = Math.min(limit, planted(w.from, w.fromYaw, Infinity) + LANDING.relax * p.height * smoothstep(0, LIFTED, w.progress));
    if (w.progress < LANDING.from) return;
    // (as it will hold the pelvis once landed: against the hip as it will be then)
    hip.addScaledVector(c.velocity, (1 - w.progress) * w.duration);
    limit = Math.min(limit, planted(foot.position, foot.yaw, 0) + LANDING.relax * p.height * (1 - smoothstep(LANDING.from, LANDING.to, w.progress)));
  });
  return limit;
}

/** the highest the hip joint (at `hip`'s x, z) can be with the leg (`reach` long) still reaching `ankle` */
function highest(hip: Readonly<Vector3>, ankle: Vector3, reach: number): number {
  const h2 = reach * reach - ((hip.x - ankle.x) ** 2 + (hip.z - ankle.z) ** 2);
  return ankle.y + Math.sqrt(Math.max(1e-4, h2));
}

const _f = new Vector3();
const _l = new Vector3();
const _v = new Vector3();
const _o = new Vector3();
const _hip = new Vector3();
const _ankle = new Vector3();
