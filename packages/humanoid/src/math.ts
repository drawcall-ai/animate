// Leaf helpers copied from @prohuman/core (packages/core/src/math.ts).
import { Euler, Quaternion, Vector3 } from 'three';

/** standard gravity (m/s²) */
export const GRAVITY = 9.81;

export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Flash & Hogan minimum-jerk position profile, t in [0, 1] */
export function minimumJerk(t: number): number {
  const s = clamp(t, 0, 1);
  return s * s * s * (10 - 15 * s + 6 * s * s);
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** the yaw of a horizontal direction: 0 faces +Z, positive turns toward +X */
export const yawOf = (x: number, z: number) => Math.atan2(x, z);

export const forwardOf = (yaw: number, out = new Vector3()) => out.set(Math.sin(yaw), 0, Math.cos(yaw));

/** the body's left (+X when facing +Z) */
export const leftOf = (yaw: number, out = new Vector3()) => out.set(Math.cos(yaw), 0, -Math.sin(yaw));

const _euler = new Euler();
/** the rotation yaw (about Y) · pitch (about X, + bends forward) · roll (about Z, + raises the left side) */
export const quatYXZ = (yaw: number, pitch: number, roll: number, out = new Quaternion()) => out.setFromEuler(_euler.set(pitch, yaw, roll, 'YXZ'));

/** a smooth min(a, b) blending over `k` */
export function softMin(a: number, b: number, k: number): number {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return lerp(b, a, h) - k * h * (1 - h);
}

/** a smooth max(0, x), blending over `k`: no kink to jerk a limb that follows it */
export const softplus = (x: number, k: number) => (x / k > 30 ? x : k * Math.log1p(Math.exp(x / k)));

/** An exact critically damped spring. */
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
