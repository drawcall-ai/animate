import { Quaternion, Vector3 } from 'three';
import type { Frame } from './frame';
import type { Dev } from './dev';

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

/** the angular velocity (rad/s, in the frame the quaternions are in) turning `from` into `to` over `dt` */
export function spinOf(from: Quaternion, to: Quaternion, dt: number, out: Vector3): Vector3 {
  return log(_d.copy(from).invert().premultiply(to), out).divideScalar(dt);
}

const _d = new Quaternion();

/** Joint speed and the difference of successive angular velocities, from final poses. */
export class SnapChecks {
  private readonly velocities: Vector3[] = [];

  check(f: Frame, dev: Dev): void {
    const history = this.velocities;
    f.prev.skeleton.bones.forEach((bone, i) => {
      if (!bone.snap) return;
      const omega = spinOf(f.prev2.local(i), f.prev.local(i), f.dt, new Vector3());
      const speed = omega.length() * 180 / Math.PI;
      if (speed > bone.snap.speed) dev.append(f.time, { check: 'joint speed (°/s)', value: speed, limit: bone.snap.speed, where: bone.name });
      const before = history[i];
      if (before) {
        const value = omega.distanceTo(before) / f.dt * 180 / Math.PI;
        const limit = bone.snap.accel;
        if (value > limit) dev.append(f.time, { check: 'joint acceleration (°/s²)', value, limit, where: bone.name });
      }
      history[i] = omega;
    });
  }
}
