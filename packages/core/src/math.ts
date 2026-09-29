import { Euler, Quaternion, Vector3 } from 'three';

export type Vec3Like = { x: number; y: number; z: number };
export type QuatLike = { x: number; y: number; z: number; w: number };

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

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Yaw of a horizontal direction; yaw 0 faces +Z, positive yaw turns toward +X. */
export const yawOf = (x: number, z: number) => Math.atan2(x, z);

export function forwardOf(yaw: number, out = new Vector3()): Vector3 {
  return out.set(Math.sin(yaw), 0, Math.cos(yaw));
}

/** Character's left (+X in local space). */
export function leftOf(yaw: number, out = new Vector3()): Vector3 {
  return out.set(Math.cos(yaw), 0, -Math.sin(yaw));
}

const _euler = new Euler();
/** Rotation built as yaw (Y) * pitch (X, + = bend forward) * roll (Z, + = raise left side). */
export function quatYXZ(yaw: number, pitch: number, roll: number, out = new Quaternion()): Quaternion {
  return out.setFromEuler(_euler.set(pitch, yaw, roll, 'YXZ'));
}

export function toVector3(v: Vec3Like, out = new Vector3()): Vector3 {
  return out.set(v.x, v.y, v.z);
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
 * Damped spring driven by an external acceleration (a pendulum on a moving pivot).
 * Underdamped (zeta < 1) gives the slight overshoot that reads as weight.
 */
export class DampedSpring {
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
  reset() {
    this.value = 0;
    this.velocity = 0;
  }
}

export class Spring3 {
  readonly value = new Vector3();
  readonly velocity = new Vector3();
  step(target: Vector3, omega: number, dt: number): Vector3 {
    const e = Math.exp(-omega * dt);
    for (const k of ['x', 'y', 'z'] as const) {
      const delta = this.value[k] - target[k];
      const c2 = this.velocity[k] + omega * delta;
      this.value[k] = target[k] + (delta + c2 * dt) * e;
      this.velocity[k] = (this.velocity[k] - omega * c2 * dt) * e;
    }
    return this.value;
  }
  reset(v: Vector3) {
    this.value.copy(v);
    this.velocity.set(0, 0, 0);
  }
}

/** Smooth approximation of min(a, b); k is the blend width. */
export function softMin(a: number, b: number, k: number): number {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return lerp(b, a, h) - k * h * (1 - h);
}
