import { Quaternion, Vector3 } from 'three';
import { ownedTask, type OrientedTask, type OwnedTask, type Task, type Tracked } from '../intent/tasks';
import { clamp, forwardOf, leftOf, lerp, Pendulum, smoothstep, Spring } from '../math';
import type { Overlay } from '../posture/trunk';
import type { Proportions } from '../proportions';
import type { Gait } from './gait';

/** a light, brisk walk carries the trunk slightly forward (~3°), a run more (rad) */
export const gaitLean = (walk: number, run: number) => 0.05 * walk + 0.1 * run;

/** the trunk's lean into a climb (rad per unit of rise over run), and into a force at the hands (rad per height the centre of mass is held off the feet) */
const STAIR_LEAN = 0.15;
const LEAN_INTO = 3;
/** the trunk's lean into a force at the hands (rad): forward pushing, back pulling */
export const leanInto = (g: Gait) => (LEAN_INTO * (g.steer.lean.x * Math.sin(g.root.yaw) + g.steer.lean.z * Math.cos(g.root.yaw))) / g.d.height;

/** the walking pelvis's dip in double support below mid-stance (× height; with the legs' own geometry ~3.5–4.5 cm peak to peak at 1.1–1.4 m/s, Orendurff 2004) */
const BOB = 0.016;
/** how quickly the pelvis follows its sway (1/s): smoothing only, not a lag */
const SWAY_RATE = 18;
/** how strongly body acceleration swings the trunk pendulum */
const LAG_GAIN = 2.2;
/**
 * The thorax against the pelvis's rotation: walking it counter-rotates (2.1× the pelvis: ±4°
 * in the world), running the pelvis turns with it and the thorax turns further (±11°) (CMU mocap).
 */
const COUNTER = { walk: 2.1, run: -1.3 };
/** the thorax rolls with its rotation, the forward shoulder up (rad per rad of its rotation in the world: ±1.6° walking, less running; CMU mocap) */
const THORAX_ROLL = { walk: 0.55, run: 0.14 };
/** the trunk pitches forward at each double support and back over mid-stance (rad: ±1.2° walking, CMU mocap); running, forward as the stance leg compresses (~±2°) */
const NOD = { walk: 0.02, run: 0.06 };
/**
 * Quiet standing, fading in as the walk fades out: the centre of mass wanders a few mm
 * (0.16–0.37 Hz), the weight rests ~2 cm more on the foot that stood last (× height), the
 * pelvis dropping on the free side (rad), and the chest breathes, ~15 a minute (rad)
 * (Winter 1995; deterministic, as sums of sines).
 */
const IDLE = { sway: 0.0018, weight: 0.01, list: 0.04, breath: 0.004 };
/**
 * how far the pelvis shifts back as the trunk nods forward (× height per rad): the mass above
 * the hips (Σ m·h ≈ 0.1 H) tips forward, the body's centre of mass stays where it was
 */
const NOD_SHIFT = 0.1;

const _f = new Vector3();
const _l = new Vector3();
const _acc = new Vector3();

/**
 * The gait's oscillations and the trunk's inertia, layered on top of the solved posture:
 * pelvic rotation/obliquity/sway/bob, thorax counter-rotation and roll, the trunk's nod,
 * walking lean, and the upper body as a damped pendulum on the pelvis (lags on
 * acceleration, absorbs hits). The head carries a share of the thorax's rotation and roll.
 */
export class GaitOverlay implements Overlay {
  pelvisYaw = 0;
  pelvisRoll = 0;
  chestYaw = 0;
  /** the gait's swing of the thorax in the world: yaw and roll (as quatYXZ turns: the shoulder going forward rises) */
  thoraxYaw = 0;
  thoraxRoll = 0;
  /** walking/running height change of the pelvis (m) */
  lift = 0;
  side = 0;
  shift = 0;
  swayAhead = 0;
  swayLeft = 0;
  lean = 0;
  chestRoll = 0;
  tilt: Quaternion | null = null;
  readonly pivot = new Vector3();

  private sway = new Spring();
  /** time (s): the idle sway's and breath's phase */
  private clock = 0;
  /** which foot the weight rests on standing (+1 left, −1 right) */
  private weight = new Spring(1);
  private lagPitch = new Pendulum(7, 0.55);
  private lagRoll = new Pendulum(7, 0.55);
  /** the body's velocity last tick, and whether it was a tracked part's */
  private lastVel = new Vector3();
  private tracked = false;
  /** 0 in double support → 1 at mid-swing */
  private bobPhase = 0;
  /** the tracked targets as the posture meets them this tick (written by `ride`) */
  readonly ridden: Tracked = { head: null, chest: null, hips: null };
  private riddenHead: Task = { pos: new Vector3(), weight: 0 };
  private riddenChest = ownedTask();
  private riddenHips = ownedTask();

