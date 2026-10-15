import { Quaternion, Vector3 } from 'three';
import { STEP, type Frame } from '../body';
import type { Motion } from '../goal';
import { wrapAngle, yawOf } from '../math';
import type { LegGait } from './gait';
import type { LegStep } from './legs';

interface State {
  position: Vector3;
  quaternion: Quaternion;
  velocity: Vector3;
  angular: number;
  speed: number;
}

/** Predict the same bounded pursuit used for this tick, including acceleration until touchdown. */
export function rootPlan(f: Frame, goal: Readonly<Vector3>, velocity: Vector3, motion: Motion, gait: LegGait, geometry: { height: number; radius: number }, share: number, offset: number): LegStep {
  const accel = motion.accel * share;
  const speed = motion.speed ?? Infinity;
  const previous: State = {
    position: f.prev.position(0).clone(), quaternion: f.prev.rotation(0).clone(),
    velocity: f.prev.position(0).clone().sub(f.prev2.position(0)).setY(0).divideScalar(f.dt),
    angular: wrapAngle(yawOf(f.prev.rotation(0)) - yawOf(f.prev2.rotation(0))) / f.dt,
    speed: 0,
  };
  const states: State[] = [];
  const advance = (from: State, ahead: number): State => {
    const target = new Vector3().copy(goal).addScaledVector(velocity, ahead);
    const delta = target.sub(from.position).setY(0);
    const distance = delta.length();
    const heading = distance > 1e-9 ? Math.atan2(delta.x, delta.z) : yawOf(from.quaternion);
    const forward = Math.abs(wrapAngle(heading - yawOf(from.quaternion))) < Math.PI / 4;
    // These legs step fore/aft. Brake and wait for a goal outside the forward cone.
    const wanted = delta.setLength(forward && distance > 1e-9 ? Math.min(speed, Math.sqrt(2 * accel * distance)) : 0);
    const next = from.velocity.clone().add(wanted.sub(from.velocity).clampLength(0, accel * STEP));
    const v = next.length();
    const yaw = yawOf(from.quaternion);
    const bearing = v > 1e-4 ? Math.atan2(next.x, next.z) : yaw;
    const angle = wrapAngle(bearing - yaw);
    const turn = Math.min(motion.turnSpeed ?? Infinity, motion.accel / Math.max(gait.slowest, v));
    const desired = Math.sign(angle) * Math.min(turn, Math.abs(angle) / STEP);
    const turnAccel = (motion.turnAccel ?? motion.accel / geometry.radius) * share;
    let angular = Math.max(from.angular - turnAccel * STEP, Math.min(from.angular + turnAccel * STEP, desired));
    angular = Math.sign(angle) * Math.min(Math.abs(angular), Math.abs(angle) / STEP);
    // Restore standing height by 2 mm per tick; support preflight supplies only the reserve needed.
    // Keep the accepted height in the forecast rather than assume a planted leg can rise later.
    const height = from.position.y + (ahead === 0 ? Math.max(-0.002, Math.min(0.002, geometry.height - from.position.y)) + offset : 0);
    return {
      position: from.position.clone().addScaledVector(next, STEP).setY(height),
      quaternion: new Quaternion().setFromAxisAngle(UP, yaw + angular * STEP),
      velocity: next, angular, speed: Math.max(v, geometry.radius * Math.abs(angular)),
    };
  };
  const at = (time: number): State => {
    const tick = Math.max(0, Math.round((time - f.time) / STEP));
    while (states.length <= tick) states.push(advance(states[states.length - 1] ?? previous, states.length * STEP));
    return states[tick];
  };
  return { speed: (time) => at(time).speed, root: (time) => at(time) };
}

const UP = new Vector3(0, 1, 0);
