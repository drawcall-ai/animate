import { Vector3 } from 'three';

/** The unit direction of a view turned by `yaw` about +Y from +Z and raised by `pitch`. */
export function lookDirection(yaw: number, pitch: number, target = new Vector3()) {
  return target.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
}

/** The yaw about +Y from +Z and the pitch of `direction`; the inverse of `lookDirection`. */
export const anglesOf = (direction: Vector3) => ({ yaw: Math.atan2(direction.x, direction.z), pitch: Math.atan2(direction.y, Math.hypot(direction.x, direction.z)) });

/** `angle` wrapped into [-π, π]. */
export const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
