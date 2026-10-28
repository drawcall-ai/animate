// The root planner: a root stream toward a goal — the same a player's input makes — for a stepper to follow.
import { Quaternion, Vector3 } from 'three';
import { STEP, type Frame } from '../kernel/frame';
import { follow } from '../kernel/follow';
import type { Motion } from '../kernel/goal';
import { clamp, lerp, smoothstep, wrapAngle, yawOf } from '../kernel/math';
import { strideAt, type Gait } from '../species/gait';
import type { Steering } from './step/state';

/** A floor-plane goal: where, moving how fast (m/s), and the facing to arrive at (rad; none: face the way it goes). */
interface PlannerGoal { position: Vector3; velocity?: Vector3; yaw?: number }

/** a root as planned: its point on the floor, its turn, its velocity (m/s) and turn rate (rad/s) */
interface RootState { position: Vector3; yaw: number; velocity: Vector3; angular: number }

/**
 * Pursues a goal under `Motion` limits (`rootPlan`: braking by v² = 2ad, turning no faster than a/v, the arrival turn begun
 * in time to finish it), writing `root` as a player's input would. Each sub-step it takes the fastest forecast `holds`
 * accepts — at full speed and turn, else the largest share of both it accepts, at last standing — so the legs can keep up (`Stepper.reachable`).
 */
export class Planner {
  readonly root: Steering;
  private readonly state: RootState;
  private goalVelocity: Vector3 | null = null;

  /** `radius`: the hips' furthest reach from the root (m), how wide it turns about itself */
  constructor(at: Vector3, yaw: number, private readonly gait: Gait, private readonly radius: number) {
    this.state = { position: at.clone().setY(0), yaw: yawOf(_turn.setFromAxisAngle(UP, yaw)), velocity: new Vector3(), angular: 0 };
    this.root = { position: this.state.position.clone(), velocity: new Vector3(), yaw };
  }

  /** One sub-step toward `goal`; `stance`: the feet's mean facing (rad); `holds`: whether the legs keep up with a forecast. */
  step(f: Frame, goal: PlannerGoal, motion: Motion, stance: number, holds: (forecast: (ahead: number) => { position: Vector3; yaw: number }) => boolean): Steering {
    const velocity = goal.velocity ?? new Vector3(), speed = velocity.length(), last = this.goalVelocity;
    // (the goal's own speeding up and turning, foreseen)
    const acceleration = last && speed > 1e-6 ? Math.max(-motion.accel, Math.min(motion.accel, velocity.clone().sub(last).dot(velocity) / (speed * f.dt))) : 0;
    const goalTurn = last && speed > 1e-6 && last.lengthSq() > 1e-12 ? wrapAngle(Math.atan2(velocity.x, velocity.z) - Math.atan2(last.x, last.z)) / f.dt : 0;
    (this.goalVelocity ??= new Vector3()).copy(velocity);
    const facing = goal.yaw === undefined ? undefined : new Quaternion().setFromAxisAngle(UP, goal.yaw);
    const targets = [goal.position.clone()];
    // (at rest on a still goal, facing as asked, it stays as it is however far ahead it is read, at any share: a standing body's plan)
    const still = resting(goal.position, velocity, acceleration, goalTurn, this.state, facing) ? keptAt(this.state) : null;
    const planned = (share: number) => still ?? rootPlan(f, goal.position, velocity, motion, this.gait, this.radius, this.state, acceleration, facing, share, goalTurn, stance, targets);
    let accepted: ReturnType<typeof planned> | undefined;
    const kept = (plan: ReturnType<typeof planned>) => {
      const fits = holds((ahead) => plan(f.time + ahead));
      if (fits) accepted = plan;
      return fits;
    };
    // (the largest share of its speed and turn the legs keep up with, found to within `PRECISION`: none, it stands. Sought down from
    // whole before halving between: on a bend, a share just short of whole may hold where a slower one does not)
    let plan = planned(1);
    this.root.turning = undefined;
    if (!kept(plan)) {
      // (the turn it is held back from, as it would be under way)
      this.root.turning = plan(f.time + PRESSING).angular;
      // (a plan at rest is the same at any share: there is none to search)
      if (!still) {
        let [lo, hi] = [0, 1];
        for (let short = PRECISION; short < 1 && lo === 0; short *= 2) [lo, hi] = kept(planned(1 - short)) ? [1 - short, hi] : [0, 1 - short];
        while (hi - lo > PRECISION) { const mid = (lo + hi) / 2; if (kept(planned(mid))) lo = mid; else hi = mid; }
        plan = accepted ?? planned(0);
      }
    }
    const chosen = plan, now = f.time;
    this.root.forecast = (ahead) => chosen(now + ahead);
    const next = plan(f.time);
    this.state.velocity.subVectors(next.position, this.state.position).setY(0).divideScalar(f.dt);
    this.state.angular = wrapAngle(next.yaw - this.state.yaw) / f.dt;
    this.state.position.copy(next.position).setY(0);
    this.state.yaw = next.yaw;
    this.root.position.copy(this.state.position);
    this.root.velocity.copy(this.state.velocity);
    this.root.yaw = this.state.yaw;
    return this.root;
  }
}

