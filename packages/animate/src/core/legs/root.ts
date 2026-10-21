import { Quaternion, Vector3 } from 'three';
import { STEP, type Frame } from '../body';
import { follow } from '../follow';
import type { Motion } from '../goal';
import { clamp, lerp, smoothstep, wrapAngle, yawOf } from '../math';
import { strideAt, type Gait } from './gait';

export interface RootState {
  position: Vector3;
  quaternion: Quaternion;
  velocity: Vector3;
  angular: number;
}

/** a planned root: where it is (`RootState`) at a time (s) */
export interface RootPlan { root(time: number): RootState }

export function rootPlan(f: Frame, goal: Readonly<Vector3>, velocity: Vector3, motion: Motion, gait: Gait, radius: number, share: number, previous: RootState, acceleration: number, facing?: Quaternion, turnShare = 1, goalTurn = 0, speedShare = 1, stanceYaw = yawOf(previous.quaternion), travelFirst = false): RootPlan {
  if (share === 0 && !facing) {
    const position = previous.position.clone();
    const quaternion = new Quaternion().setFromAxisAngle(UP, yawOf(previous.quaternion));
    return { root: () => ({ position, quaternion, velocity: new Vector3(), angular: 0 }) };
  }
  const accel = motion.accel * (facing ? 1 : share);
  const speed = share === 0 || speedShare === 0 ? 0 : (motion.speed ?? Infinity) * speedShare;
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
    // [D] Start within the distance needed to brake translation and complete the goal turn.
    const turnAngle = facing ? Math.abs(wrapAngle(yawOf(facing) - heading)) : 0;
    const duration = turnAngle === 0 ? 0 : Math.max(2 * Math.sqrt(turnAngle / (motion.turnAccel ?? motion.accel / radius)), turnAngle / (motion.turnSpeed ?? Infinity), 1 / stride.frequency);
    const arrival = facing ? clamp(1 - distance / (Math.max(braking, cruise * duration) + midstance), 0, 1) : 0;
    // (`travelFirst`: never held still to turn first, but slowed by `first` below)
    const forward = travelFirst || (arrival > 0 && (turnAngle > 1e-9 || from.velocity.lengthSq() > 1e-8)) || Math.abs(wrapAngle(heading - yawOf(from.quaternion))) < Math.PI / 4;
    // Follow in the goal's moving frame: braking closes the gap in addition to its velocity.
    // [D] Brake closing speed with root deceleration minus the target's deceleration.
    const turnAccel = (motion.turnAccel ?? motion.accel / radius) * (facing ? 1 : share);
    const remaining = facing ? Math.abs(wrapAngle(yawOf(facing) - yawOf(from.quaternion))) : 0;
    const turning = Math.min(motion.turnSpeed ?? Infinity, motion.accel / Math.max(gait.slowest, from.velocity.length())) * turnShare;
    const untilFacing = remaining === 0 ? 0 : Math.max(2 * Math.sqrt(remaining / turnAccel), remaining / turning);
    // [D] Keep translating until the remaining turn can finish, rather than exhaust the approach first.
    // (`travelFirst`: a goal far off the facing — further than it may face off its way, `sidelong`: near a still goal, any way — is
    // walked to more and more slowly, then turned to first, as the old balance's carriage did)
    const sidelong = travelFirst ? lerp(Math.PI, SIDELONG, Math.max(smoothstep(ARRIVAL_TURN[0] * midstance, ARRIVAL_TURN[1] * midstance, distance), smoothstep(STILL, 2 * STILL, goalSpeed))) : Math.PI;
    const first = travelFirst ? 1 - smoothstep(TURN_FIRST[0], TURN_FIRST[1], Math.abs(wrapAngle(heading - yawOf(from.quaternion))) - sidelong + SIDELONG) : 1;
    const closing = (arrival > 0 && untilFacing > 0 ? Math.min(speed, distance / untilFacing) : speed) * first;
    const wanted = forward ? delta.setLength(distance > 1e-9 ? Math.sqrt(2 * Math.max(0, accel + Math.min(0, acceleration)) * distance) : 0)
      .add(futureVelocity).clampLength(0, closing) : delta.set(0, 0, 0);
    const next = from.velocity.clone().add(wanted.sub(from.velocity).clampLength(0, accel * STEP));
    const v = next.length();
    const yaw = yawOf(from.quaternion);
    const travelYaw = v > 1e-4 ? Math.atan2(next.x, next.z) : facing ? heading : yaw;
    const goalAngle = facing ? wrapAngle(yawOf(facing) - travelYaw) : 0, direction = Math.sign(goalAngle);
    // (`travelFirst`: the body faces the way it goes, as people do, until it arrives; only arriving does it hold what it has turned)
    const holding = travelFirst ? smoothstep(0, ARRIVING, arrival) : 1;
    const progress = Math.max(Math.abs(goalAngle) * arrival, holding * direction * wrapAngle(stanceYaw - travelYaw), holding * direction * wrapAngle(yaw - travelYaw));
    // (and turns from the way it goes no further than `sidelong`: nobody walks off sideways or backward but for the last steps)
    const bearing = facing ? travelYaw + direction * Math.min(Math.abs(goalAngle), progress, sidelong) : travelYaw;
    // (asked to face about and its way about too, it turns round the side the facing lies: within `ABOUT` of a half turn either side
    // reads alike, and it would set off one way only to come back round the other)
    const direct = wrapAngle(bearing - yaw), toFacing = facing ? wrapAngle(yawOf(facing) - yaw) : direct;
    const angle = Math.min(Math.abs(direct), Math.abs(toFacing)) > Math.PI - ABOUT && toFacing * direct < 0 ? direct - Math.sign(direct) * 2 * Math.PI : direct;
    const turn = Math.min(motion.turnSpeed ?? Infinity, motion.accel / Math.max(gait.slowest, v)) * turnShare;
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
  const at = (time: number): RootState => {
    const tick = Math.max(0, Math.round((time - f.time) / STEP));
    while (states.length <= tick) states.push(advance(states[states.length - 1] ?? previous, states.length * STEP));
    return states[tick];
  };
  return { root: (time) => at(time) };
}

/**
 * Tuned, for a body walking facing its way (`travelFirst`): how far into its arrival turn (share) it comes to hold the turn it has made
 * toward the asked facing; until this close (× its stride's mid-stance travel: ~0.45–1.1 m walking) it faces no further than `SIDELONG`
 * (rad) off the way it goes (the old balance's carriage turned to an asked facing only once near and slow)
 */
const ARRIVING = 0.2, ARRIVAL_TURN = [1, 2.5] as const, SIDELONG = 0.3;
/** Inherited (the old balance's carriage): a goal this far off the facing (rad) is walked to more and more slowly, then turned to first */
const TURN_FIRST = [0.6, 1.3] as const;
/** Tuned: how near a half turn (rad) its way and the facing asked are each taken as about */
const ABOUT = 0.35;
/** Inherited (the old balance's carriage): a goal moving slower than this (m/s) is still: arrived at, it may be faced any way */
const STILL = 0.08;
const UP = new Vector3(0, 1, 0);
