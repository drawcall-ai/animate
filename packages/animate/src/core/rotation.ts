import { Quaternion, Vector3 } from 'three';

/** the rotation by the rotation vector (x, y, z) (rad) */
export function exp(x: number, y: number, z: number, out: Quaternion): Quaternion {
  const angle = Math.sqrt(x * x + y * y + z * z);
  // sin(a/2)/a, its Taylor series near 0
  const s = angle > 1e-8 ? Math.sin(angle / 2) / angle : 0.5 - (angle * angle) / 48;
  return out.set(x * s, y * s, z * s, Math.cos(angle / 2));
}

/** the rotation vector (rad) of `q`, the short way round */
export function log(q: Quaternion, out: Vector3): Vector3 {
  const sign = q.w < 0 ? -1 : 1;
  const x = sign * q.x;
  const y = sign * q.y;
  const z = sign * q.z;
  const s = Math.sqrt(x * x + y * y + z * z);
  const f = s > 1e-12 ? (2 * Math.atan2(s, sign * q.w)) / s : 2;
  return out.set(x * f, y * f, z * f);
}
