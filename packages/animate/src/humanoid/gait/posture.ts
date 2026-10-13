// The gait's oscillations adapted from the old core (a801be4:packages/core/src/gait/overlay.ts,
// limbs/arms.ts: the free arm's swing, limbs/head.ts: the head's share of the thorax's swing).
import { Quaternion, Vector3 } from 'three';
import type { Ctx } from '../../core/body';
import { INDEX, SIDES, type BoneName } from '../bones';
import type { Humanoid } from '../humanoid';
import { clamp, forwardOf, leftOf, lerp, quatYXZ, smoothstep, softMin, Spring, wrapAngle } from '../math';
import { ankleFor } from './foot';
import type { Gait } from './gait';

/**
 * the pelvis's list, the swing side dropping while the other leg bears the weight (rad; ~4°, Perry,
 * here a little less: the trunk above rides it), and its sway over the stance foot (× height,
 * each way)
 */
const LIST = 0.05;
const SWAY = 0.0085;
/** a runner's pelvic sway each way (× height) */
const RUN_SWAY = 0.008;
/** the walking pelvis's dip in double support below mid-stance (× height; Orendurff 2004) */
const BOB = 0.016;
/** the thorax against the pelvis's rotation: walking it counter-rotates (2.1× the pelvis), running it turns further with it (CMU mocap) */
const COUNTER = { walk: 2.1, run: -1.3 };
/** the thorax rolls with its rotation, the forward shoulder up (rad per rad: CMU mocap) */
const THORAX_ROLL = { walk: 0.55, run: 0.14 };
/** the trunk pitches forward at each double support and back over mid-stance (rad; CMU mocap); running, forward as the stance leg compresses */
const NOD = { walk: 0.02, run: 0.06 };
/** how closely a runner's leg compression follows its stance (1/s) */
const COMP_RATE = 40;
/** how far the pelvis shifts back as the trunk nods forward (× height per rad): the body's centre of mass stays */
const NOD_SHIFT = 0.1;
/**
 * the head's share of the thorax's gait swing in the world: ~35% of its roll (CMU mocap), and of
 * its rotation the head going along with ~55% of the thorax's turn (CMU mocap)
 */
const CARRY = { yaw: 0.55, roll: 0.35 };
/**
 * how far through a step (lift-off to lift-off) the arm's swing leads it, walking and running: the
 * arm furthest forward with the other thigh; the forearm ~0.14 step behind (CMU mocap)
 */
const LEAD = { walk: 0.2, run: -0.12, forearm: -0.14 };
/** the shortest an arm takes to swing from back to front (s), walking and running */
const ARM_PERIOD = { walk: 0.5, run: 0.3 };
/** how firmly the arms' swing is pulled into step with the feet (1/s) */
const ENTRAIN = 4;
/** a relaxed arm hangs out from the side (rad) */
const ABDUCTION = (8 * Math.PI) / 180;
/**
 * how stiffly the gait's posture is followed (Hz): the pelvis and the trunk on it alike (or the
 * trunk would lag the pelvis's every turn); the arms and head, each on its own, softer
 */
/**
 * how quickly the pelvis follows its offset from the centre of mass (1/s): walking, at once (the
 * legs carry the centre of mass on its path); standing, slowly (the arms settle at their own
 * pace, the pelvis would chase them, and they it); running, smoothed over the bounce
 */
const OFFSET_RATE = { stand: 10, walk: 1000, run: 60 };
const STIFFNESS = { pelvis: 300, trunk: 300, arms: 10, head: 6 };
/** the most a trailing foot's reach lowers the pelvis (× height): one left behind further is lifted instead */
const MOST_DROP = 0.035;
/** how quickly the pelvis's height follows its plan (1/s), walking and running (a runner's stance is short) */
const HEIGHT_RATE = { walk: 20, run: 60 };

/** a light, brisk walk carries the trunk slightly forward (~3°), a run more (rad) */
const gaitLean = (walk: number, run: number) => 0.05 * walk + 0.1 * run;

const ORIGIN = new Vector3();
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const _f = new Vector3();
const _l = new Vector3();
const _v = new Vector3();
const _chest = new Quaternion();
const _head = new Quaternion();
const _rel = new Quaternion();
const _half = new Quaternion();
const _q = new Quaternion();

/**
 * The walking body over its feet, posed each frame: the pelvis carried over the root (bobbing,
 * swaying over the stance foot, rotating with the legs, as high as the legs reach), the thorax
 * counter-rotating and rolling with it, the trunk nodding, the head steady on the way ahead
 * (carrying a share of the thorax's swing), the free arms swinging opposite the legs.
 */