/**
 * The root planned from `previous` toward `goal` (moving at `velocity`, speeding up by `acceleration` and turning `goalTurn` rad/s), at
 * `share` of its speed and turn, arriving facing `facing` if given: where it is at a time (s). It walks facing its way, as people do,
 * turning to an asked facing only once near and slow.
 */
function rootPlan(
  f: Frame, goal: Readonly<Vector3>, velocity: Vector3, motion: Motion, gait: Gait, radius: number, previous: RootState, acceleration: number,
  facing: Quaternion | undefined, share: number, goalTurn: number, stanceYaw: number, targets: Vector3[],
): (time: number) => RootState {
  const accel = motion.accel;
  const speed = share === 0 ? 0 : (motion.speed ?? Infinity) * share;
  const cruise = Math.max(gait.slowest, Number.isFinite(motion.speed ?? Infinity) ? motion.speed ?? Infinity : previous.velocity.length());
  const braking = cruise ** 2 / (2 * motion.accel);
  const stride = strideAt(gait, cruise, 0);
  const midstance = cruise * stride.duty / (2 * stride.frequency);
  const states: RootState[] = [], goalSpeed = velocity.length(), facingYaw = facing ? yawOf(facing) : 0;
  const advance = (from: RootState, ahead: number): RootState => {
    const yaw = from.yaw;
    const accelerating = acceleration === 0 ? ahead : Math.min(ahead, Math.max(0,
      acceleration > 0 ? ((motion.speed ?? Infinity) - goalSpeed) / acceleration : -goalSpeed / acceleration));
    const travel = goalSpeed * accelerating + 0.5 * acceleration * accelerating ** 2
      + Math.max(0, goalSpeed + acceleration * accelerating) * (ahead - accelerating);
    const target = _target.copy(goal).addScaledVector(velocity, acceleration === 0 ? ahead : goalSpeed > 0 ? travel / goalSpeed : 0);
    const futureVelocity = _velocity.copy(velocity);
    if (goalTurn !== 0 && goalSpeed > 0) {
      const tick = Math.round(ahead / STEP);
      while (targets.length <= tick) {
        const t = (targets.length - 0.5) * STEP;
        const v = Math.max(0, Math.min(motion.speed ?? Infinity, goalSpeed + acceleration * t));
        targets.push(targets[targets.length - 1].clone().addScaledVector(_direction.copy(velocity).applyAxisAngle(UP, goalTurn * t), v / goalSpeed * STEP));
      }
      target.copy(targets[tick]);
      futureVelocity.applyAxisAngle(UP, goalTurn * ahead).setLength(Math.max(0, goalSpeed + acceleration * accelerating));
    }
    const delta = target.sub(from.position).setY(0);
    const distance = delta.length();
    const heading = distance > 1e-9 ? Math.atan2(delta.x, delta.z) : yaw;
    // Start within the distance needed to brake translation and complete the goal turn (derived).
    const turnAngle = facing ? Math.abs(wrapAngle(facingYaw - heading)) : 0;
    const duration = turnAngle === 0 ? 0 : Math.max(2 * Math.sqrt(turnAngle / (motion.turnAccel ?? motion.accel / radius)), turnAngle / (motion.turnSpeed ?? Infinity), 1 / stride.frequency);
    const arrival = facing ? clamp(1 - distance / (Math.max(braking, cruise * duration) + midstance), 0, 1) : 0;
    // Follow in the goal's moving frame: braking closes the gap in addition to its velocity.
    // Brake closing speed with root deceleration minus the target's deceleration (derived).
    const turnAccel = motion.turnAccel ?? motion.accel / radius;
    const remaining = facing ? Math.abs(wrapAngle(facingYaw - yaw)) : 0;
    const turning = Math.min(motion.turnSpeed ?? Infinity, motion.accel / Math.max(gait.slowest, from.velocity.length())) * share;
    const untilFacing = remaining === 0 ? 0 : Math.max(2 * Math.sqrt(remaining / turnAccel), remaining / turning);
    // Keep translating until the remaining turn can finish, rather than exhaust the approach first (derived).
    // (never held still to turn first: a goal far off the facing — further than it may face off its way, `sidelong`: near a still goal,
    // any way — is walked to more and more slowly, then turned to first)
    const sidelong = lerp(Math.PI, SIDELONG, Math.max(smoothstep(ARRIVAL_TURN[0] * midstance, ARRIVAL_TURN[1] * midstance, distance), smoothstep(STILL, 2 * STILL, goalSpeed)));
    const first = 1 - smoothstep(TURN_FIRST[0], TURN_FIRST[1], Math.abs(wrapAngle(heading - yaw)) - sidelong + SIDELONG);
    const closing = (arrival > 0 && untilFacing > 0 ? Math.min(speed, distance / untilFacing) : speed) * first;
    const wanted = delta.setLength(distance > 1e-9 ? Math.sqrt(2 * Math.max(0, accel + Math.min(0, acceleration)) * distance) : 0)
      .add(futureVelocity).clampLength(0, closing);
    const next = from.velocity.clone().add(wanted.sub(from.velocity).clampLength(0, accel * STEP));
    const v = next.length();
    const travelYaw = v > 1e-4 ? Math.atan2(next.x, next.z) : facing ? heading : yaw;
    const goalAngle = facing ? wrapAngle(facingYaw - travelYaw) : 0, direction = Math.sign(goalAngle);
    // (the body faces the way it goes, as people do, until it arrives; only arriving does it hold what it has turned)
    const holding = smoothstep(0, ARRIVING, arrival);
    const progress = Math.max(Math.abs(goalAngle) * arrival, holding * direction * wrapAngle(stanceYaw - travelYaw), holding * direction * wrapAngle(yaw - travelYaw));
    // (and turns from the way it goes no further than `sidelong`: nobody walks off sideways or backward but for the last steps)
    const bearing = facing ? travelYaw + direction * Math.min(Math.abs(goalAngle), progress, sidelong) : travelYaw;
    // (asked to face about and its way about too, it turns round the side the facing lies: within `ABOUT` of a half turn either side
    // reads alike, and it would set off one way only to come back round the other)
    const direct = wrapAngle(bearing - yaw), toFacing = facing ? wrapAngle(facingYaw - yaw) : direct;
    const angle = Math.min(Math.abs(direct), Math.abs(toFacing)) > Math.PI - ABOUT && toFacing * direct < 0 ? direct - Math.sign(direct) * 2 * Math.PI : direct;
    const turn = Math.min(motion.turnSpeed ?? Infinity, motion.accel / Math.max(gait.slowest, v)) * share;
    const desired = Math.sign(angle) * Math.min(turn, Math.abs(angle) / STEP);
    let angular = Math.max(from.angular - turnAccel * STEP, Math.min(from.angular + turnAccel * STEP, desired));
    angular = facing && turnAccel > 0 && Number.isFinite(turnAccel)
      ? (follow(yaw - from.angular * STEP, yaw, yaw + angle, { accel: turnAccel, speed: turn }, STEP) - yaw) / STEP
      : Math.sign(angle) * Math.min(Math.abs(angular), Math.abs(angle) / STEP);
    if (Math.abs(angular) < 1e-9) angular = 0;
    return {
      position: from.position.clone().addScaledVector(next, STEP).setY(from.position.y),
      yaw: yawOf(_turn.setFromAxisAngle(UP, yaw + angular * STEP)),
      velocity: next, angular,
    };
  };
  return (time) => {
    const tick = Math.max(0, Math.round((time - f.time) / STEP));
    while (states.length <= tick) states.push(advance(states[states.length - 1] ?? previous, states.length * STEP));
    return states[tick];
  };
}

