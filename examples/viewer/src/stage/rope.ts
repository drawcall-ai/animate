import { Vector3 } from 'three';

/** gravity (m/s²) */
const GRAVITY = 9.81;
/** share of a point's velocity kept per second (tuned: a lead rope settles within about a second) */
const DAMPING = 0.05;
/** constraint passes per step (tuned: a 2.4 m, 24-point rope keeps its length within 1% while led at a walk) */
const PASSES = 40;
/** how far above the ground a rope lies (m, its radius) */
const RADIUS = 0.012;

/**
 * A rope of fixed length hanging under gravity: a chain of points kept apart by their spacing
 * (position-based dynamics with Verlet integration — Jakobsen 2001, "Advanced Character Physics",
 * recalled). Whatever holds it pins a point along its length (0 one end, 1 the other) each step;
 * the rest hangs, and lies on the ground. Deterministic: no randomness, a fixed step.
 */
export class Rope {
  /** its points, from one end to the other (world, m) */
  readonly points: Vector3[];
  private readonly before: Vector3[];
  private readonly spacing: number;

  /** a rope `length` long (m), laid straight from `from` to `to`, in `count` segments */
  constructor(from: Vector3, to: Vector3, length: number, count = 24) {
    this.points = Array.from({ length: count + 1 }, (_, k) => from.clone().lerp(to, k / count));
    this.before = this.points.map((p) => p.clone());
    this.spacing = length / count;
  }

  /** moves it on `dt` (s), the points `u` along it held where `pins` put them */
  step(dt: number, pins: [u: number, at: Vector3][]): void {
    const { points, before, spacing } = this;
    const keep = DAMPING ** dt;
    for (let k = 0; k < points.length; k++) {
      const p = points[k];
      _v.subVectors(p, before[k]).multiplyScalar(keep);
      before[k].copy(p);
      p.add(_v);
      p.y -= GRAVITY * dt * dt;
    }
    const held = pins.map(([u, at]) => [this.index(u), at] as const);
    for (let pass = 0; pass < PASSES; pass++) {
      for (let k = 1; k < points.length; k++) {
        const a = points[k - 1], b = points[k];
        const d = _v.subVectors(b, a), length = d.length();
        if (length < 1e-9) continue;
        d.multiplyScalar((length - spacing) / length / 2);
        a.add(d);
        b.sub(d);
      }
      for (const [k, at] of held) points[k].copy(at);
      for (const p of points) p.y = Math.max(p.y, RADIUS);
    }
  }

  private index(u: number): number {
    return Math.round(Math.min(1, Math.max(0, u)) * (this.points.length - 1));
  }
}

const _v = new Vector3();
