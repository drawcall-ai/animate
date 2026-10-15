import { Quaternion, Vector3 } from 'three';
import type { Frame } from './body';
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

/**
 * A snap heuristic: elite joint speeds divided by 30 ms, slightly shorter than a throw's
 * ~50 ms acceleration phase (Fleisig 1999). Reuses the former run judge's ceilings;
 * these are generous fault detectors, not clinical acceleration limits. Units: °/s².
 */
function snapLimit(name: string): number {
  if (/UpperArm/.test(name)) return 7500 / 0.03;
  if (/LowerArm/.test(name)) return 2900 / 0.03;
  if (/Hand/.test(name)) return 3000 / 0.03;
  if (/UpperLeg/.test(name)) return 2000 / 0.03;
  if (/LowerLeg|Foot|Toes/.test(name)) return 2500 / 0.03;
  if (/Shoulder/.test(name)) return 1000 / 0.03;
  if (/neck|head/.test(name)) return 700 / 0.03;
  return 1200 / 0.03;
}

/** The difference of successive joint angular velocities, both from final poses. */
export function checkSnaps(f: Frame, dev: Dev): void {
  const history = velocities.get(dev) ?? [];
  velocities.set(dev, history);
  f.prev.skeleton.bones.forEach((bone, i) => {
    const d = _q.copy(f.prev2.local(i)).invert().multiply(f.prev.local(i));
    const omega = log(d, new Vector3()).divideScalar(f.dt);
    const before = history[i];
    if (before) {
      const value = omega.distanceTo(before) / f.dt * 180 / Math.PI;
      const limit = snapLimit(bone.name);
      if (value > limit) dev.append(f.time, { check: 'joint acceleration (°/s²)', value, limit, where: bone.name });
    }
    history[i] = omega;
  });
}
const velocities = new WeakMap<Dev, Vector3[]>();
const _q = new Quaternion();
