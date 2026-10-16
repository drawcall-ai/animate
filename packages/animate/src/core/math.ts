// Leaf helpers (from the old core, a801be4:packages/core/src/math.ts).
import { Euler, Quaternion, Vector3 } from 'three';

/** standard gravity (m/s²) */
export const GRAVITY = 9.81;

export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 0 below `e0`, 1 above `e1`, smooth between */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Flash & Hogan's minimum-jerk position profile, `t` in [0, 1] */
export function minimumJerk(t: number): number {
  const s = clamp(t, 0, 1);
  return s * s * s * (10 - 15 * s + 6 * s * s);
}

/** `a` wrapped into [−π, π] */
export function wrapAngle(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}

/** the yaw of a horizontal direction: 0 faces +Z, positive turns toward +X */
export const headingOf = (x: number, z: number) => Math.atan2(x, z);

export const forwardOf = (yaw: number, out = new Vector3()) => out.set(Math.sin(yaw), 0, Math.cos(yaw));

/** the body's left (+X facing +Z) */
export const leftOf = (yaw: number, out = new Vector3()) => out.set(Math.cos(yaw), 0, -Math.sin(yaw));

const _euler = new Euler();
/** the rotation yaw (about Y) · pitch (about X, + bends forward) · roll (about Z, + raises the left side) */
export const quatYXZ = (yaw: number, pitch: number, roll: number, out = new Quaternion()) => out.setFromEuler(_euler.set(pitch, yaw, roll, 'YXZ'));

/** a smooth min(a, b), blending over `k` */
export function softMin(a: number, b: number, k: number): number {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return lerp(b, a, h) - k * h * (1 - h);
}

/** a smooth max(0, x), blending over `k` */
export const softplus = (x: number, k: number) => (x / k > 30 ? x : k * Math.log1p(Math.exp(x / k)));

const _left = new Vector3();

/** Yaw from the left axis stays steady through forward pitch. */
export function yawOf(q: Readonly<Quaternion>): number {
  const left = _left.set(1, 0, 0).applyQuaternion(q);
  return Math.atan2(-left.z, left.x);
}

/** Distance on the floor plane from `point` to segment `a`–`b`. */
export function pointSegmentDistance(point: Readonly<Vector3>, a: Readonly<Vector3>, b: Readonly<Vector3>): number {
  const x = b.x - a.x, z = b.z - a.z;
  const t = clamp(((point.x - a.x) * x + (point.z - a.z) * z) / (x * x + z * z || 1), 0, 1);
  return Math.hypot(point.x - a.x - t * x, point.z - a.z - t * z);
}
