import type { Gait, Root } from '../gait/gait';
import { gaitLean, leanInto } from '../gait/overlay';
import { hypot } from '../math';
import type { Tasks } from '../intent/tasks';
import type { Proportions } from '../proportions';
import type { Stance } from '../stance';
import { PostureCost } from './cost';
import { SolveMemo } from './memo';
import type { Effort } from './lm';
import { NP, P, resetPosture, ZERO_OVERLAY } from './trunk';

/**
 * Warm-started from last tick's plan: iterate while a step still lowers the cost by
 * 0.2%. (A looser criterion stops on the slow creep the hinge terms cause, and the
 * move/stay decision then flips on under-converged costs.)
 */
const PLAN_EFFORT: Effort = { maxIterations: 6, minDecrease: 0.002 };
/** a plan moving faster than this (m/s) is walked after, however little a step pays */
const FOLLOW_SPEED = 0.15;
/** how quickly the plan's speed is picked up (1/s) */
const PLAN_SPEED_RATE = 6;
/** pricing standing still: the plan with its root pulled back to where the body stands */
const STAY_EFFORT: Effort = { maxIterations: 3, minDecrease: 0 };

/**
 * Where should I stand? Minimises the posture cost with the root free (the plan) and with
 * the root fixed where it is (staying), and moves the goal only when stepping clearly
 * pays off — people don't shuffle for marginal gains.
 */
export class Planner {
  private plan = new Float64Array(NP);
  readonly target: Root = { x: 0, y: 0, z: 0, yaw: 0 };
  private stay = new Float64Array(NP);
  /** the goal is frozen where the body stands */
  private staying = false;
  private cost: PostureCost;
  /** the gait's steady lean, without its oscillations: the plan stands the body as it walks (or leans into a push) */
  private lean = { ...ZERO_OVERLAY };
  /** re-planning waits while the plan settled and its dependencies hold still */
  private memo = new SolveMemo();
  /** how fast the plan moves (m/s, smoothed) */
  private planSpeed = 0;
  /** the costs the last plan found */
  private moveCost = 0;
  private stayCost = 0;

  constructor(
    private d: Proportions,
    stance: Stance,
    tasks: Tasks,
    private gait: Gait,
  ) {
    this.cost = new PostureCost(d, stance, tasks, gait.root, true, tasks, this.lean);
  }

  reset(x: number, z: number, yaw: number) {
    this.memo.forget();
    resetPosture(this.plan, x, z, yaw, this.cost.stance.crouch);
    Object.assign(this.target, { x, y: 0, z, yaw });
    this.staying = true;
  }

  /**
   * `drop`: the current (settled) pelvis drop; `eager`: a tracked body part is walking —
   * follow it, no stop-start; `seatHolds`: the seat sequence keeps the body where it is.
   */
  update(drop: number, eager: boolean, seatHolds: boolean, dt: number) {
    const g = this.gait;
    this.cost.walk = g.walk;
    this.cost.crossing = g.jump.over;
    this.lean.lean = gaitLean(g.walk, g.run) + leanInto(g);
    const x = this.plan[P.X];
    const z = this.plan[P.Z];
    this.solve();
    if (dt > 0) this.planSpeed += (hypot(this.plan[P.X] - x, this.plan[P.Z] - z) / dt - this.planSpeed) * Math.min(1, PLAN_SPEED_RATE * dt);
    const { moveCost, stayCost } = this;
    // nobody shuffles around in a deep crouch (judged by the planned squat too: don't
    // start shuffling as you go down); a tracked head is followed continuously
    const crouch = Math.max(0, Math.max(drop, this.stay[P.DROP]) - 0.03 * this.d.height);
    const worth = stayCost - moveCost > (g.moving ? 0.035 : 0.06) * (eager ? 0.2 : 1) + 1.2 * crouch;
    // (a walk follows its plan: stopping short of a goal that keeps moving would lurch —
    // brake, then surge — and a plan that moves off, carrying what the hands hold, is
    // walked after at once)
    const follow = g.moving || (this.movingOff && crouch <= 0);
    if ((worth || follow) && !seatHolds) {
      this.target.x = this.plan[P.X];
      this.target.z = this.plan[P.Z];
      this.target.yaw = this.plan[P.YAW];
      this.staying = false;
    } else this.stayHere();
  }

  /** the plan moves off (the hands are carrying something away): the feet follow eagerly */
  get movingOff() {
    return this.planSpeed > FOLLOW_SPEED;
  }

  /** re-plan, and price staying — unless the plan held: then so does the price */
  private solve() {
    const { cost, memo } = this;
    cost.fixRoot = false;
    const moveCost = cost.minimize(this.plan, PLAN_EFFORT, memo);
    if (memo.reused) return;
    this.moveCost = moveCost;
    this.stay.set(this.plan);
    cost.fixRoot = true;
    this.stayCost = cost.minimize(this.stay, STAY_EFFORT);
  }

  /** nothing asked of the body: stand where it is */
  idle() {
    this.memo.forget();
    this.stayHere();
    this.plan[P.X] = this.target.x;
    this.plan[P.Z] = this.target.z;
    this.plan[P.YAW] = this.target.yaw;
  }

  /** freeze the goal where we are (a goal that follows the root would feed its own velocity back) */
  private stayHere() {
    if (this.staying) return;
    this.staying = true;
    Object.assign(this.target, this.gait.root);
  }
}
