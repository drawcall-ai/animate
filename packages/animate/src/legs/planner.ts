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
interface RootState { position: Vector3; quaternion: Quaternion; velocity: Vector3; angular: number }

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
    this.state = { position: at.clone().setY(0), quaternion: new Quaternion().setFromAxisAngle(UP, yaw), velocity: new Vector3(), angular: 0 };
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
    const planned = (share: number) => rootPlan(f, goal.position, velocity, motion, this.gait, this.radius, this.state, acceleration, facing, share, goalTurn, stance);
    const kept = (plan: ReturnType<typeof planned>) => holds((ahead) => { const root = plan(f.time + ahead); return { position: root.position, yaw: yawOf(root.quaternion) }; });
    // (the largest share of its speed and turn the legs keep up with, found to within `PRECISION`: none, it stands. Sought down from
    // whole, each step twice the last, before it is halved in between: on a bend a share a little short may keep up where a stop does not)
    let plan = planned(1);
    this.root.turning = undefined;
    if (!kept(plan)) {
      // (the turn it is held back from, as it would be under way)
      this.root.turning = plan(f.time + PRESSING).angular;
      let [lo, hi] = [0, 1];
      for (let short = PRECISION; short < 1 && lo === 0; short *= 2) [lo, hi] = kept(planned(1 - short)) ? [1 - short, hi] : [0, 1 - short];
      while (hi - lo > PRECISION) { const mid = (lo + hi) / 2; if (kept(planned(mid))) lo = mid; else hi = mid; }
      plan = planned(lo);
    }
    const chosen = plan, now = f.time;
    this.root.forecast = (ahead) => { const root = chosen(now + ahead); return { position: root.position.clone().setY(0), yaw: yawOf(root.quaternion) }; };
    const next = plan(f.time);
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

/**
 * The root planned from `previous` toward `goal` (moving at `velocity`, speeding up by `acceleration` and turning `goalTurn` rad/s), at
 * `share` of its speed and turn, arriving facing `facing` if given: where it is at a time (s). It walks facing its way, as people do,
 * turning to an asked facing only once near and slow.
 */