export class Posture<W> {
  private readonly height = new Spring();
  private readonly comp = new Spring();
  private readonly offset = [new Spring(), new Spring()];
  /** the stride's phase (rad, see `stride`) */
  private phase = 0;
  private started = false;

  constructor(private readonly h: Humanoid<W>) {}

  propose(ctx: Ctx<W>, g: Gait) {
    const { p, feet } = g;
    const { status } = this.h;
    const H = p.height;
    const dt = ctx.dt;
    const walk = g.walk;
    const run = g.run;
    const t = g.timing();
    const fwd = forwardOf(g.yaw, _f);
    const left = leftOf(g.yaw, _l);
    if (!this.started) {
      this.started = true;
      this.height.reset(ctx.body.positions[0].y);
      this.offset[0].reset(ctx.body.positions[0].x - ctx.body.com.x);
      this.offset[1].reset(ctx.body.positions[0].z - ctx.body.com.z);
    }

    // pelvic rotation: walking, the swinging leg's hip travels forward with it; running, the other way
    const ankles = SIDES.map((side) => ctx.body.positions[INDEX[`${side}Foot`]]);
    const ahead = _v.subVectors(ankles[0], ankles[1]).dot(fwd);
    const pelvisYaw = -0.09 * Math.tanh(1.2 * ahead) * walk * lerp(1, -1, run);
    const chestYaw = lerp(COUNTER.walk, COUNTER.run, run) * pelvisYaw;
    const thoraxYaw = pelvisYaw - chestYaw;
    const thoraxRoll = -lerp(THORAX_ROLL.walk, THORAX_ROLL.run, run) * thoraxYaw;
    let bob = 0;
    let nodPhase = 1;
    feet.forEach((f) => {
      if (!f.swinging) return;
      bob = Math.sin(Math.PI * f.progress);
      nodPhase = Math.cos(2 * Math.PI * f.progress);
    });
    // pelvic list and sway: the swing side drops while the weight is on the other leg, and the
    // pelvis shifts over that stance foot, furthest at mid-stance; one sinusoid a stride, in step
    // with the feet (as the arms swing: no kink to jerk the trunk)
    const stride = this.stride(g, dt);
    const roll = -LIST * Math.sin(stride) * (1 - run) * walk;
    const side = -lerp(SWAY, RUN_SWAY, run) * H * Math.sin(stride) * walk;
    // inverted-pendulum bob: lowest in double support; running, the leg compresses through stance
    const walkLift = -(0.001 + BOB * (1 - bob)) * H * walk;
    let comp = 0;
    if (run > 0) feet.forEach((f) => !f.swinging && (comp = Math.max(comp, Math.sin(Math.PI * clamp(f.plantedTime / t.stance, 0, 1)))));
    // (smoothly: a foot leaving early would drop it at once)
    comp = this.comp.step(comp, COMP_RATE, dt);
    const lift = lerp(walkLift, -(0.025 + 0.03 * comp) * H, run);
    const nod = lerp(NOD.walk * (nodPhase - 0.2), NOD.run * (comp * comp - 0.35), run) * walk;
    const lean = gaitLean(walk, run) + nod;
    const shift = -NOD_SHIFT * nod * H;

    // the pelvis: where it puts the centre of mass over the root (its ground point), as high as
    // the legs reach (the legs are posed to it: posed elsewhere, they would hold the centre of
    // mass off its target)
    const rate = lerp(lerp(OFFSET_RATE.stand, OFFSET_RATE.walk, walk), OFFSET_RATE.run, run);
    const offset = _v.set(this.offset[0].step(ctx.body.positions[0].x - ctx.body.com.x, rate, dt), 0, this.offset[1].step(ctx.body.positions[0].z - ctx.body.com.z, rate, dt));
    const pelvis = g.pelvis.copy(g.root).add(offset).addScaledVector(left, side).addScaledVector(fwd, shift);
    quatYXZ(g.yaw + pelvisYaw, 0.5 * nod, roll, g.pelvisRotation);
    // (smoothed after the legs' limit: a dip that binds turns over smoothly; the limit leaves the
    // legs a few cm of reach for the spring's lag)
    const standing = p.hipHeight - status.stance.crouch - this.h.hints.read(ctx.time).crouch + lift;
    pelvis.y = this.height.step(softMin(standing, reachLimit(g, standing - MOST_DROP * H), 0.015), lerp(HEIGHT_RATE.walk, HEIGHT_RATE.run, run), dt);
    const hips = { bone: INDEX.hips, at: ORIGIN };
    // walking, carried by its centre of mass over the root (what the legs' and arms' swing moves
    // of it, the pelvis makes up; its height the pelvis's); standing, by the pelvis (the arms
    // settling at their own pace, the centre of mass would chase them)
    const com = _com
      .copy(g.root)
      .addScaledVector(left, side)
      .addScaledVector(fwd, shift)
      .setY(pelvis.y + ctx.body.com.y - ctx.body.positions[0].y);
    const byCom = walk * (1 - run);
    if (byCom > 0) ctx.propose.target({ kind: 'position', point: 'com', value: com, weight: byCom, stiffness: STIFFNESS.pelvis, owner: 'walk' });
    if (byCom < 1) ctx.propose.target({ kind: 'position', point: hips, value: pelvis, weight: 1 - byCom, stiffness: STIFFNESS.pelvis, owner: 'walk' });
    ctx.propose.target({ kind: 'orientation', point: hips, value: g.pelvisRotation, weight: 1, stiffness: STIFFNESS.pelvis, owner: 'walk' });

    // the trunk: the thorax counter-rotating and rolling, leaning and nodding; the spine and
    // chest share the turn from the pelvis
    quatYXZ(g.yaw + thoraxYaw, lean, thoraxRoll, _chest);
    this.split(ctx, g.pelvisRotation, _chest, 'spine', 'chest', 'main', STIFFNESS.trunk);
    // the head on the way ahead, carrying a share of the thorax's swing (a fallback: a gaze overrides it)
    const eye = p.eyeHeight;
    const pitch = Math.atan2(eye - lerp(0.75, 0.35, smoothstep(0.1, 0.6, walk)) * H, lerp(3, 4.5, smoothstep(0.1, 0.6, walk)));
    quatYXZ(g.yaw + CARRY.yaw * thoraxYaw, pitch, CARRY.roll * thoraxRoll, _head);
    this.split(ctx, _chest, _head, 'neck', 'head', 'fallback', STIFFNESS.head);
    this.swingArms(ctx, g);
  }

