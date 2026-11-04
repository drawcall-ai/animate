import { Vector3 } from 'three';
import type { Merged } from './board';
import { hullOf, nearest, type Spot } from './polygon';
import type { BodyState } from './state';

/** the acceleration of gravity (m/s², along −Y) */
export const GRAVITY = 9.81;
/**
 * how hard the supports may push sideways for how hard they push up: friction's coefficient
 * (rubber on a dry floor ~0.8–1)
 */
export const FRICTION = 1;
/**
 * the least depth below the centre of mass (or height above it) a support point counts at, × the
 * skeleton's length: one level with it would hold any lean
 */
const LEVEL = 0.05;
/** how much less able to stop (m/s², at 1 g) still counts as no less: rounding */
const SLACK = 1e-9;

/**
 * What the weight-bearing contacts (support > 0) let the centre of mass do over a step.
 *
 * What they give it: with none, it flies, falling at 1 g; holding on with a `grip` (a hand round a
 * rung, a bolted base), anything; else they push, never pull it down (its vertical acceleration is
 * at least −g), and sideways no harder than friction lets them for how hard they push up
 * (`|a_xz| ≤ FRICTION (g + a_y)`). Where they push from is left to the body's turning: the limbs'
 * swing changes its angular momentum, so the centre of pressure is not the inverted pendulum's
 * (`c − a h / g`) — a kinematic gait's leaves the feet in a quarter of its steps.
 *
 * How balanced it is: how far it is from being able to stop over its supports. As an inverted
 * pendulum (Kajita 2001) a body pushed from a point `p` accelerates sideways by
 * `g (c − p) / (c_y − p_y)`: the supports' footprints (or their points) give the hull of such
 * accelerations, and a body moving at `v` can still stop over them while `−ω0 v` is one (its
 * extrapolated centre of mass `c + v / ω0` within them, Hof 2008; `ω0 = √(g / h)`, `h` their mean
 * depth under it). Supports level with it or above it hold it up: it does not fall.
 */
export class Balance {
  private readonly kind: 'flight' | 'held' | 'supported';
  /** the horizontal accelerations (x, z) the supports give an inverted pendulum at 1 g: a convex hull; null: it does not fall */
  private readonly region: Spot[] | null = null;
  /** the body's natural frequency as an inverted pendulum on its supports (1/s) */
  readonly omega: number = 0;

  constructor(state: BodyState, contacts: Merged['contacts']) {
    const bearing = contacts.filter((c) => (c.support ?? 0) > 0);
    if (bearing.length === 0) {
      this.kind = 'flight';
      return;
    }
    if (bearing.some((c) => c.grip)) {
      this.kind = 'held';
      return;
    }
    this.kind = 'supported';
    const c = state.com;
    const least = LEVEL * state.skeleton.length;
    const spots: Spot[] = [];
    let depth = 0;
    for (const contact of bearing) {
      for (const p of contact.footprint ?? [state.point(contact.point, _p)]) {
        const h = c.y - p.y;
        if (h < least) return;
        spots.push([(GRAVITY * (c.x - p.x)) / h, (GRAVITY * (c.z - p.z)) / h]);
        depth += h;
      }
    }
    this.region = hullOf(spots);
    this.omega = Math.sqrt(GRAVITY / (depth / spots.length));
  }

  /** what the supports give (into `a`, m/s²): `a` itself, or the acceleration they give nearest it */
  bound(a: Vector3): Vector3 {
    if (this.kind === 'held') return a;
    if (this.kind === 'flight') return a.set(0, -GRAVITY, 0);
    a.y = Math.max(a.y, -GRAVITY);
    const most = FRICTION * (GRAVITY + a.y);
    const sideways = Math.hypot(a.x, a.z);
    if (sideways > most) {
      a.x *= most / sideways;
      a.z *= most / sideways;
    }
    return a;
  }

  /**
   * `bound`, and kept balanced: a body moving at `v` (m/s) is sped up by `a` over `dt` only as far
   * from `wish` (what its balance asks of it) toward `a` as leaves it no further from being able to
   * stop over its supports than `wish` would (into `a`; `wish` is bound too)
   */
  brake(a: Vector3, wish: Vector3, v: Vector3, dt: number): Vector3 {
    this.bound(a);
    if (!this.region) return a;
    this.bound(wish);
    const most = (k: number) => FRICTION * (GRAVITY + wish.y + k * (a.y - wish.y));
    const off = (k: number) => this.off(v.x + (wish.x + k * (a.x - wish.x)) * dt, v.z + (wish.z + k * (a.z - wish.z)) * dt);
    const allowed = off(0) + SLACK;
    if (off(1) <= allowed) return a;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (off(mid) <= allowed && Math.hypot(wish.x + mid * (a.x - wish.x), wish.z + mid * (a.z - wish.z)) <= most(mid)) lo = mid;
      else hi = mid;
    }
    return a.set(wish.x + lo * (a.x - wish.x), wish.y + lo * (a.y - wish.y), wish.z + lo * (a.z - wish.z));
  }

  /** how far (m/s², at 1 g) a body moving at (x, z) (m/s) is from being able to stop over its supports: 0 when it can */
  private off(x: number, z: number): number {
    if (!this.region) return 0;
    const q: Spot = [-this.omega * x, -this.omega * z];
    const n = nearest(this.region, q, _n);
    return Math.hypot(q[0] - n[0], q[1] - n[1]);
  }
}

const _n: Spot = [0, 0];
const _p = new Vector3();