/** the plan of a root resting as `previous` is (`resting`): where it is, still, at any time */
function keptAt(previous: RootState): (time: number) => RootState {
  const kept: RootState = { position: previous.position.clone(), yaw: yawOf(_turn.setFromAxisAngle(UP, previous.yaw)), velocity: new Vector3(), angular: 0 };
  return () => kept;
}

/**
 * whether a root `previous` rests on its goal: still, not turning, on a goal at rest (not speeding up nor turning), facing it is asked
 * (or none) — the plan from it, `advance` after `advance`, stays where it is to within `RESTING`
 */
function resting(goal: Readonly<Vector3>, velocity: Vector3, acceleration: number, goalTurn: number, previous: RootState, facing: Quaternion | undefined): boolean {
  if (acceleration !== 0 || goalTurn !== 0 || velocity.lengthSq() > RESTING.speed ** 2) return false;
  if (Math.abs(previous.angular) > RESTING.turn || previous.velocity.lengthSq() > RESTING.speed ** 2) return false;
  if (Math.hypot(goal.x - previous.position.x, goal.z - previous.position.z) > RESTING.distance) return false;
  return !facing || Math.abs(wrapAngle(yawOf(facing) - previous.yaw)) <= RESTING.yaw;
}

/** the way a body's feet face, on average (rad about +Y), as its root faces `rootYaw`: each foot's yaw less its toe-out (`toeOut`, rad) */
export function stanceYaw(legs: readonly { yaw: number; sign: 1 | -1 }[], rootYaw: number, toeOut = 0): number {
  return legs.reduce((sum, leg) => sum + wrapAngle(leg.yaw - leg.sign * toeOut - rootYaw), 0) / legs.length + rootYaw;
}

