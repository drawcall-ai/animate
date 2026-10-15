// A leg's joints posed as one bounded least-squares problem (Levenberg-Marquardt, an active set
// for the bounds): the terminal's position and turn stiff targets (a contact, a landing), or orientation alone
// (a swing keeps its planned foot turn while clearing the ground); each joint's reference a soft target weighted by
// the rig's own range for it; the ground a stiff one-sided target; every joint within its range.
import { solveFree } from './linear';
import { Quaternion, Vector3 } from 'three';
import { beyond, clampRotation } from '../limits';
import type { Pose } from '../pose';
import type { Skeleton } from '../skeleton';
import type { LegChain } from './legs';

/** Euler products supply analytic per-axis Jacobians; limits.coordinatesOf uses swing/twist
 * coordinates for combined ROM instead, enforced by bound() below.
 * A joint's axes, as named in `Solver`'s `axes`: y turns it, z swings it aside, x bends it (+ its far end forward) */
const AXIS = { x: new Vector3(-1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) } as const;
const axisOf = (name: string): Vector3 => {
  if (name === 'x' || name === 'y' || name === 'z') return AXIS[name];
  throw new Error(`no axis ${name}`);
};

/** how stiff the terminal's targets are (per m², per rad²) against a joint's reference (per its range's square): ~32 µm off a target costs what a joint's whole range off its reference does */
const STIFF = 1e9;
/** Levenberg steps a solve, and the step (rad) below which it has converged */
// Tuned: 24 iterations settle the trot's most folded contact below 0.01 mm.
const STEPS = 24;
const CONVERGED = 1e-7;
/** Full terminal contact (world), or a swing with its reference orientation and one-sided ground constraints. */
export interface Target {
  /** false: position is free; ground correction keeps the reference foot orientation. */
  held: boolean;
  position: Vector3;
  rotation: Quaternion;
  /** points of the terminal (its frame) kept above the ground (y = 0), hard */
  above: readonly Vector3[];
}

export class Solver {
  /** the bones, from the top joint's to the terminal's */
  readonly bones: readonly number[];
  private readonly skeleton: Skeleton;
  readonly n: number;
  /** each coordinate's bone (an index into `bones`) and axis (local) */
  private readonly of: Int32Array;
  private readonly axes: Vector3[];
  /** each coordinate's range (rad, the rig's), and its reference's weight (1 / its span²) */
  readonly lo: Float64Array;
  readonly hi: Float64Array;
  private readonly weight: Float64Array;
  /** the coordinates as last posed and a tick before */
  readonly q: Float64Array;
  readonly q1: Float64Array;
  /** the soft targets (set before `solve`) */
  readonly ref: Float64Array;
  private readonly offsets: Vector3[];
  /** the chain's base: its top bone's parent's world turn and the top joint's position */
  private readonly baseTurn = new Quaternion();
  private readonly basePosition = new Vector3();
  // scratch
  private readonly H: Float64Array;
  private readonly g: Float64Array;
  private readonly d: Float64Array;
  private readonly fixed: Uint8Array;
  private readonly trial: Float64Array;
  private readonly was: Float64Array;
  private readonly diagonal: Float64Array;
  private readonly J: Float64Array;
  private readonly row: Float64Array;
  private readonly world: Vector3[];
  private readonly at: Vector3[];
  private readonly rotations: Quaternion[];
  private readonly positions: Vector3[];

