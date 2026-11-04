import { Matrix4, Quaternion, Vector3, type Object3D } from 'three';

/** The unit direction of a view turned by `yaw` about +Y from +Z and raised by `pitch`. */
export function lookDirection(yaw: number, pitch: number, target = new Vector3()) {
  return target.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
}

/** The yaw about +Y from +Z and the pitch of `direction`; the inverse of `lookDirection`. */
export const anglesOf = (direction: Vector3) => ({ yaw: Math.atan2(direction.x, direction.z), pitch: Math.atan2(direction.y, Math.hypot(direction.x, direction.z)) });

/** The way `object` faces: the yaw of its +Z in the world (rad). */
export const yawOf = (object: Object3D) => anglesOf(new Vector3(0, 0, 1).applyQuaternion(object.getWorldQuaternion(new Quaternion()))).yaw;

/** `angle` wrapped into [-π, π]. */
export const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** The rotation taking `axis` onto `onto` exactly and `ref` as near `toward` as that allows. */
export function frame(axis: Readonly<Vector3>, onto: Readonly<Vector3>, ref: Readonly<Vector3>, toward: Readonly<Vector3>): Quaternion {
  const basis = (a: Readonly<Vector3>, r: Readonly<Vector3>) => {
    const x = a.clone().normalize(), y = r.clone().addScaledVector(x, -r.dot(x)).normalize();
    return new Matrix4().makeBasis(x, y, new Vector3().crossVectors(x, y));
  };
  const from = new Quaternion().setFromRotationMatrix(basis(axis, ref));
  return new Quaternion().setFromRotationMatrix(basis(onto, toward)).multiply(from.invert());
}

/** A turn by `yaw` about +Y, then by `tip` about the turned +X (positive tips +Z down). */
export function heading(yaw: number, tip = 0): Quaternion {
  return new Quaternion().setFromAxisAngle(UP, yaw).multiply(new Quaternion().setFromAxisAngle(RIGHT, tip));
}

const UP = new Vector3(0, 1, 0), RIGHT = new Vector3(1, 0, 0);
