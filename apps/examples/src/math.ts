import { Euler, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';

export const vec = (x: number, y: number, z: number) => new Vector3(x, y, z);

/** Flash & Hogan minimum-jerk position profile, t in [0,1]. */
export function minimumJerk(t: number): number {
  const s = MathUtils.clamp(t, 0, 1);
  return s * s * s * (10 - 15 * s + 6 * s * s);
}

/** `a` wrapped into [-π, π] */
export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Yaw of a horizontal direction; yaw 0 faces +Z, positive yaw turns toward +X. */
export const yawOf = (x: number, z: number) => Math.atan2(x, z);

export const forwardOf = (yaw: number, out = new Vector3()) => out.set(Math.sin(yaw), 0, Math.cos(yaw));

/** a character's left (+X when facing +Z) */
export const leftOf = (yaw: number, out = new Vector3()) => out.set(Math.cos(yaw), 0, -Math.sin(yaw));

const _euler = new Euler();
/** yaw (Y) · pitch (X, + = nod down) · roll (Z) */
export const quatYXZ = (yaw: number, pitch = 0, roll = 0, out = new Quaternion()) => out.setFromEuler(_euler.set(pitch, yaw, roll, 'YXZ'));

const _m = new Matrix4();
/** the rotation taking the axes x, y, z onto the given orthonormal vectors */
export const quatBasis = (x: Vector3, y: Vector3, z: Vector3, out = new Quaternion()) => out.setFromRotationMatrix(_m.makeBasis(x, y, z));

/** A seeded uniform [0, 1) generator (mulberry32): the same seed, the same run. */
export function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A vector following a moving target on a critically damped spring; it starts on the first target (or `reset`). */
export class Spring {
  readonly value = new Vector3();
  private readonly velocity = new Vector3();
  private started = false;

  step(target: Vector3, omega: number, dt: number): Vector3 {
    if (!this.started) return this.reset(target);
    const e = Math.exp(-omega * dt);
    for (const k of ['x', 'y', 'z'] as const) {
      const delta = this.value[k] - target[k];
      const c = this.velocity[k] + omega * delta;
      this.value[k] = target[k] + (delta + c * dt) * e;
      this.velocity[k] = (this.velocity[k] - omega * c * dt) * e;
    }
    return this.value;
  }

  reset(to: Vector3): Vector3 {
    this.started = true;
    this.velocity.set(0, 0, 0);
    return this.value.copy(to);
  }
}
