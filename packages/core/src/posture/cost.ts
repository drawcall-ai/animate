import { Vector3 } from 'three';
import type { Root } from '../gait/gait';
import { isSphere, type Box } from '../input';
import { tracksBody, type HandTask, type Tasks, type Tracked } from '../intent/tasks';
import { clamp, forwardOf, hypot, leftOf, lerp, smoothstep, wrapAngle } from '../math';
import type { Proportions } from '../proportions';
import { stanceFeet, type Stance } from '../stance';
import { LevenbergMarquardt, type Effort, type Residuals } from './lm';
import type { SolveMemo } from './memo';
import { balanceRows } from './terms/balance';
import { comfortRows } from './terms/comfort';
import { footingRows } from './terms/footing';
import { handRows, sightLine, type Sight } from './terms/hands';
import { targetRows } from './terms/targets';
import { createTrunkFrame } from '../pose/frames';
import { NP, P, standingHeadDepth, trunkFK, ZERO_OVERLAY, type Overlay } from './trunk';

/** residual rows the buffers hold; exceeding it throws (many floor or body obstacles) */
const MAX_ROWS = 256;
/** how far (× height) a box overhead may still be from the upright head when the walk starts giving it room to duck */
const DUCK_AHEAD = 0.05;
/** how far (× height) the centre of mass is held off the feet by a force at the hands as walking starts to lean into it, and fully */
const STRAIN = { from: 0.01, to: 0.08 };
/** riding standing up, the knees are soft: the pelvis's preferred drop (× height; knees ~60°) */
const MOUNTED_CROUCH = 0.07;
/** getting on or off a mount, how far the pelvis may be off the root, any way (m, default body) */
const BOARDING = 0.6;
/** largest facing change per solver step (rad): no flips toward the far side */
const MAX_YAW_STEP = 0.5;

const _sight: Sight = { origin: new Vector3(), dir: new Vector3(), rear: 0 };

// shared by every cost (solves run one at a time)
const lm = new LevenbergMarquardt(NP, MAX_ROWS);
lm.maxStep[P.YAW] = MAX_YAW_STEP;

/**
 * The cost of a trunk posture, minimised over the posture parameters within their limits,
 * for one of two questions. The planner's: where should I stand? (root free, or fixed to
 * price standing where the body is). The posture's: how do I hold my trunk where the gait
 * put the root? The owner sets the per-tick fields before each `minimize`.
 *
 * The cost is a table of residual rows whose layout is fixed for a solve: which rows exist
 * depends only on what the solve is given — the question, the targets present, the feet
 * that bear weight — and a row that exists is written in every evaluation, 0 while it does
 * not apply to the evaluated posture. Rows are grouped by concern in ./terms.
 */
export class PostureCost implements Residuals {
  // ---- set by the owner
  /** the gait's walking amount: 0 standing, 1 walking at speed (balance is dynamic then) */
  walk = 0;
  /** (planner) the root is held where it is */
  fixRoot = false;
  /** (posture) a step is under way (or about to be): no bending or leaning mid-stride */
  stepping = false;
  /** (posture) how far the legs lowered the pelvis to reach their feet last tick (a tracked head compensates) */
  legLift = 0;
  /** (posture) the ankles bearing weight (null: lifted); walking, the gait owns leg reach: they blend into the virtual stance */
  readonly ankles: [Vector3 | null, Vector3 | null] = [null, null];
  /** (posture) the feet's headings (horizontal) */
  readonly toes: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  /** (posture) where the feet are (or are landing) right now */
  readonly footholds: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  /** (posture) how far each foot is up on its target (0 still on the floor … its target's weight); the planner plans with the targets' weights */
  readonly lifted: [number, number] = [0, 0];
  /** (posture) preferred pelvis offset (fore/aft, sideways in the bladed facing): over the planted foot while the other is lifted */
  readonly oneLeg = { shift: 0, side: 0 };

  // ---- the evaluated posture
  readonly frame = createTrunkFrame();
  /** the support facing (yaw, without the blade; the frame's facing has it): forward and left */
  readonly supportForward = new Vector3();
  readonly supportLeft = new Vector3();
  /** home feet of the support centre */
  readonly home: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  /** the feet bearing weight (null: not supporting) */
  readonly support: (Vector3 | null)[] = [null, null];

