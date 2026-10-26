import { clamp, smoothstep } from './math';
import { Quaternion } from 'three';
import type { Limit } from './skeleton';
import type { ReadonlyPose } from './pose';
import type { Dev } from './dev';

/**
 * Where `q`, a bone's rotation in its parent's frame, is in `limit`'s coordinates: its rotation
 * off the limit's neutral (`q · neutral⁻¹`) split into a swing of the limit's axis and a twist
 * about it (Baerlocher & Boulic 2001) — the swing's rotation vector components and the twist's
 * angle — and the ranges they are held to there (the twist's opening up as the swing nears the
 * turn opposite the axis, where the twist is undefined: held there, it would flip the bone round
 * as the swing passes it). Into `out`.
 */
export function coordinatesOf(q: Quaternion, limit: Limit, out: Coordinates = coordinates()): Coordinates {
  // (q · neutral⁻¹ written out as three's product has it, term for term: it runs in every limb's searches)
  const n = limit.neutral, bx = n ? -n.x : 0, by = n ? -n.y : 0, bz = n ? -n.z : 0, bw = n ? n.w : 1;
  const ox = n ? q.x * bw + q.w * bx + q.y * bz - q.z * by : q.x;
  const oy = n ? q.y * bw + q.w * by + q.z * bx - q.x * bz : q.y;
  const oz = n ? q.z * bw + q.w * bz + q.x * by - q.y * bx : q.z;
  const ow = n ? q.w * bw - q.x * bx - q.y * by - q.z * bz : q.w;
  const sign = ow < 0 ? -1 : 1;
  const w = sign * ow;
  const i = limit.axis;
  // (the components along the axis and the two across it, in turn)
  const ci = sign * (i === 0 ? ox : i === 1 ? oy : oz);
  const cj = sign * (i === 0 ? oy : i === 1 ? oz : ox);
  const ck = sign * (i === 0 ? oz : i === 1 ? ox : oy);
  // q = swing · twist: the twist is q's part about the axis, the swing q · twist⁻¹
  const tl = Math.sqrt(ci * ci + w * w);
  const a = tl > 1e-9 ? ci / tl : 0;
  const b = tl > 1e-9 ? w / tl : 1;
  const sj = b * cj - a * ck;
  const sk = b * ck + a * cj;
  const sl = Math.sqrt(sj * sj + sk * sk);
  const phi = 2 * Math.atan2(sl, w * b + ci * a);
  const f = sl > 1e-9 ? phi / sl : 2;
  out.value[0] = sj * f;
  out.value[1] = sk * f;
  out.value[2] = 2 * Math.atan2(a, b);
  out.range[0] = limit.swing[0];
  out.range[1] = limit.swing[1];
  // (the twist's range, written into `out`'s own: opening up past `TWIST_FADE`)
  const open = smoothstep(TWIST_FADE, Math.PI, phi), lo = limit.twist[0], hi = limit.twist[1];
  out.range[2][0] = lo - (Math.PI + lo) * open;
  out.range[2][1] = hi + (Math.PI - hi) * open;
  return out;
}

/** a rotation in a limit's coordinates: the swing's two components and the twist (rad), and their ranges */
export interface Coordinates {
  value: [number, number, number];
  range: [[number, number], [number, number], [number, number]];
}

export const coordinates = (): Coordinates => ({ value: [0, 0, 0], range: [[0, 0], [0, 0], [0, 0]] });

/** Clamps `q`, a bone's rotation in its parent's frame, into `limit` (see `coordinatesOf`); returns whether it moved `q`. */
export function clampRotation(q: Quaternion, limit: Limit): boolean {
  const { value, range } = coordinatesOf(q, limit, _c);
  let t1 = clamp(value[0], range[0][0], range[0][1]);
  let t2 = clamp(value[1], range[1][0], range[1][1]);
  // (a swing of more than half a turn is the other way round: its coordinates would not come back)
  const swing = Math.hypot(t1, t2);
  if (swing > Math.PI) [t1, t2] = [(t1 * Math.PI) / swing, (t2 * Math.PI) / swing];
  // the twist's range as the clamped swing has it
  const open = smoothstep(TWIST_FADE, Math.PI, Math.min(swing, Math.PI)), [lo, hi] = limit.twist;
  const tt = clamp(value[2], lo - (Math.PI + lo) * open, hi + (Math.PI - hi) * open);
  if (t1 === value[0] && t2 === value[1] && tt === value[2]) return false;
  // swing · twist, from the swing's rotation vector and the twist's angle
  const i = limit.axis;
  const j = (i + 1) % 3;
  const k = (i + 2) % 3;
  const p = Math.sqrt(t1 * t1 + t2 * t2);
  const g = p > 1e-9 ? Math.sin(p / 2) / p : 0.5;
  const gj = t1 * g;
  const gk = t2 * g;
  const gw = Math.cos(p / 2);
  const al = Math.sin(tt / 2);
  const be = Math.cos(tt / 2);
  const c = _abc;
  c[i] = gw * al;
  c[j] = be * gj + al * gk;
  c[k] = be * gk - al * gj;
  q.set(c[0], c[1], c[2], gw * be);
  if (limit.neutral) q.multiply(limit.neutral);
  return true;
}

/** how far (rad) `q` is beyond `limit`: the angle to its clamp (0 within it) */
export function beyond(q: Quaternion, limit: Limit): number {
  const r = _beyond.copy(q);
  if (!clampRotation(r, limit)) return 0;
  const d = r.invert().multiply(q);
  return 2 * Math.atan2(Math.hypot(d.x, d.y, d.z), Math.abs(d.w));
}

/** the swing (rad) from which the twist's range opens up, to all of it at the opposite turn */
const TWIST_FADE = 0.75 * Math.PI;

const _c = coordinates(), _abc = [0, 0, 0], _beyond = new Quaternion();

/** Range checks read the completed pose, including writes after a solve. Half a degree allows numerical settling. */
export function checkLimits(pose: ReadonlyPose, dev: Dev, time: number): void {
  pose.skeleton.limits.forEach((limit, bone) => {
    if (!limit) return;
    const value = beyond(_checked.copy(pose.local(bone)), limit) * 180 / Math.PI;
    if (value > 0.5) dev.append(time, { check: 'joint range (°)', value, limit: 0.5, where: pose.skeleton.bones[bone].name });
  });
}
const _checked = new Quaternion();