  /** proposes `a` and `b` (child of `a`), sharing the turn from `from` to `to` (world) half each */
  private split(ctx: Ctx<W>, from: Quaternion, to: Quaternion, a: BoneName, b: BoneName, tier: 'main' | 'fallback', stiffness: number) {
    _rel.copy(from).invert().multiply(to);
    _half.identity().slerp(_rel, 0.5);
    for (const bone of [a, b]) ctx.propose.target({ kind: 'local', point: { bone: INDEX[bone], at: ORIGIN }, value: _half, weight: 1, tier, stiffness, owner: 'walk' });
  }

  /**
   * Free arms hang a little out from the side and swing with the legs — a pendulum timed by the
   * steps: through each step, lift-off to lift-off, the arm opposite the stepping foot swings from
   * back to front, easing at both ends; the elbow flexes and extends with it, more in front.
   */
  /**
   * the stride's phase (rad), advanced by `dt`: 0 as the left foot lifts, π as the right does; it
   * runs at the steps' pace, pulled toward each lift as it comes (a pendulum entrained by the
   * steps: no kinks)
   */
  private stride(g: Gait, dt: number): number {
    const period = Math.max(g.timing().step, lerp(ARM_PERIOD.walk, ARM_PERIOD.run, g.run));
    const lifted = (g.lastLift === 0 ? 0 : Math.PI) + (Math.PI * (g.clock - g.lastLiftAt)) / period;
    this.phase += dt * (Math.PI / period + ENTRAIN * wrapAngle(lifted - this.phase));
    return this.phase;
  }

