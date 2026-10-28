import { Vector3 } from 'three';
import { GRAVITY } from '../kernel/math';
import type { ReadonlyPose } from '../kernel/pose';

/**
 * The extrapolated centre of mass (recalled: Hof et al. 2005, x + v / ω₀ with ω₀ = √(g / l)) of a body whose centre of mass is at
 * `com`, moving at `velocity`, over legs `length` long: on the floor, into `out` — the one reading of balance the legs and the checks share
 */
export function xcomOf(com: Readonly<Vector3>, velocity: Readonly<Vector3>, length: number, out: Vector3): Vector3 {
  return out.copy(com).addScaledVector(velocity, Math.sqrt(length / GRAVITY)).setY(0);
}

/** `xcomOf` read off a body's last two final poses, `dt` (s) apart */
export function xcomOfPoses(prev: ReadonlyPose, prev2: ReadonlyPose, dt: number, length: number, out: Vector3): Vector3 {
  const com = prev.com(_com);
  return xcomOf(com, prev2.com(_velocity).sub(com).multiplyScalar(-1 / dt), length, out);
}
const _com = new Vector3(), _velocity = new Vector3();

/** a point on the floor: (x, z) */
export type Spot = [number, number];

/** the convex hull of `points`, counter-clockwise (Andrew's monotone chain) */
export function hullOf(points: readonly Spot[]): Spot[] {
  const P = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (P.length < 3) return P;
  const cross = (o: Spot, a: Spot, b: Spot) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (pts: Spot[]) => {
    const out: Spot[] = [];
    for (const p of pts) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(P), ...half([...P].reverse())];
}

/** how far `q` (x, z) lies outside the convex polygon `hull` (0 inside); `away` gets the unit direction out toward `q` */
export function outside(hull: readonly Spot[], q: Readonly<Vector3>, away?: Vector3): number {
  return Math.max(0, past(hull, q, away));
}

/**
 * How far `q` (x, z) lies beyond the edge of the convex polygon `hull` (counter-clockwise): outside
 * positive, inside negative (how far in); `away` gets the unit direction from the nearest edge toward `q`.
 */
export function past(hull: readonly Spot[], q: Readonly<Vector3>, away?: Vector3): number {
  if (hull.length === 0) throw new Error('no support to be outside of');
  let inside = hull.length >= 3;
  let best = Infinity, nx = 0, nz = 0;
  for (let i = 0; i < hull.length; i++) {
    const [ax, az] = hull[i];
    const [bx, bz] = hull[(i + 1) % hull.length];
    const ex = bx - ax, ez = bz - az;
    if (ex * (q.z - az) - ez * (q.x - ax) < 0) inside = false;
    const len2 = ex * ex + ez * ez;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((q.x - ax) * ex + (q.z - az) * ez) / len2)) : 0;
    const d = Math.hypot(q.x - ax - t * ex, q.z - az - t * ez);
    if (d < best) [best, nx, nz] = [d, ax + t * ex, az + t * ez];
  }
  away?.set(q.x - nx, 0, q.z - nz).divideScalar(best || 1);
  return inside ? -best : best;
}