  constructor(
    private d: Proportions,
    private style: { hips: number },
  ) {}

  /**
   * A hit rocks the trunk (rad/s, + = forward / raises the left side) and changes the
   * body's ground velocity by (dvx, dvz): the rock is the trunk's whole response to it,
   * so that change is no acceleration for the trunk to lag behind as well.
   */
  push(pitchRate: number, rollRate: number, dvx: number, dvz: number) {
    this.lagPitch.velocity += pitchRate;
    this.lagRoll.velocity += rollRate;
    if (this.tracked) return;
    this.lastVel.x += dvx;
    this.lastVel.z += dvz;
  }

  /** `tracked`: a body part is tracked — the body moves as it does, the root only chases it */
  update(g: Gait, tracked: boolean, dt: number) {
    const d = this.d;
    const [lf, rf] = g.feet;
    const walk = g.walk;
    const run = g.run;
    const hips = this.style.hips;
    const fwd = forwardOf(g.root.yaw, _f);
    // pelvic rotation: walking, the swinging leg's hip travels forward with it (~±4°,
    // Saunders; ~5° range at 1.4 m/s, Huthwelker 2023); running, the other way (CMU mocap)
    const la = lf.pose.ankle;
    const ra = rf.pose.ankle;
    const ahead = (la.x - ra.x) * fwd.x + (la.z - ra.z) * fwd.z;
    // (saturating softly: a runner's long strides would square a clamp off into jerks)
    this.pelvisYaw = -0.09 * Math.tanh(1.2 * ahead) * walk * hips * lerp(1, -1, run);
    this.chestYaw = lerp(COUNTER.walk, COUNTER.run, run) * this.pelvisYaw;
    this.thoraxYaw = this.pelvisYaw - this.chestYaw;
    this.thoraxRoll = -lerp(THORAX_ROLL.walk, THORAX_ROLL.run, run) * this.thoraxYaw;
    let roll = 0;
    let swayTarget = 0;
    let bob = 0;
    // the step's nod phase: 1 in double support, cos 2πs through the swing (no kink at lift-off or touch-down)
    let nodPhase = 1;
    for (const f of g.feet) {
      if (f.phase === 'swing') {
        // pelvic list: the swing side drops (~4°, Perry) while the weight is on the other leg,
        // and the pelvis shifts over that stance foot (~2 cm each way), furthest at mid-stance
        // and back over the middle by the double support (a stance-phased sine, not a step);
        // a runner's feet land near one line and the pelvis barely sways
        roll += -f.side * 0.07 * Math.sin(Math.PI * Math.min(1, f.swing.s * 1.3)) * walk * hips;
        swayTarget = -f.side * 0.013 * d.height * Math.sin(Math.PI * f.swing.s) * (1 - 0.6 * g.run) * walk * hips;
        bob = Math.sin(Math.PI * f.swing.s);
        nodPhase = Math.cos(2 * Math.PI * f.swing.s);
      }
      if (f.phase === 'lifted') swayTarget = -f.side * 0.03 * d.height * f.liftWeight;
    }
    this.bobPhase = bob;
    this.side = dt > 0 ? this.sway.step(swayTarget, SWAY_RATE, dt) : 0;
    // inverted-pendulum bob: lowest in double support, highest at mid-stance (~3–4 cm p-p)
    // (the legs' geometry already dips the pelvis in double support; add only a hint)
    const walkLift = -(0.001 + BOB * (1 - bob)) * d.height * walk;
    // running: the leg compresses through stance (lowest mid-stance), the body flies
    let runLift = 0;
    let comp = 0;
    if (run > 0) {
      const t = g.timing();
      for (const f of g.feet) if (f.phase === 'planted') comp = Math.max(comp, Math.sin(Math.PI * clamp(f.plantedTime / t.stance, 0, 1)));
      runLift = -(0.025 + 0.03 * comp) * d.height;
    }
    // (a jump's countermovement, flight and landing on top)
    const { jump, mount } = g;
    this.lift = lerp(walkLift, runLift, run) + jump.lift;
    // (riding, the whole body inclines into the mount's acceleration)
    this.tilt = mount.owns ? mount.tilt : null;
    this.pivot.copy(mount.pivot);
    // (running: sin², no kink at touch-down and take-off)
    const nod = lerp(NOD.walk * (nodPhase - 0.2), NOD.run * (comp * comp - 0.35), run) * walk;
    const idle = 1 - walk;
    // (riding, the mount carries the weight: no shifting it from foot to foot)
    const stand = mount.owns ? 0 : idle;
    const c = (this.clock += dt) * 2 * Math.PI;
    const H = d.height;
    if (dt > 0) this.weight.step(g.feet[1 - g.lastLanded].side, 2, dt);
    this.swayAhead = stand * IDLE.sway * H * (Math.sin(0.21 * c) + 0.5 * Math.sin(0.37 * c + 1));
    this.swayLeft = stand * H * (IDLE.weight * this.weight.value + IDLE.sway * (Math.sin(0.16 * c + 2) + 0.4 * Math.sin(0.29 * c)));
    const breath = idle * IDLE.breath * Math.sin(0.25 * c);
    // (standing on one leg's hip, the free side drops: its knee eases)
    this.pelvisRoll = roll + stand * IDLE.list * this.weight.value * hips + g.move.roll;
    // weight: the upper body lags when the body accelerates (a little lurch back when
    // setting off, forward when stopping), then settles with a slight overshoot
    const vel = tracked ? g.targetVel : g.velocity;
    if (tracked !== this.tracked) this.lastVel.copy(vel);
    this.tracked = tracked;
    if (dt > 0) {
      const acc = _acc.subVectors(vel, this.lastVel).divideScalar(dt);
      this.lastVel.copy(vel);
      // (riding, what the lean has not taken up: yet, or the body being held in place)
      if (mount.owns) acc.addScaledVector(mount.accel, -mount.share);
      const left = leftOf(g.root.yaw, _l);
      this.lagPitch.step(-LAG_GAIN * clamp(acc.dot(fwd), -4, 4), dt);
      this.lagRoll.step(LAG_GAIN * clamp(acc.dot(left), -4, 4), dt);
      this.lagPitch.value = clamp(this.lagPitch.value, -0.25, 0.25);
      this.lagRoll.value = clamp(this.lagRoll.value, -0.2, 0.2);
    }
    // (climbing stairs or a slope, the trunk leans on into it: ~5° more, McFadyen & Winter 1988;
    // and into a force at the hands, with the body: forward pushing, back pulling)
    const incline = STAIR_LEAN * Math.max(0, g.incline.value) + leanInto(g);
    this.lean = gaitLean(walk, run) + nod + breath + this.lagPitch.value + jump.lean + g.move.lean + incline;
    this.shift = -NOD_SHIFT * (nod + jump.lean) * d.height;
    this.chestRoll = this.lagRoll.value + g.move.roll;
  }

