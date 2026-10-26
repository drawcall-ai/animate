// The root planner: a root stream toward a goal — the same a player's input makes — for a stepper to follow.
import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../kernel/frame';
import type { Motion } from '../kernel/goal';
import { wrapAngle, yawOf } from '../kernel/math';
import type { Gait } from '../species/gait';
import { rootPlan, type RootState } from './root';
import type { RootGoal } from './step/state';

/** A floor-plane goal: where, moving how fast (m/s), and the facing to arrive at (rad; none: face the way it goes). */
export interface PlannerGoal { position: Vector3; velocity?: Vector3; yaw?: number }

/**
 * Pursues a goal under `Motion` limits (`rootPlan`: braking by v² = 2ad, turning no faster than a/v, the arrival turn begun
 * in time to finish it), writing `root` as a player's input would. Each sub-step it takes the fastest forecast `holds`
 * accepts — at full speed and turn, else the largest share of both it accepts, at last standing — so the legs can keep up (`Stepper.reachable`).
 */
export class Planner {
  readonly root: RootGoal;
  private readonly state: RootState;
  private goalVelocity: Vector3 | null = null;

  /**
   * `radius`: the hips' furthest reach from the root (m), how wide it turns about itself; `easing`: held back, it first takes the largest
   * share of its acceleration and turn the legs keep up with, still going for its full speed, before it gives up speed itself — a body
   * whose feet adapt their stride only as they step (a gait's) gets there over a few strides
   */
  constructor(at: Vector3, yaw: number, private readonly gait: Gait, private readonly radius: number, private readonly easing = false) {
    this.state = { position: at.clone().setY(0), quaternion: new Quaternion().setFromAxisAngle(UP, yaw), velocity: new Vector3(), angular: 0 };
    this.root = { position: this.state.position.clone(), velocity: new Vector3(), yaw };
  }

  /** One sub-step toward `goal`; `stance`: the feet's mean facing (rad); `holds`: whether the legs keep up with a forecast. */
  step(f: Frame, goal: PlannerGoal, motion: Motion, stance: number, holds: (forecast: (ahead: number) => { position: Vector3; yaw: number }) => boolean): RootGoal {
    const velocity = goal.velocity ?? new Vector3(), speed = velocity.length(), last = this.goalVelocity;
    // (the goal's own speeding up and turning, foreseen)
    const acceleration = last && speed > 1e-6 ? Math.max(-motion.accel, Math.min(motion.accel, velocity.clone().sub(last).dot(velocity) / (speed * f.dt))) : 0;
    const goalTurn = last && speed > 1e-6 && last.lengthSq() > 1e-12 ? wrapAngle(Math.atan2(velocity.x, velocity.z) - Math.atan2(last.x, last.z)) / f.dt : 0;
    (this.goalVelocity ??= new Vector3()).copy(velocity);
    const facing = goal.yaw === undefined ? undefined : new Quaternion().setFromAxisAngle(UP, goal.yaw);
    const planned = (share: number) => rootPlan(f, goal.position, velocity, motion, this.gait, this.radius, 1, this.state, acceleration, facing, share, goalTurn, share, stance, true);
    const kept = (plan: ReturnType<typeof planned>) => holds((ahead) => { const root = plan.root(f.time + ahead); return { position: root.position, yaw: yawOf(root.quaternion) }; });
    // (the largest share of its speed and turn the legs keep up with, found to within `PRECISION`: none, it stands)
    let plan = planned(1);
    this.root.turning = undefined;
    if (!kept(plan)) {
      // (the turn it is held back from, as it would be under way)
      this.root.turning = plan.root(f.time + PRESSING).angular;
      const eased = (share: number) => rootPlan(f, goal.position, velocity, motion, this.gait, this.radius, share, this.state, acceleration, facing, share, goalTurn, 1, stance, true);
      const easing = this.easing && kept(eased(PRECISION)), plans = easing ? eased : planned;
      let [lo, hi] = [easing ? PRECISION : 0, 1];
      while (hi - lo > PRECISION) { const mid = (lo + hi) / 2; if (kept(plans(mid))) lo = mid; else hi = mid; }
      plan = plans(lo);
    }
    const chosen = plan, now = f.time;
    this.root.forecast = (ahead) => { const root = chosen.root(now + ahead); return { position: root.position.clone().setY(0), yaw: yawOf(root.quaternion) }; };
    const next = plan.root(f.time);
    this.state.velocity.subVectors(next.position, this.state.position).setY(0).divideScalar(f.dt);
    this.state.angular = wrapAngle(yawOf(next.quaternion) - yawOf(this.state.quaternion)) / f.dt;
    this.state.position.copy(next.position).setY(0);
    this.state.quaternion.copy(next.quaternion);
    this.root.position.copy(this.state.position);
    this.root.velocity.copy(this.state.velocity);
    this.root.yaw = yawOf(this.state.quaternion);
    return this.root;
  }
}

/** Tuned: how far ahead (s) the turn it is held back from is read, under way */
const PRESSING = 0.5;
/** Tuned: how finely the share of speed and turn the legs keep up with is found */
const PRECISION = 1 / 64;
const UP = new Vector3(0, 1, 0);