  constructor(skeleton: Skeleton, joints: LegChain['joints']) {
    const bones = joints.map((j) => j.bone);
    if (bones.length < 2 || bones.some((b, k) => !skeleton.bones[b] || (k > 0 && skeleton.bones[b].parent !== bones[k - 1]))) throw new Error('legs need connected chains of at least two bones');
    if (skeleton.bones[bones[0]].parent < 0) throw new Error('a leg cannot include the root');
    this.skeleton = skeleton;
    this.bones = bones;
    const of: number[] = [];
    const list: Vector3[] = [];
    joints.forEach(({ axes: set }, k) => {
      for (const a of set) {
        of.push(k);
        list.push(axisOf(a));
      }
    });
    const n = (this.n = of.length);
    if (n === 0 || n > 16) throw new Error('a leg needs 1…16 coordinates');
    this.of = Int32Array.from(of);
    this.axes = list;
    this.lo = new Float64Array(n);
    this.hi = new Float64Array(n);
    this.weight = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      const [lo, hi] = rangeOf(skeleton, bones[of[j]], list[j]);
      this.weight[j] = 1 / ((hi - lo) * (hi - lo));
      this.lo[j] = lo;
      this.hi[j] = hi;
      if (hi <= lo) throw new Error('a leg coordinate needs a nonzero range');
    }
    this.q = new Float64Array(n);
    this.q1 = new Float64Array(n);
    this.ref = new Float64Array(n);
    this.offsets = bones.map((b) => skeleton.bones[b].offset.clone());
    this.H = new Float64Array(n * n);
    this.g = new Float64Array(n);
    this.d = new Float64Array(n);
    this.fixed = new Uint8Array(n);
    this.trial = new Float64Array(n);
    this.was = new Float64Array(n);
    this.diagonal = new Float64Array(n);
    this.J = new Float64Array(6 * n);
    this.row = new Float64Array(n);
    this.world = list.map(() => new Vector3());
    this.at = list.map(() => new Vector3());
    this.rotations = bones.map(() => new Quaternion());
    this.positions = bones.map(() => new Vector3());
  }

  /** the coordinates' reference (rad) for coordinate `j`, held within its range */
  setRef(j: number, value: number) {
    this.ref[j] = Math.min(this.hi[j], Math.max(this.lo[j], value));
  }

  /**
   * The joints posed for `target` this tick, off `pose`'s posed parents, written into it (the
   * previous coordinates kept). Start from bent references to avoid the straight-hinge saddle. Returns the terminal's miss (m).
   */
  solve(pose: Pose, target: Target): number {
    this.q1.set(this.q);
    this.q.set(this.ref);
    this.base(pose.rotation(pose.skeleton.bones[this.bones[0]].parent), pose.position(this.bones[0]));
    if (!target.held) {
      // A free orientation lets the ground solve flip the pastern through a different bend.
      this.forward();
      target.rotation.copy(this.rotations[this.bones.length - 1]);
    }
    const miss = this.iterate(target);
    this.write(pose);
    return miss;
  }

  /** the joints `q` (rad, from them: written back) that reach `target` off a base turned `turn` at `top` (the top joint's world position), the pose untouched. Returns the miss (m). */
  reach(turn: Readonly<Quaternion>, top: Readonly<Vector3>, target: Target, q: Float64Array): number {
    const was = _was.subarray(0, this.n);
    was.set(this.q);
    this.q.set(this.ref);
    this.base(turn, top);
    const miss = this.iterate(target);
    q.set(this.q);
    this.q.set(was);
    return miss;
  }

  /** the lowest of the terminal's `points` (its frame) above the ground (m) with the joints at `q`, off a base turned `turn` at `top` */
  lowest(turn: Readonly<Quaternion>, top: Readonly<Vector3>, q: Float64Array, points: readonly Vector3[]): number {
    const was = _was.subarray(0, this.n);
    was.set(this.q);
    this.q.set(q);
    this.base(turn, top);
    this.forward();
    this.q.set(was);
    const last = this.bones.length - 1;
    let low = Infinity;
    for (const point of points) low = Math.min(low, _p.copy(point).applyQuaternion(this.rotations[last]).add(this.positions[last]).y);
    return low;
  }

  private base(turn: Readonly<Quaternion>, top: Readonly<Vector3>) {
    this.baseTurn.copy(turn);
    this.basePosition.copy(top);
  }

  /**
   * Levenberg's damped Gauss-Newton from the coordinates as they are, within their ranges (a straight knee is singular:
   * plain Gauss-Newton would leap): the terminal's miss (m)
   */
  private iterate(target: Target): number {
    const { n, q, H, g, d, J, lo: lb, hi: ub, fixed, weight, ref, trial } = this;
    this.bound(q);
    const r = _r;
    const hold = target.held ? 1 : 0;
    const wp = STIFF * hold;
    let cost = this.cost(target, r);
    let damping = 1e-3;
    for (let step = 0; step < STEPS; step++) {
      this.linearise(target, r);
      // H = Jᵀ W J + S, g = Jᵀ W r + S (q − ref).
      for (let i = 0; i < n; i++) {
        for (let k = i; k < n; k++) {
          let s = 0;
          for (let m = 0; m < 6; m++) s += (m < 3 ? wp : STIFF) * J[m * n + i] * J[m * n + k];
          H[i * n + k] = H[k * n + i] = s;
        }
        H[i * n + i] += weight[i];
        let s = weight[i] * (q[i] - ref[i]);
        for (let m = 0; m < 6; m++) s += (m < 3 ? wp : STIFF) * J[m * n + i] * r[m];
        g[i] = s;
      }
      // the ground: each point below it pulled up, hard (its row: the height's rate per coordinate)
      const last = this.bones.length - 1;
      for (const point of target.above) {
        const at = _p.copy(point).applyQuaternion(this.rotations[last]).add(this.positions[last]);
        if (at.y >= 0) continue;
        const row = this.row;
        for (let j = 0; j < n; j++) row[j] = _v.subVectors(at, this.at[j]).cross(this.world[j]).y * -1;
        for (let i = 0; i < n; i++) {
          for (let k = 0; k < n; k++) H[i * n + k] += STIFF * row[i] * row[k];
          g[i] += STIFF * row[i] * at.y;
        }
      }
      for (let j = 0; j < n; j++) this.diagonal[j] = H[j * n + j];
      // tried at more damping until it lowers the cost (added, not scaled by the diagonal: the joints' freedom the targets leave them has a stiff diagonal too, and scaled it would barely move)
      let better = false;
      for (let tries = 0; tries < 16 && !better; tries++) {
        for (let j = 0; j < n; j++) H[j * n + j] = this.diagonal[j] + damping;
        // the step on the free coordinates; those it would carry past a bound held there, again
        fixed.fill(0);
        for (let pass = 0; pass <= n; pass++) {
          solveFree(H, g, fixed, d, n, q, lb, ub);
          let out = false;
          for (let j = 0; j < n; j++) {
            if (fixed[j]) continue;
            const x = q[j] + d[j];
            if (x < lb[j] - 1e-12 || x > ub[j] + 1e-12) {
              fixed[j] = x < lb[j] ? 1 : 2;
              out = true;
            }
          }
          if (!out) break;
        }
        for (let j = 0; j < n; j++) trial[j] = Math.min(ub[j], Math.max(lb[j], q[j] + d[j]));
        this.bound(trial);
        const was = this.was;
        was.set(q);
        q.set(trial);
        const c = this.cost(target, r);
        if (c < cost) {
          cost = c;
          better = true;
          damping = Math.max(1e-9, damping / 10);
        } else {
          q.set(was);
          damping *= 10;
        }
      }
      if (!better) break;
      let most = 0;
      for (let j = 0; j < n; j++) most = Math.max(most, Math.abs(trial[j] - this.was[j]));
      if (most < CONVERGED) break;
    }
    this.cost(target, r);
    return Math.hypot(r[0], r[1], r[2]);
  }

  /** Euler coordinate boxes alone do not enforce the rig's combined swing/twist limit.
   * Project each candidate toward its valid neutral before accepting it. Bounds are constraints,
   * never a clamp applied after the contact solve (which would move a planted foot).
   */
  private bound(q: Float64Array): void {
    for (let j = 0; j < this.n; j++) q[j] = Math.min(this.hi[j], Math.max(this.lo[j], q[j]));
    for (let k = 0; k < this.bones.length; k++) {
      const limit = this.skeleton.limits[this.bones[k]];
      if (!limit) continue;
      const excess = (scale: number) => {
        _l.identity();
        for (let j = 0; j < this.n; j++) if (this.of[j] === k) _l.multiply(_q.setFromAxisAngle(this.axes[j], q[j] * scale));
        return beyond(_l, limit);
      };
      if (excess(1) < 1e-10) continue;
      let lo = 0;
      let hi = 1;
      // 32 bisections leave less than a nanoradian at a full turn.
      for (let step = 0; step < 32; step++) {
        const mid = (lo + hi) / 2;
        if (excess(mid) < 1e-10) lo = mid;
        else hi = mid;
      }
      for (let j = 0; j < this.n; j++) if (this.of[j] === k) q[j] *= lo;
    }
  }

  /** the cost at the coordinates now (the residual into `r`) */
  private cost(target: Target, r: Float64Array): number {
    this.residual(target, r);
    let c = 0;
    for (let m = target.held ? 0 : 3; m < 6; m++) c += STIFF * r[m] * r[m];
    for (let j = 0; j < this.n; j++) c += this.weight[j] * (this.q[j] - this.ref[j]) ** 2;
    const last = this.bones.length - 1;
    for (const point of target.above) {
      const y = _v.copy(point).applyQuaternion(this.rotations[last]).add(this.positions[last]).y;
      if (y < 0) c += STIFF * y * y;
    }
    return c;
  }

  /** the terminal's residual (position m, turn rad: world) into `r` */
  private residual(target: Target, r: Float64Array) {
    this.forward();
    const last = this.bones.length - 1;
    const p = this.positions[last];
    r[0] = p.x - target.position.x;
    r[1] = p.y - target.position.y;
    r[2] = p.z - target.position.z;
    // (the turn's error as a rotation vector: R · R*⁻¹)
    const e = _e.copy(target.rotation).invert().premultiply(this.rotations[last]);
    if (e.w < 0) e.set(-e.x, -e.y, -e.z, -e.w);
    const s = Math.hypot(e.x, e.y, e.z);
    const k = s > 1e-12 ? (2 * Math.atan2(s, e.w)) / s : 2;
    r[3] = e.x * k;
    r[4] = e.y * k;
    r[5] = e.z * k;
  }

  /** the residual into `r` and the Jacobian into `J` at the coordinates now */
  private linearise(target: Target, r: Float64Array) {
    const { n, J } = this;
    this.residual(target, r);
    const p = this.positions[this.bones.length - 1];
    for (let j = 0; j < n; j++) {
      const w = this.world[j];
      const arm = _v.subVectors(p, this.at[j]).cross(w).negate();
      J[0 * n + j] = arm.x;
      J[1 * n + j] = arm.y;
      J[2 * n + j] = arm.z;
      J[3 * n + j] = w.x;
      J[4 * n + j] = w.y;
      J[5 * n + j] = w.z;
    }
  }

  /** forward kinematics of the chain off its base: each bone's world turn and origin, each coordinate's axis (world) and pivot */
  private forward() {
    let j = 0;
    for (let k = 0; k < this.bones.length; k++) {
      const R = this.rotations[k];
      const P = this.positions[k];
      if (k === 0) {
        R.copy(this.baseTurn);
        P.copy(this.basePosition);
      } else {
        R.copy(this.rotations[k - 1]);
        P.copy(this.offsets[k]).applyQuaternion(R).add(this.positions[k - 1]);
      }
      while (j < this.n && this.of[j] === k) {
        this.world[j].copy(this.axes[j]).applyQuaternion(R);
        this.at[j].copy(P);
        R.multiply(_q.setFromAxisAngle(this.axes[j], this.q[j]));
        j++;
      }
    }
  }

  /** the coordinates as the bones' locals */
  private write(pose: Pose) {
    let j = 0;
    for (let k = 0; k < this.bones.length; k++) {
      const local = _l.identity();
      while (j < this.n && this.of[j] === k) {
        local.multiply(_q.setFromAxisAngle(this.axes[j], this.q[j]));
        j++;
      }
      pose.setLocal(this.bones[k], local);
    }
  }
}

/** a coordinate's range (rad): how far its bone turns about `axis` alone before its limit holds it (±π without one) */
function rangeOf(skeleton: Skeleton, bone: number, axis: Vector3): [number, number] {
  const limit = skeleton.limits[bone];
  if (!limit) return [-Math.PI, Math.PI];
  const within = (a: number) => !clampRotation(_q.setFromAxisAngle(axis, a), limit);
  if (!within(0)) throw new Error(`bone "${skeleton.bones[bone].name}" stands outside its range`);
  // Numerical range probe: quarter-degree resolution, conservatively inside the ROM.
  const STEP = Math.PI / 720;
  let hi = 0;
  while (hi < Math.PI && within(hi + STEP)) hi += STEP;
  let lo = 0;
  while (lo > -Math.PI && within(lo - STEP)) lo -= STEP;
  return [lo, hi];
}

const _q = new Quaternion();
const _l = new Quaternion();
const _e = new Quaternion();
const _v = new Vector3();
const _p = new Vector3();
const _r = new Float64Array(6);
const _was = new Float64Array(16);