  private swingArms(ctx: Ctx<W>, g: Gait) {
    const run = g.run;
    const lead = lerp(LEAD.walk, LEAD.run, run);
    // (as much as is asked: arms holding something are their own)
    const swingWeight = this.h.hints.read(ctx.time).armSwing;
    SIDES.forEach((side, s) => {
      const sign = s === 0 ? 1 : -1;
      // (the left arm in front as the left foot lifts, the right behind; back and forth with the steps)
      const swing = (at: number) => (sign * Math.cos(this.phase + Math.PI * at) * lerp(0.33, 0.42, run) + 0.02) * g.walk;
      const a = swing(lead);
      const follow = swing(lead + LEAD.forearm);
      const flex = lerp(0.25 + (0.18 + 0.5 * follow) * g.walk, 1.5 + 0.3 * follow, run) * (1 - smoothstep(0.6, 1.6, a));
      const upper: BoneName = `${side}UpperArm`;
      const lower: BoneName = `${side}LowerArm`;
      // the arm down from the T-pose (out by ABDUCTION), then swung forward about the body's left
      const hang = _q.setFromAxisAngle(Z, -sign * (Math.PI / 2 - ABDUCTION));
      const value = new Quaternion().setFromAxisAngle(X, -a).multiply(hang);
      if (swingWeight > 0) ctx.propose.target({ kind: 'local', point: { bone: INDEX[upper], at: ORIGIN }, value, weight: swingWeight, stiffness: STIFFNESS.arms, owner: 'walk' });
      const elbow = new Quaternion().setFromAxisAngle(Y, -sign * flex);
      if (swingWeight > 0) ctx.propose.target({ kind: 'local', point: { bone: INDEX[lower], at: ORIGIN }, value: elbow, weight: swingWeight, stiffness: STIFFNESS.arms, owner: 'walk' });
    });
  }
}

const _com = new Vector3();
const _ankle = new Vector3();
const _hip = new Vector3();
/**
 * a landing foot holds the pelvis down from this far through its swing on, fully by this far,
 * and by this much less before (× height): the pelvis comes down over the stance leg to meet it
 */
const LANDING = { from: 0.1, to: 0.75, relax: 0.025 };
/** a foot just lifted still holds the pelvis down, less and less, this far through its swing */
const LIFTED = 0.25;
/** how far the pelvis is carried within its legs' reach (× their length): standing, a planted one's walking, and one landing (its leg reaches on through the touch-down) */
const PELVIS_REACH = { standing: 0.995, planted: 0.97, landing: 0.93 };

/**
 * The highest the pelvis may be (as planned, over its ground point) with every foot still in
 * its leg's reach: a planted foot (a trailing one up on its ball, and not below `floor`), a
 * landing one in the late swing (fading in, against the hip as it will be on landing).
 */
function reachLimit(g: Gait, floor: number): number {
  const p = g.p;
  // (a little shorter than the feet are held within: the legs are never pulled straight)
  const fwd = forwardOf(g.yaw, _f);
  let limit = Infinity;
  g.feet.forEach((f, s) => {
    const foot = g.status[s];
    const hip = g.hip(f.side, _hip);
    const below = g.pelvis.y - hip.y;
    const planted = (at: Vector3, yaw: number, landed: number) => {
      // (fading from the landing's: a trailing foot's heel rises, a landed one rolls flat)
      const behind = -((at.x - hip.x) * fwd.x + (at.z - hip.z) * fwd.z);
      const heel = lerp(f.landPitch * (1 - smoothstep(0, 0.15, landed)), -0.75, smoothstep(0, 0.1, behind));
      const stands = lerp(PELVIS_REACH.standing, PELVIS_REACH.planted, g.bent);
      const reach = lerp(PELVIS_REACH.landing, stands, smoothstep(0, 0.2, landed)) * p.legLength;
      const top = highest(hip, ankleFor(p, f.side, at, yaw, heel, _ankle), reach) + below;
      return lerp(top, Math.max(top, floor), smoothstep(0.05, 0.15, behind));
    };
    if (!f.swinging) {
      limit = Math.min(limit, planted(foot.position, foot.yaw, f.plantedTime));
      return;
    }
    // (a foot just lifted lets the pelvis go gradually; a runner's goes at once: the pelvis rises in flight)
    if (f.progress < LIFTED * (1 - g.run)) limit = Math.min(limit, planted(f.from, f.fromYaw, Infinity) + LANDING.relax * p.height * smoothstep(0, LIFTED, f.progress));
    // (before then, the status may not have its landing yet)
    if (f.progress < LANDING.from) return;
    // (as it will hold the pelvis once landed: against the hip as it will be then)
    hip.addScaledVector(g.velocity, (1 - f.progress) * f.duration);
    limit = Math.min(limit, planted(foot.position, foot.yaw, 0) + LANDING.relax * p.height * (1 - smoothstep(LANDING.from, LANDING.to, f.progress)));
  });
  return limit;
}

/** the highest the hip joint (at `hip`'s x, z) can be with the leg (`reach` long) still reaching `ankle` */
function highest(hip: Readonly<Vector3>, ankle: Vector3, reach: number): number {
  const h2 = reach * reach - ((hip.x - ankle.x) ** 2 + (hip.z - ankle.z) ** 2);
  return ankle.y + Math.sqrt(Math.max(1e-4, h2));
}