  /**
   * A tracked head/chest/pelvis path without its own gait oscillation (a scripted path,
   * a joystick) would pin the body on rails: the targets the posture meets ride the gait's
   * bob and sway. Real trackers already bob (`trackerBob`), and are met exactly.
   */
  ride(t: Tracked, g: Gait, trackerBob: number) {
    const out = this.ridden;
    out.head = t.head && copyTask(t.head, this.riddenHead);
    out.chest = t.chest && copyOriented(t.chest, this.riddenChest);
    out.hips = t.hips && copyOriented(t.hips, this.riddenHips);
    const k = 1 - smoothstep(0.004, 0.012, trackerBob);
    if (k <= 0) return;
    const left = leftOf(g.root.yaw, _l);
    const fwd = forwardOf(g.root.yaw, _f);
    // (the untracked body gets its bob from the legs' geometry; a pinned height has none,
    // so add the inverted-pendulum rise over the stance leg: ~3 cm peak to peak)
    const bob = (0.017 * this.bobPhase - 0.012) * this.d.height * g.walk * (1 - g.run) * smoothstep(0.3, 1.2, g.speed);
    const rise = (this.lift + bob) * k;
    const sway = this.side * k;
    carry(out.head, rise, left, sway, fwd, 0);
    carry(out.chest, rise, left, sway, fwd, 0);
    // (standing, the weight shifts and wanders under the head: a pelvis target carries it)
    carry(out.hips, rise, left, sway + this.swayLeft * k, fwd, this.swayAhead * k);
  }
}

function copyTask(t: Task, out: Task): Task {
  out.pos.copy(t.pos);
  out.weight = t.weight;
  return out;
}

function copyOriented(t: OrientedTask, own: OwnedTask): OrientedTask {
  const out = own.task;
  out.pos = t.pos && own.pos.copy(t.pos);
  out.rot = t.rot && own.rot.copy(t.rot);
  out.weight = t.weight;
  return out;
}

/** a ridden target moved by the gait: up by `rise`, along `left` by `sway`, along `fwd` by `ahead` */
function carry(t: Task | OrientedTask | null, rise: number, left: Vector3, sway: number, fwd: Vector3, ahead: number) {
  if (!t?.pos) return;
  t.pos.y += rise;
  t.pos.addScaledVector(left, sway).addScaledVector(fwd, ahead);
}