  /** the hand targets: as asked (the planner), or as acted on now (the posture) */
  readonly hands: readonly (HandTask | null)[];
  /** the pelvis drop and knee flexion (rad) preferred: the stance's, softer riding */
  crouch = 0;
  preferredFlex = 0;
  /** how far the seat carries the pelvis (posture only) */
  sit = 0;
  /** how much a raised foot outweighs the trunk's lean limits */
  kick = 0;
  /** (posture) how far a strike or throw is under way (0..1): the trunk may bend and the knees sink mid-step, following through */
  striking = 0;
  /** (posture) how far the pelvis turns ahead of the feet (rad): turning fast, toward the facing turned to */
  yawLead = 0;
  /** (posture) a stride is under way: the knees may sink mid-step into its wide stance */
  lunging = false;
  /** (posture) how far a box overhead has the body duck (0..1): walking may stoop and bend the knees then, at a quicker pace */
  duck = 0;
  /** how far a force at the hands has the body lean into it (0..1): the arms braced, walking may bend then too */
  strain = 0;
  /** (planner) a floor obstacle a jump will cross: no reason not to go past it */
  crossing: Box | null = null;
  /** the yaw the solve starts from: yaw errors are unwrapped around it */
  private yaw0 = 0;
  /** the support feet as weighted: the ankles blended into the home feet by the walk */
  private blended: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  /** the parameters' limits before a question narrows them */
  private lowerLimits: Float64Array;
  private upperLimits: Float64Array;

  constructor(
    readonly d: Proportions,
    readonly stance: Stance,
    readonly tasks: Tasks,
    /** current root (support centre + facing) */
    readonly root: Readonly<Root>,
    readonly planner: boolean,
    /** the tracked targets as the posture meets them (riding the gait's bob and sway) */
    readonly tracked: Tracked = tasks,
    /** gait oscillations the posture must live with (tracked targets compensate for them) */
    readonly overlay: Overlay = ZERO_OVERLAY,
  ) {
    this.hands = planner ? tasks.hands : tasks.reach;
    this.lowerLimits = Float64Array.of(-1e9, -1e9, -1e9, -0.04 * d.height, -0.3, -0.35, -0.45, -0.5, -0.9, -0.1);
    this.upperLimits = Float64Array.of(1e9, 1e9, 1e9, 0.62 * d.hipHeight, 0.1, 1.75, 0.8, 0.5, 0.9, 0.1);
  }

  /** Improves `p` in place; returns the cost it reached. `memo`: see `LevenbergMarquardt.solve`. */
  minimize(p: Float64Array, effort: Effort, memo: SolveMemo | null = null): number {
    const { lower, upper, active } = lm;
    const { root, tasks: t } = this;
    lower.set(this.lowerLimits);
    upper.set(this.upperLimits);
    active.fill(1);
    this.strain = smoothstep(STRAIN.from * this.d.height, STRAIN.to * this.d.height, hypot(t.lean.x, t.lean.z));
    if (!this.planner) this.boundPosture(p);
    else {
      if (this.fixRoot) {
        active[P.X] = active[P.Z] = active[P.YAW] = 0;
        p[P.X] = root.x;
        p[P.Z] = root.z;
        p[P.YAW] = root.yaw;
      }
      // the planner decides where the feet go; pelvis offsets are the posture solve's job
      active[P.SHIFT] = active[P.SIDE] = 0;
      p[P.SHIFT] = p[P.SIDE] = 0;
    }
    p[P.YAW] = root.yaw + wrapAngle(p[P.YAW] - root.yaw);
    for (let i = 0; i < NP; i++) p[i] = clamp(p[i], lower[i], upper[i]);
    this.yaw0 = p[P.YAW];
    const L = this.d.legLength;
    this.crouch = t.mount ? Math.max(this.stance.crouch, MOUNTED_CROUCH * this.d.height) : this.stance.crouch;
    this.preferredFlex = 2 * Math.acos(clamp((L - this.crouch) / L, 0, 1));
    this.sit = !this.planner && t.seat ? t.seat.weight : 0;
    let kick = 0;
    for (let s = 0; s < 2; s++) {
      const ft = t.feet[s];
      if (ft) kick = Math.max(kick, this.lift(s) * raised(ft.pos.y, this.d));
    }
    this.kick = kick;
    return lm.solve(p, this, effort, memo);
  }

