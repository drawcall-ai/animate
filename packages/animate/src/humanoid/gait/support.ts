import { Vector3 } from 'three';

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

/**
 * How far `q` (x, z) lies outside the convex polygon `hull` (counter-clockwise), 0 inside;
 * `away` (when given) gets the unit direction from the polygon out toward `q`.
 */
export function outside(hull: readonly Spot[], q: Readonly<Vector3>, away?: Vector3): number {
  return Math.max(0, beyond(hull, q, away));
}

/**
 * How far `q` (x, z) lies beyond the edge of the convex polygon `hull` (counter-clockwise):
 * outside positive, inside negative (how far in); `away` (when given) gets the unit direction
 * from the nearest edge toward `q`.
 */
export function beyond(hull: readonly Spot[], q: Readonly<Vector3>, away?: Vector3): number {
  if (hull.length === 0) throw new Error('no support to be outside of');
  let inside = hull.length >= 3;
  let best = Infinity;
  let nx = 0;
  let nz = 0;
  for (let i = 0; i < hull.length; i++) {
    const [ax, az] = hull[i];
    const [bx, bz] = hull[(i + 1) % hull.length];
    const ex = bx - ax;
    const ez = bz - az;
    if (ex * (q.z - az) - ez * (q.x - ax) < 0) inside = false;
    const len2 = ex * ex + ez * ez;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((q.x - ax) * ex + (q.z - az) * ez) / len2)) : 0;
    const d = Math.hypot(q.x - ax - t * ex, q.z - az - t * ez);
    if (d < best) [best, nx, nz] = [d, ax + t * ex, az + t * ez];
  }
  away?.set(q.x - nx, 0, q.z - nz).divideScalar(best || 1);
  return inside ? -best : best;
}

/** the centroid of a polygon's corners (x, z) */
export function centreOf(hull: readonly Spot[], out = new Vector3()): Vector3 {
  out.set(0, 0, 0);
  for (const [x, z] of hull) {
    out.x += x;
    out.z += z;
  }
  return out.divideScalar(hull.length);
}