/** whether a goal `heading` away (rad) is off the way a root facing `rootYaw` goes: it turns to it first, facing it till it is on its way */
export const offTheWay = (heading: number, rootYaw: number) => Math.abs(wrapAngle(heading - rootYaw)) >= Math.PI / 4;

/** Tuned: how far ahead (s) the turn it is held back from is read, under way */
const PRESSING = 0.5;
/** Tuned: how finely the share of speed and turn the legs keep up with is found */
const PRECISION = 1 / 64;
/**
 * Tuned: how far into its arrival turn (share) it comes to hold the turn it has made toward the asked facing; until this close (× its
 * stride's mid-stance travel: ~0.45–1.1 m walking) it faces no further than `SIDELONG` (rad) off the way it goes
 */
const ARRIVING = 0.2, ARRIVAL_TURN = [1, 2.5] as const, SIDELONG = 0.3;
/** Tuned: a goal this far off the facing (rad) is walked to more and more slowly, then turned to first */
const TURN_FIRST = [0.6, 1.3] as const;
/** Tuned: how near a half turn (rad) its way and the facing asked are each taken as about */
const ABOUT = 0.35;
/** Tuned: a goal moving slower than this (m/s) is still: arrived at, it may be faced any way */
const STILL = 0.08;
/**
 * Derived: at rest within these (m/s, m, rad/s, rad) a plan moves nowhere — `advance` leaves a goal within 1e-9 m where it stands (it
 * heads for it from where it is) and zeroes a turn rate under 1e-9 rad/s (a facing 1e-12 rad off turns it slower); a speed of 1e-9 m/s
 * or a turn of 1e-9 rad/s would carry it under a nanometre or a nanoradian over a forecast's second
 */
const RESTING = { speed: 1e-9, distance: 1e-9, turn: 1e-9, yaw: 1e-12 };
const UP = new Vector3(0, 1, 0), _target = new Vector3(), _velocity = new Vector3(), _direction = new Vector3(), _turn = new Quaternion();