  /** the root is where the gait put it; walking limits how far the trunk may bend and shift */
  private boundPosture(p: Float64Array) {
    const { d, root, walk } = this;
    const { lower, upper, active } = lm;
    const t = this.tasks;
    active[P.X] = active[P.Z] = 0;
    p[P.X] = root.x;
    p[P.Z] = root.z;
    // tiptoe only when standing still; no deep squats or dives mid-stride
    lower[P.DROP] *= 1 - smoothstep(0, 0.2, walk);
    // a tracked head stays level: the body may cancel its own gait bob
    if (t.head) lower[P.DROP] = Math.min(lower[P.DROP], this.overlay.lift + this.legLift);
    // (a tracked head/chest/pelvis overrides: the body must go where it's measured; a box
    // overhead — a low ceiling — lets the walk stoop and bend the knees as far as it must)
    let duck = -Infinity;
    for (const o of t.approaching) if (!isSphere(o)) duck = Math.max(duck, standingHeadDepth(o, root.x, root.z, d));
    this.duck = smoothstep(-DUCK_AHEAD * d.height, 0, duck);
    const walking = tracksBody(t) || t.seat ? 0 : Math.max(this.stepping ? 1 : 0, smoothstep(0.02, 0.17, walk));
    // (and so does leaning into a force at the hands: pushing a heavy crate along; and
    // sighting along something aimed, the trunk leaning into it on the move too)
    const [a, b] = this.hands;
    const sighting = t.look && a && b ? sightLine(a, b, t.look, this.frame.eyes, d, _sight) : 0;
    const upright = walking * (1 - this.duck) * (1 - this.strain) * (1 - this.striking) * (1 - sighting);
    upper[P.DROP] = lerp(upper[P.DROP], 0.035 * d.height, this.lunging ? 0 : upright);
    upper[P.HIP] = lerp(upper[P.HIP], 0.18, upright);
    upper[P.SPINE] = lerp(upper[P.SPINE], 0.08, upright);
    lower[P.ROLL] = lerp(lower[P.ROLL], -0.12, walking);
    upper[P.ROLL] = lerp(upper[P.ROLL], 0.12, walking);
    lower[P.TWIST] = lerp(lower[P.TWIST], -0.6, walking);
    upper[P.TWIST] = lerp(upper[P.TWIST], 0.6, walking);
    // the pelvis can only rotate so far over planted feet; the chest twists the rest
    lower[P.YAW] = root.yaw - 0.4;
    upper[P.YAW] = root.yaw + 0.4;
    // while walking the pelvis stays over the moving support (unless tracked)
    const k = 1 - (tracksBody(t) ? 0.2 : 0.8) * walk;
    lower[P.SHIFT] *= k;
    upper[P.SHIFT] *= k;
    lower[P.SIDE] *= k;
    upper[P.SIDE] *= k;
    // (getting on or off a mount, the pelvis goes where its contacts take it, beside it and onto it)
    if (t.mount && t.mount.weight < 1) {
      lower[P.SHIFT] = lower[P.SIDE] = -BOARDING * d.scale;
      upper[P.SHIFT] = upper[P.SIDE] = BOARDING * d.scale;
      lower[P.DROP] = -BOARDING * d.scale;
    }
    // seated, the pelvis rests well behind the feet, and comes down onto the seat wherever they are (up on pedals)
    if (t.seat) {
      lower[P.SHIFT] = lerp(lower[P.SHIFT], -0.5 * d.scale, t.seat.weight);
      upper[P.DROP] = Math.max(upper[P.DROP], d.hipHeight + root.y - t.seat.pos.y);
    }
    // on one leg, the pelvis may go over the planted foot
    const one = this.oneLeg;
    lower[P.SHIFT] = Math.min(lower[P.SHIFT], one.shift);
    upper[P.SHIFT] = Math.max(upper[P.SHIFT], one.shift);
    lower[P.SIDE] = Math.min(lower[P.SIDE], one.side);
    upper[P.SIDE] = Math.max(upper[P.SIDE], one.side);
  }

  /** how far foot `s` is lifted onto its target: as the target asks (planner), as the gait has it up (posture) */
  lift(s: number): number {
    return this.planner ? (this.tasks.feet[s]?.weight ?? 0) : this.lifted[s];
  }

  /**
   * `yaw − target`, on the branch nearest to the solve's starting yaw: continuous over
   * the solve (no flip at ±π mid-iteration), and the shortest way round from where it began.
   */
  yawError(yaw: number, target: number): number {
    return yaw - this.yaw0 + wrapAngle(this.yaw0 - target);
  }

  evaluate(p: Float64Array, r: Float64Array): number {
    const { d, frame, home, support, stance, tasks: t } = this;
    // (the posture stands at the root's level; the planner plans on the floor)
    trunkFK(p, d, stance, frame, this.overlay, t.headRot, this.legLift + (this.planner ? 0 : this.root.y));
    forwardOf(p[P.YAW], this.supportForward);
    leftOf(p[P.YAW], this.supportLeft);
    // (leaning into a force at the hands, the feet stand behind the body: the centre of mass over the root, ahead of them)
    stanceFeet(p[P.X] - t.lean.x, p[P.Z] - t.lean.z, this.supportForward, this.supportLeft, d, stance, home);
    if (!this.planner) for (const h of home) h.y += this.root.y;
    // standing and shuffling: the real feet; walking: the gait owns leg reach (the virtual stance)
    const virtual = smoothstep(0.3, 0.7, this.walk);
    for (let s = 0; s < 2; s++) {
      const lifted = t.feet[s];
      const ankle = this.ankles[s];
      // (a striding foot supports where it is being put down)
      support[s] = lifted && lifted.weight > 0.5 && (this.planner || !ankle) ? null : this.planner || !ankle ? home[s] : this.blended[s].lerpVectors(ankle, home[s], virtual);
    }
    let n = handRows(this, p, r, 0);
    n = targetRows(this, p, r, n);
    n = comfortRows(this, p, r, n);
    n = balanceRows(this, p, r, n);
    return footingRows(this, p, r, n);
  }
}

/** how far a foot target at height `y` is raised off the floor: a kick (0..1) */
export const raised = (y: number, d: Proportions) => smoothstep(0.3 * d.height, 0.55 * d.height, y);
