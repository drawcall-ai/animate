import { Vector3 } from 'three';
import { GRAVITY, hypot } from '../math';
import { centreOfMass } from '../pose/mass';
import type { Joints } from '../pose/pose';
import type { Proportions } from '../proportions';

/** half a foot's width at the toes: how far past the ankle's line a foot holds the body sideways (m, default body) */
export const FOOT_HALF_WIDTH = 0.04;

const _c = new Vector3();
const _v = new Vector3();

/**
 * The posed body's extrapolated centre of mass (Hof): its centre of mass run ahead by its
 * velocity over ω0 = √(g / leg length) — the point the feet must cover for the body to
 * come to rest over them (less the lean a force at the hands holds it at). The gait steps to
 * keep it within the base of support.
 */
export class Capture {
  /** ω0 = √(g / leg length) (1/s): how fast the body falls away from its support */
  readonly omega: number;
  /** the posed body's centre of mass, as last observed; read-only */
  readonly com = new Vector3();
  private velocity = new Vector3();
  /** the extrapolated centre of mass, on the floor (y = 0); read-only */
  readonly point = new Vector3();
  private observed = false;
  // the base of support: footprint corners (x, z), then their convex hull
  private corners = new Float64Array(12);
  private hull = new Float64Array(24);

  constructor(private d: Proportions) {
    this.omega = Math.sqrt(GRAVITY / d.legLength);
  }

  /** standing still at (x, z) */
  reset(x: number, z: number) {
    this.observed = false;
    this.velocity.set(0, 0, 0);
    this.point.set(x, 0, z);
  }

  /** the pose after a tick of `dt`; `lean`: where balance holds the centre of mass off the feet (a force at the hands) */
  observe(joints: Joints, dt: number, lean: Vector3) {
    const com = centreOfMass(joints, _c);
    if (this.observed && dt > 0) {
      // the pose's tick-to-tick jitter is no velocity to step for: it changes no faster than
      // the feet can push the body (friction: about g, horizontally)
      const dv = _v.subVectors(com, this.com).divideScalar(dt).sub(this.velocity).setY(0);
      const max = GRAVITY * dt;
      const len = dv.length();
      this.velocity.addScaledVector(dv, len > max ? max / len : 1);
    } else this.velocity.set(0, 0, 0);
    this.com.copy(com);
    this.observed = true;
    this.point.copy(com).addScaledVector(this.velocity, 1 / this.omega).sub(lean).setY(0);
  }

  /**
   * How far the extrapolated centre of mass lies outside the base of support of a foot
   * standing flat at `a` with heading `aYaw` and, unless null, another at `b` (0 inside).
   * `away` (optional) gets the unit direction from the base toward the point.
   */
  outside(a: Vector3, aYaw: number, b: Vector3 | null, bYaw: number, away?: Vector3): number {
    return this.outsideOf(this.point, a, aYaw, b, bYaw, away);
  }

  /** `outside` for another point: the extrapolated centre of mass as predicted for later (x, z) */
  outsideOf(point: Vector3, a: Vector3, aYaw: number, b: Vector3 | null, bYaw: number, away?: Vector3): number {
    const n = this.base(a, aYaw, b, bYaw);
    const h = this.hull;
    const { x: qx, z: qz } = point;
    let inside = true;
    let best = Infinity;
    let nx = 0;
    let nz = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = h[2 * i];
      const az = h[2 * i + 1];
      const ex = h[2 * j] - ax;
      const ez = h[2 * j + 1] - az;
      if (ex * (qz - az) - ez * (qx - ax) < 0) inside = false;
      const len2 = ex * ex + ez * ez;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((qx - ax) * ex + (qz - az) * ez) / len2)) : 0;
      const dist = hypot(qx - ax - t * ex, qz - az - t * ez);
      if (dist < best) {
        best = dist;
        nx = ax + t * ex;
        nz = az + t * ez;
      }
    }
    if (inside) return 0;
    if (away) away.set(qx - nx, 0, qz - nz).divideScalar(best || 1);
    return best;
  }

  /**
   * How far (x, z) can move along the unit direction (dx, dz) before it leaves the base of
   * a flat foot and, unless null, another (0 when it already lies outside, moving out).
   */
  room(x: number, z: number, dx: number, dz: number, a: Vector3, aYaw: number, b: Vector3 | null, bYaw: number): number {
    const n = this.base(a, aYaw, b, bYaw);
    const h = this.hull;
    let room = Infinity;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = h[2 * i];
      const az = h[2 * i + 1];
      const ex = h[2 * j] - ax;
      const ez = h[2 * j + 1] - az;
      // (the outward normal of a counter-clockwise edge, unnormalised: the ratio needs none)
      const toward = ez * dx - ex * dz;
      if (toward <= 0) continue;
      const beyond = ez * (x - ax) - ex * (z - az);
      room = Math.min(room, Math.max(0, -beyond / toward));
    }
    return room;
  }

  /** the base of support's convex hull (counter-clockwise in x, z) into `hull`; returns its corner count */
  private base(a: Vector3, aYaw: number, b: Vector3 | null, bYaw: number): number {
    const c = this.corners;
    this.footprint(a, aYaw, c, 0);
    if (b) this.footprint(b, bYaw, c, 6);
    return convexHull(c, b ? 6 : 3, this.hull);
  }

  /** heel and the toe edge's corners (x, z) of a flat foot, into `out` from `at` */
  private footprint(ankle: Vector3, yaw: number, out: Float64Array, at: number) {
    const { heelBack, toeFront, scale } = this.d;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const w = FOOT_HALF_WIDTH * scale;
    out[at] = ankle.x - fx * heelBack;
    out[at + 1] = ankle.z - fz * heelBack;
    out[at + 2] = ankle.x + fx * toeFront + fz * w;
    out[at + 3] = ankle.z + fz * toeFront - fx * w;
    out[at + 4] = ankle.x + fx * toeFront - fz * w;
    out[at + 5] = ankle.z + fz * toeFront + fx * w;
  }
}

/**
 * The convex hull (counter-clockwise, Andrew's monotone chain) of the first `n` points
 * (x, z pairs) of `pts`, which it sorts, into `hull` (room for 4n numbers); returns its
 * corner count.
 */
function convexHull(pts: Float64Array, n: number, hull: Float64Array): number {
  // sort by x, then z (insertion sort: a handful of points)
  for (let i = 1; i < n; i++) {
    const x = pts[2 * i];
    const z = pts[2 * i + 1];
    let j = i - 1;
    while (j >= 0 && (pts[2 * j] > x || (pts[2 * j] === x && pts[2 * j + 1] > z))) {
      pts[2 * j + 2] = pts[2 * j];
      pts[2 * j + 3] = pts[2 * j + 1];
      j--;
    }
    pts[2 * j + 2] = x;
    pts[2 * j + 3] = z;
  }
  // the lower hull, then the upper
  let k = 0;
  for (let pass = 0; pass < 2; pass++) {
    const floor = k;
    for (let s = 0; s < n; s++) {
      const i = pass === 0 ? s : n - 1 - s;
      const x = pts[2 * i];
      const z = pts[2 * i + 1];
      while (k - floor >= 2 && cross(hull[2 * k - 4], hull[2 * k - 3], hull[2 * k - 2], hull[2 * k - 1], x, z) <= 0) k--;
      hull[2 * k] = x;
      hull[2 * k + 1] = z;
      k++;
    }
    k--;
  }
  return k;
}

/** (b − a) × (c − a): > 0 when c lies left of a → b */
const cross = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
