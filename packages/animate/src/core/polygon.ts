/** a point of a plane: (x, z) on the floor, or a horizontal acceleration */
export type Spot = [number, number];

/** the convex hull of `points`, counter-clockwise (Andrew's monotone chain): a point, a segment, or a polygon */
export function hullOf(points: readonly Spot[]): Spot[] {
  const P = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (P.length < 3) return P;
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

/** the point of the convex `hull` (counter-clockwise, from `hullOf`) nearest `q`: `q` itself inside it (into `out`) */
export function nearest(hull: readonly Spot[], q: Spot, out: Spot): Spot {
  if (hull.length === 0) throw new Error('no polygon to be near');
  let inside = hull.length >= 3;
  let best = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    if (cross(a, b, q) < 0) inside = false;
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const len2 = ex * ex + ez * ez;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * ex + (q[1] - a[1]) * ez) / len2)) : 0;
    const x = a[0] + t * ex;
    const z = a[1] + t * ez;
    const d = Math.hypot(q[0] - x, q[1] - z);
    if (d < best) [best, out[0], out[1]] = [d, x, z];
  }
  if (inside) [out[0], out[1]] = q;
  return out;
}

/** whether `q` lies in the convex `hull` (within `tolerance` of it) */
export function within(hull: readonly Spot[], q: Spot, tolerance: number): boolean {
  const n = nearest(hull, q, _n);
  return Math.hypot(q[0] - n[0], q[1] - n[1]) <= tolerance;
}

const cross = (o: Spot, a: Spot, b: Spot) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

const _n: Spot = [0, 0];