function rootPlan(
  f: Frame, goal: Readonly<Vector3>, velocity: Vector3, motion: Motion, gait: Gait, radius: number, previous: RootState, acceleration: number,
  facing: Quaternion | undefined, share: number, goalTurn: number, stanceYaw: number,
): (time: number) => RootState {
  const accel = motion.accel;
  const speed = share === 0 ? 0 : (motion.speed ?? Infinity) * share;
  const cruise = Math.max(gait.slowest, Number.isFinite(motion.speed ?? Infinity) ? motion.speed ?? Infinity : previous.velocity.length());
  const braking = cruise ** 2 / (2 * motion.accel);
  const stride = strideAt(gait, cruise, 0);
  const midstance = cruise * stride.duty / (2 * stride.frequency);
  const targets = [goal.clone()];
  const states: RootState[] = [];
  const advance = (from: RootState, ahead: number): RootState => {
    const goalSpeed = velocity.length();
    const accelerating = acceleration === 0 ? ahead : Math.min(ahead, Math.max(0,
      acceleration > 0 ? ((motion.speed ?? Infinity) - goalSpeed) / acceleration : -goalSpeed / acceleration));
    const travel = goalSpeed * accelerating + 0.5 * acceleration * accelerating ** 2
      + Math.max(0, goalSpeed + acceleration * accelerating) * (ahead - accelerating);
    const target = new Vector3().copy(goal).addScaledVector(velocity, acceleration === 0 ? ahead : goalSpeed > 0 ? travel / goalSpeed : 0);
    const futureVelocity = velocity.clone();
    if (goalTurn !== 0 && goalSpeed > 0) {
      const tick = Math.round(ahead / STEP);
      while (targets.length <= tick) {
        const t = (targets.length - 0.5) * STEP;
        const v = Math.max(0, Math.min(motion.speed ?? Infinity, goalSpeed + acceleration * t));
        targets.push(targets[targets.length - 1].clone().addScaledVector(velocity.clone().applyAxisAngle(UP, goalTurn * t), v / goalSpeed * STEP));
      }
      target.copy(targets[tick]);
      futureVelocity.applyAxisAngle(UP, goalTurn * ahead).setLength(Math.max(0, goalSpeed + acceleration * accelerating));
    }
    const delta = target.sub(from.position).setY(0);
    const distance = delta.length();
    const heading = distance > 1e-9 ? Math.atan2(delta.x, delta.z) : yawOf(from.quaternion);
    // Start within the distance needed to brake translation and complete the goal turn (derived).
    const turnAngle = facing ? Math.abs(wrapAngle(yawOf(facing) - heading)) : 0;
    const duration = turnAngle === 0 ? 0 : Math.max(2 * Math.sqrt(turnAngle / (motion.turnAccel ?? motion.accel / radius)), turnAngle / (motion.turnSpeed ?? Infinity), 1 / stride.frequency);
    const arrival = facing ? clamp(1 - distance / (Math.max(braking, cruise * duration) + midstance), 0, 1) : 0;
    // Follow in the goal's moving frame: braking closes the gap in addition to its velocity.
    // Brake closing speed with root deceleration minus the target's deceleration (derived).
    const turnAccel = motion.turnAccel ?? motion.accel / radius;
    const remaining = facing ? Math.abs(wrapAngle(yawOf(facing) - yawOf(from.quaternion))) : 0;
    const turning = Math.min(motion.turnSpeed ?? Infinity, motion.accel / Math.max(gait.slowest, from.velocity.length())) * share;
    const untilFacing = remaining === 0 ? 0 : Math.max(2 * Math.sqrt(remaining / turnAccel), remaining / turning);
    // Keep translating until the remaining turn can finish, rather than exhaust the approach first (derived).
    // (never held still to turn first: a goal far off the facing — further than it may face off its way, `sidelong`: near a still goal,
    // any way — is walked to more and more slowly, then turned to first)
    const sidelong = lerp(Math.PI, SIDELONG, Math.max(smoothstep(ARRIVAL_TURN[0] * midstance, ARRIVAL_TURN[1] * midstance, distance), smoothstep(STILL, 2 * STILL, goalSpeed)));
    const first = 1 - smoothstep(TURN_FIRST[0], TURN_FIRST[1], Math.abs(wrapAngle(heading - yawOf(from.quaternion))) - sidelong + SIDELONG);
    const closing = (arrival > 0 && untilFacing > 0 ? Math.min(speed, distance / untilFacing) : speed) * first;
    const wanted = delta.setLength(distance > 1e-9 ? Math.sqrt(2 * Math.max(0, accel + Math.min(0, acceleration)) * distance) : 0)
      .add(futureVelocity).clampLength(0, closing);
    const next = from.velocity.clone().add(wanted.sub(from.velocity).clampLength(0, accel * STEP));
    const v = next.length();
    const yaw = yawOf(from.quaternion);
    const travelYaw = v > 1e-4 ? Math.atan2(next.x, next.z) : facing ? heading : yaw;
    const goalAngle = facing ? wrapAngle(yawOf(facing) - travelYaw) : 0, direction = Math.sign(goalAngle);
    // (the body faces the way it goes, as people do, until it arrives; only arriving does it hold what it has turned)
    const holding = smoothstep(0, ARRIVING, arrival);
    const progress = Math.max(Math.abs(goalAngle) * arrival, holding * direction * wrapAngle(stanceYaw - travelYaw), holding * direction * wrapAngle(yaw - travelYaw));
    // (and turns from the way it goes no further than `sidelong`: nobody walks off sideways or backward but for the last steps)
    const bearing = facing ? travelYaw + direction * Math.min(Math.abs(goalAngle), progress, sidelong) : travelYaw;
    // (asked to face about and its way about too, it turns round the side the facing lies: within `ABOUT` of a half turn either side
    // reads alike, and it would set off one way only to come back round the other)
    const direct = wrapAngle(bearing - yaw), toFacing = facing ? wrapAngle(yawOf(facing) - yaw) : direct;
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
      quaternion: new Quaternion().setFromAxisAngle(UP, yaw + angular * STEP),
      velocity: next, angular,
    };
  };
  return (time) => {
    const tick = Math.max(0, Math.round((time - f.time) / STEP));
    while (states.length <= tick) states.push(advance(states[states.length - 1] ?? previous, states.length * STEP));
    return states[tick];
  };
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
const UP = new Vector3(0, 1, 0);
