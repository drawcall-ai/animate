import { Euler, Quaternion, Vector3 } from 'three';

export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

/** standard gravity (m/s²) */
export const GRAVITY = 9.81;

export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Flash & Hogan minimum-jerk position profile, t in [0,1]. */
export function minimumJerk(t: number): number {
  const s = clamp(t, 0, 1);
  return s * s * s * (10 - 15 * s + 6 * s * s);
}

/**
 * A quintic Hermite curve at time `t`: from `p0` (velocity `v0`, acceleration `a0`) to `p1`
 * (`v1`, `a1`) over `T` s, held at `p1` after. Continuous in position, velocity and
 * acceleration at both ends (all zero: a minimum-jerk move).
 */
export function quintic(p0: number, v0: number, a0: number, p1: number, v1: number, a1: number, T: number, t: number): number {
  const s = clamp(t / T, 0, 1);
  const s2 = s * s;
  const s3 = s2 * s;
  const s4 = s3 * s;
  const s5 = s4 * s;
  const TT = T * T;
  return (
    (1 - 10 * s3 + 15 * s4 - 6 * s5) * p0 +
    (s - 6 * s3 + 8 * s4 - 3 * s5) * v0 * T +
    (0.5 * s2 - 1.5 * s3 + 1.5 * s4 - 0.5 * s5) * a0 * TT +
    (0.5 * s3 - s4 + 0.5 * s5) * a1 * TT +
    (-4 * s3 + 7 * s4 - 3 * s5) * v1 * T +
    (10 * s3 - 15 * s4 + 6 * s5) * p1
  );
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * √(x² + y² + z²). Math.hypot also guards against overflow, which metre-scale values never
 * need, at several times the cost (and, in V8, a heap number per call).
 */
export const hypot = (x: number, y: number, z = 0) => Math.sqrt(x * x + y * y + z * z);

/** Yaw of a horizontal direction; yaw 0 faces +Z, positive yaw turns toward +X. */
export const yawOf = (x: number, z: number) => Math.atan2(x, z);

export function forwardOf(yaw: number, out: Vector3): Vector3 {
  return out.set(Math.sin(yaw), 0, Math.cos(yaw));
}

/** Character's left (+X in local space). */
export function leftOf(yaw: number, out: Vector3): Vector3 {
  return out.set(Math.cos(yaw), 0, -Math.sin(yaw));
}

const _euler = new Euler();
/** Rotation built as yaw (Y) * pitch (X, + = bend forward) * roll (Z, + = raise left side). */
export function quatYXZ(yaw: number, pitch: number, roll: number, out: Quaternion): Quaternion {
  return out.setFromEuler(_euler.set(pitch, yaw, roll, 'YXZ'));
}

/**
 * The world point of `local` in the frame (`origin`, `q`): origin + q·local, the same
 * arithmetic as `out.copy(local).applyQuaternion(q).add(origin)`. In the trunk's forward
 * kinematics (the solver's inner loop) that chain costs ~5% of the frame and doubles the
 * allocation: V8 leaves it un-inlined there and boxes the numbers it passes.
 */
export function framePoint(out: Vector3, origin: Vec3, q: Quat, local: Vec3): Vector3 {
  const { x: vx, y: vy, z: vz } = local;
  const { x: qx, y: qy, z: qz, w: qw } = q;
  // t = 2 (q.xyz × v); v' = v + w t + q.xyz × t
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  const x = vx + qw * tx + qy * tz - qz * ty + origin.x;
  const y = vy + qw * ty + qz * tx - qx * tz + origin.y;
  const z = vz + qw * tz + qx * ty - qy * tx + origin.z;
  // (field writes: out.set left un-inlined would box the three numbers)
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

/** Exact critically damped spring step. */
export class Spring {
  velocity = 0;
  constructor(public value = 0) {}
  step(target: number, omega: number, dt: number): number {
    const delta = this.value - target;
    const c2 = this.velocity + omega * delta;
    const e = Math.exp(-omega * dt);
    this.value = target + (delta + c2 * dt) * e;
    this.velocity = (this.velocity - omega * c2 * dt) * e;
    return this.value;
  }
  reset(v: number) {
    this.value = v;
    this.velocity = 0;
  }
}

/**
 * A damped oscillator driven by an external acceleration (a pendulum on a moving pivot).
 * Underdamped (zeta < 1) gives the slight overshoot that reads as weight.
 */
export class Pendulum {
  value = 0;
  velocity = 0;
  constructor(
    public omega: number,
    public zeta: number,
  ) {}
  step(forcing: number, dt: number): number {
    const a = forcing - this.omega * this.omega * this.value - 2 * this.zeta * this.omega * this.velocity;
    this.velocity += a * dt;
    this.value += this.velocity * dt;
    return this.value;
  }
}

/** Smooth approximation of min(a, b); k is the blend width. */
export function softMin(a: number, b: number, k: number): number {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return lerp(b, a, h) - k * h * (1 - h);
}

/** Distance from `p` to the segment a–b. */
export function segmentDistance(p: Vec3, a: Vec3, b: Vec3): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz;
  const t = l2 > 1e-12 ? clamp(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2, 0, 1) : 0;
  return hypot(a.x + abx * t - p.x, a.y + aby * t - p.y, a.z + abz * t - p.z);
}

/** Yaw of the +Z axis rotated by `q` (the facing a rotation expresses). */
export function yawOfQuaternion(q: Quat): number {
  const { x, y, z, w } = q;
  // forward = q · (0, 0, 1)
  const fx = 2 * (x * z + w * y);
  const fz = 1 - 2 * (x * x + y * y);
  return Math.atan2(fx, fz);
}
