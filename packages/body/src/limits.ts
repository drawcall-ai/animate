import { Quaternion } from 'three';
import type { Limit } from './types.js';

/**
 * Clamps `q`, a bone's rotation in its parent's frame, into `limit`: its rotation off the
 * limit's neutral (`q · neutral⁻¹`) split into a swing of the limit's axis and a twist about it
 * (Baerlocher & Boulic 2001), the swing's rotation vector components and the twist each clamped
 * into their range. Returns whether it moved `q`.
 *
 * The split and its inverse are copied from `@prohuman/core` (`pose/limits.ts`), without its
 * mirroring and soft easing.
 */
export function clampRotation(q: Quaternion, limit: Limit): boolean {
  if (!limit.neutral) return clampOffset(q, limit);
  const off = _q.copy(limit.neutral).invert().premultiply(q);
  if (!clampOffset(off, limit)) return false;
  q.multiplyQuaternions(off, limit.neutral);
  return true;
}

/** clamps `q`, a rotation off the limit's neutral (see `clampRotation`) */
function clampOffset(q: Quaternion, limit: Limit): boolean {
  const sign = q.w < 0 ? -1 : 1;
  const c = [sign * q.x, sign * q.y, sign * q.z];
  const w = sign * q.w;
  const i = limit.axis;
  const j = (i + 1) % 3;
  const k = (i + 2) % 3;
  // q = swing · twist: the twist is q's part about the axis, the swing q · twist⁻¹
  const tl = Math.sqrt(c[i] * c[i] + w * w);
  const a = tl > 1e-9 ? c[i] / tl : 0;
  const b = tl > 1e-9 ? w / tl : 1;
  const sj = b * c[j] - a * c[k];
  const sk = b * c[k] + a * c[j];
  const sl = Math.sqrt(sj * sj + sk * sk);
  const phi = 2 * Math.atan2(sl, w * b + c[i] * a);
  const f = sl > 1e-9 ? phi / sl : 2;
  const s1 = sj * f;
  const s2 = sk * f;
  const tau = 2 * Math.atan2(a, b);

  const clamp = (x: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, x));
  const t1 = clamp(s1, limit.swing[0]);
  const t2 = clamp(s2, limit.swing[1]);
  const tt = clamp(tau, limit.twist);
  if (t1 === s1 && t2 === s2 && tt === tau) return false;

  // swing · twist, from the swing's rotation vector and the twist's angle
  const p = Math.sqrt(t1 * t1 + t2 * t2);
  const g = p > 1e-9 ? Math.sin(p / 2) / p : 0.5;
  const gj = t1 * g;
  const gk = t2 * g;
  const gw = Math.cos(p / 2);
  const al = Math.sin(tt / 2);
  const be = Math.cos(tt / 2);
  c[i] = gw * al;
  c[j] = be * gj + al * gk;
  c[k] = be * gk - al * gj;
  q.set(c[0], c[1], c[2], gw * be);
  return true;
}

/** how far (rad) `q` is beyond `limit`: the angle to its clamp (0 within it) */
export function beyond(q: Quaternion, limit: Limit): number {
  const r = q.clone();
  if (!clampRotation(r, limit)) return 0;
  const d = r.invert().multiply(q);
  return 2 * Math.atan2(Math.hypot(d.x, d.y, d.z), Math.abs(d.w));
}

const _q = new Quaternion();
