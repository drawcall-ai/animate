import { Quaternion, Vector3 } from 'three';
import { STEP, type Frame } from '../body';
import type { Motion } from '../goal';
import { wrapAngle, yawOf } from '../math';
import type { LegGait } from './gait';
import type { LegStep } from './legs';

export interface RootState {
  position: Vector3;
  quaternion: Quaternion;
  velocity: Vector3;
  angular: number;
}

/** Predict the same bounded pursuit used for this tick, including acceleration until touchdown. */
export function rootPlan(f: Frame, goal: Readonly<Vector3>, velocity: Vector3, motion: Motion, gait: LegGait, radius: number, share: number, previous: RootState, acceleration: number): Omit<LegStep, 'root'> & { root(time: number): RootState } {
  if (share === 0) {
    const position = previous.position.clone();
    const quaternion = new Quaternion().setFromAxisAngle(UP, yawOf(previous.quaternion));
    return { root: () => ({ position, quaternion, velocity: new Vector3(), angular: 0 }), speed: 0 };
  }
  const accel = motion.accel * share;
  const speed = motion.speed ?? Infinity;
  const states: (RootState & { speed: number })[] = [];
  const advance = (from: RootState, ahead: number): RootState & { speed: number } => {
    const goalSpeed = velocity.length();
    const accelerating = acceleration === 0 ? ahead : Math.min(ahead, Math.max(0,
      acceleration > 0 ? ((motion.speed ?? Infinity) - goalSpeed) / acceleration : -goalSpeed / acceleration));
    const travel = goalSpeed * accelerating + 0.5 * acceleration * accelerating ** 2
      + Math.max(0, goalSpeed + acceleration * accelerating) * (ahead - accelerating);
    const target = new Vector3().copy(goal).addScaledVector(velocity, acceleration === 0 ? ahead : goalSpeed > 0 ? travel / goalSpeed : 0);
    const delta = target.sub(from.position).setY(0);
    const distance = delta.length();
    const heading = distance > 1e-9 ? Math.atan2(delta.x, delta.z) : yawOf(from.quaternion);
    const forward = Math.abs(wrapAngle(heading - yawOf(from.quaternion))) < Math.PI / 4;
    // These legs step fore/aft. Brake and wait for a goal outside the forward cone.
    // Follow in the goal's moving frame: braking closes the gap in addition to its velocity.
    // [D] Brake closing speed with root deceleration minus the target's deceleration.
    const wanted = forward ? delta.setLength(distance > 1e-9 ? Math.sqrt(2 * Math.max(0, accel + Math.min(0, acceleration)) * distance) : 0)
      .add(velocity).clampLength(0, speed) : delta.set(0, 0, 0);
    const next = from.velocity.clone().add(wanted.sub(from.velocity).clampLength(0, accel * STEP));
    const v = next.length();
    const yaw = yawOf(from.quaternion);
    const bearing = v > 1e-4 ? Math.atan2(next.x, next.z) : yaw;
    const angle = wrapAngle(bearing - yaw);
    const turn = Math.min(motion.turnSpeed ?? Infinity, motion.accel / Math.max(gait.slowest, v));
    const desired = Math.sign(angle) * Math.min(turn, Math.abs(angle) / STEP);
    const turnAccel = (motion.turnAccel ?? motion.accel / radius) * share;
    let angular = Math.max(from.angular - turnAccel * STEP, Math.min(from.angular + turnAccel * STEP, desired));
    angular = Math.sign(angle) * Math.min(Math.abs(angular), Math.abs(angle) / STEP);
    return {
      position: from.position.clone().addScaledVector(next, STEP).setY(from.position.y),
      quaternion: new Quaternion().setFromAxisAngle(UP, yaw + angular * STEP),
      velocity: next, angular, speed: Math.max(v, radius * Math.abs(angular)),
    };
  };
  const at = (time: number): RootState & { speed: number } => {
    const tick = Math.max(0, Math.round((time - f.time) / STEP));
    while (states.length <= tick) states.push(advance(states[states.length - 1] ?? previous, states.length * STEP));
    return states[tick];
  };
  return { speed: (time) => at(time).speed, root: (time) => at(time) };
}

const UP = new Vector3(0, 1, 0);
