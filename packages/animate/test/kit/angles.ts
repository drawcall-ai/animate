import { Vector3, type Quaternion } from 'three';

/** `a` (rad) wrapped to ±π */
export const wrapAngle = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

/** the way `yaw` faces on the floor */
export const forwardOf = (yaw: number) => new Vector3(Math.sin(yaw), 0, Math.cos(yaw));

/** a body's left, at `yaw` */
export const leftOf = (yaw: number) => new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

/** how far `q` has turned a body's left about +Y (rad) */
export function yawOf(q: Readonly<Quaternion>): number {
  const left = new Vector3(1, 0, 0).applyQuaternion(q);
  return Math.atan2(-left.z, left.x);
}
