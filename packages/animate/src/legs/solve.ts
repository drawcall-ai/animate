// A leg's joints posed as one bounded least-squares problem (Levenberg-Marquardt, an active set
// for the bounds): the terminal's position and turn stiff at contact, compliant through swing
// (joint references shape it while the sole clears the ground); each joint's reference a soft target weighted by
// the rig's own range for it; the ground a stiff one-sided target; every joint within its range.
import { Quaternion, Vector3 } from 'three';
import { wrapAngle, yawOf } from '../kernel/math';
import { beyond, clampRotation } from '../kernel/limits';
import type { Pose } from '../kernel/pose';
import type { Skeleton } from '../kernel/skeleton';
import type { LegChain } from '../species/leg';

/** A joint's axes, as a chain names them: y turns it, z swings it aside, x bends it (+ its far end forward) — Euler products, for their
 * analytic per-axis Jacobians; the rig's combined swing/twist range is enforced on them by `bound` */
const AXIS = { x: new Vector3(-1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) } as const;
const axisOf = (name: string): Vector3 => {
  if (name === 'x' || name === 'y' || name === 'z') return AXIS[name];
  throw new Error(`no axis ${name}`);
};

/** the error a solve singular at its pose (a leg pulled straight) throws */
export const SINGULAR = 'leg solve lost positive definiteness';
/** how stiff the terminal's targets are (per m², per rad²) against a joint's reference (per its range's square): ~32 µm off a target costs what a joint's whole range off its reference does */
const STIFF = 1e9;
/** Levenberg steps a solve (tuned: 24 settle the trot's most folded contact below 0.01 mm), and the step (rad) below which it has converged */
const STEPS = 24, CONVERGED = 1e-7;
/** A terminal pose (world), with one-sided ground constraints. */
export interface LegTarget {
  /** null: rigid contact; otherwise swing progress, with compliance vanishing before plant. */
  swing: number | null;
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
  private weightSum: number;
  private readonly prior: Float64Array;
  /** the coordinates as last posed */
  readonly q: Float64Array;
  /** the soft targets (set before `solve`) */
  readonly ref: Float64Array;
  rotationError = 0;
  private readonly offsets: Vector3[];
  /** the chain's base: its top bone's parent's world turn and the top joint's position */
  private readonly baseTurn = new Quaternion();
  private readonly basePosition = new Vector3();
  /** each coordinate's axis (world) and pivot, each bone's world turn and origin: the chain as `forward` last left it */
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
    const coordinates = joints.flatMap(({ axes }, k) => [...axes].map((axis) => ({ bone: k, axis: axisOf(axis) })));
    const n = (this.n = coordinates.length);
    if (n === 0 || n > MOST) throw new Error('a leg needs 1…16 coordinates');
    this.of = Int32Array.from(coordinates, ({ bone }) => bone);
    this.axes = coordinates.map(({ axis }) => axis);
    this.lo = new Float64Array(n);
    this.hi = new Float64Array(n);
    this.weight = new Float64Array(n);
    this.prior = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      const [lo, hi] = rangeOf(skeleton, bones[this.of[j]], this.axes[j]);
      this.weight[j] = 1 / ((hi - lo) * (hi - lo));
      this.lo[j] = lo;
      this.hi[j] = hi;
      if (hi <= lo) throw new Error('a leg coordinate needs a nonzero range');
    }
    this.weightSum = this.weight.reduce((sum, w) => sum + w, 0);
    this.q = new Float64Array(n);
    this.ref = new Float64Array(n);
    this.offsets = bones.map((b) => skeleton.bones[b].offset.clone());
    this.world = coordinates.map(() => new Vector3());
    this.at = coordinates.map(() => new Vector3());
    this.rotations = bones.map(() => new Quaternion());
    this.positions = bones.map(() => new Vector3());
  }

  /** the coordinates' reference (rad) for coordinate `j`, held within its range */
  setRef(j: number, value: number, weight = 1) {
    if (!(weight > 0 && Number.isFinite(weight))) throw new Error('a joint reference needs finite positive weight');
    const next = weight / (this.hi[j] - this.lo[j]) ** 2;
    this.weightSum += next - this.weight[j];
    this.weight[j] = next;
    this.ref[j] = Math.min(this.hi[j], Math.max(this.lo[j], value));
  }

  /**
   * The joints posed for `target` this tick, off `pose`'s posed parents, written into it: on from the coordinates as last posed (a miss
   * retried from the references if to `retry`, kept if that does better; a leg that must not jump does not). Returns the terminal's miss (m).
   */
  solve(pose: Pose, target: LegTarget, retry: boolean): number {
    this.prior.set(this.q);
    this.baseTurn.copy(pose.rotation(pose.skeleton.bones[this.bones[0]].parent));
    this.basePosition.copy(pose.position(this.bones[0]));
    let miss = this.iterate(target);
    if (retry && (miss > 1e-5 || target.above.some((point) => this.placed(point, _p).y < -1e-5))) {
      const kept = this.q.slice(), cost = this.cost(target, _r), previous = miss;
      this.q.set(this.ref);
      miss = this.iterate(target);
      if (this.cost(target, _r) >= cost) { this.q.set(kept); miss = previous; }
    }
    this.write(pose);
    return miss;
  }

  /**
   * The joints that reach `target` off an unturned base with the top joint at the origin, from the references in at most `steps` steps,
   * the pose and the coordinates untouched; how far the terminal's turn misses (rad) into `rotationError`. Returns the miss (m).
   */
  reach(target: LegTarget, steps: number): number {
    const was = _was.subarray(0, this.n);
    was.set(this.q);
    this.prior.set(this.ref);
    this.q.set(this.ref);
    this.baseTurn.identity();
    this.basePosition.set(0, 0, 0);
    const heading = () => Math.abs(wrapAngle(yawOf(target.rotation) - yawOf(this.rotations[this.bones.length - 1])));
    let miss = this.iterate(target, steps), angle = heading(), rotation = target.rotation.angleTo(this.rotations[this.bones.length - 1]);
    // An orientation-constrained reference can converge on the wrong branch; also try the completed pose.
    if (angle > 1e-4) {
      this.q.set(was);
      const next = this.iterate(target, steps), turn = heading();
      if (Math.max(next, turn) < Math.max(miss, angle)) { miss = next; rotation = target.rotation.angleTo(this.rotations[this.bones.length - 1]); }
    }
    this.q.set(was);
    this.rotationError = rotation;
    return miss;
  }

  /** Bounded damped Gauss-Newton (straight knees are singular): terminal miss in m. */
  private iterate(target: LegTarget, steps = STEPS): number {
    const { n, q, lo: lb, hi: ub, weight, ref } = this, H = _H, g = _g, d = _d, J = _J, fixed = _fixed, trial = _trial.subarray(0, n), was = _tried.subarray(0, n);
    this.bound(q);
    const r = _r;
    const wp = this.stiffness(target, Math.sqrt(STIFF)), wr = this.stiffness(target, this.weightSum);
    let cost = this.cost(target, r);
    let damping = 1e-3;
    for (let step = 0; step < steps; step++) {
      this.linearise(target, r);
      // H = Jᵀ W J + S, g = Jᵀ W r + S (q − ref).
      for (let i = 0; i < n; i++) {
        for (let k = i; k < n; k++) {
          let s = 0;
          for (let m = 0; m < 6; m++) s += (m < 3 ? wp : wr) * J[m * n + i] * J[m * n + k];
          H[i * n + k] = H[k * n + i] = s;
        }
        H[i * n + i] += weight[i];
        let s = weight[i] * (q[i] - (ref[i] + this.prior[i]) / 2);
        for (let m = 0; m < 6; m++) s += (m < 3 ? wp : wr) * J[m * n + i] * r[m];
        g[i] = s;
      }
      // the ground: each point below it pulled up, hard (its row: the height's rate per coordinate)
      for (const point of target.above) {
        const at = this.placed(point, _p);
        if (at.y >= 0) continue;
        const row = _row;
        for (let j = 0; j < n; j++) row[j] = _v.subVectors(at, this.at[j]).cross(this.world[j]).y * -1;
        for (let i = 0; i < n; i++) {
          for (let k = 0; k < n; k++) H[i * n + k] += STIFF * row[i] * row[k];
          g[i] += STIFF * row[i] * at.y;
        }
      }
      for (let j = 0; j < n; j++) _diagonal[j] = H[j * n + j];
      // tried at more damping until it lowers the cost (added, not scaled by the diagonal: the joints' freedom the targets leave them has a stiff diagonal too, and scaled it would barely move)
      let better = false;
      for (let tries = 0; tries < 16 && !better; tries++) {
        for (let j = 0; j < n; j++) H[j * n + j] = _diagonal[j] + damping;
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
      for (let j = 0; j < n; j++) most = Math.max(most, Math.abs(trial[j] - was[j]));
      if (most < CONVERGED) break;
    }
    this.cost(target, r);
    return Math.hypot(r[0], r[1], r[2]);
  }

  /** Enforce combined swing/twist ROM before accepting a candidate; a post-solve clamp would move the contact. */
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

  /** Tuned sqrt(STIFF): geometric midpoint of unit reference and contact stiffness.
   * Derived compliance (1-s)^6 has zero end value/rate/acceleration; STIFF caps conditioning. */
  private stiffness(target: LegTarget, free: number): number {
    return Math.min(STIFF, free / (target.swing === null ? 0 : (1 - target.swing) ** 6));
  }

  /** the cost at the coordinates now (the residual into `r`) */
  private cost(target: LegTarget, r: Float64Array): number {
    this.residual(target, r);
    let c = 0;
    const wp = this.stiffness(target, Math.sqrt(STIFF)), wr = this.stiffness(target, this.weightSum);
    for (let m = 0; m < 6; m++) c += (m < 3 ? wp : wr) * r[m] * r[m];
    for (let j = 0; j < this.n; j++) c += this.weight[j] * ((this.q[j] - this.ref[j]) ** 2 + (this.q[j] - this.prior[j]) ** 2) / 2;
    for (const point of target.above) {
      const y = this.placed(point, _v).y;
      if (y < 0) c += STIFF * y * y;
    }
    return c;
  }

  /** `point` of the terminal (its frame) where the chain now places it (world), into `out` */
  private placed(point: Readonly<Vector3>, out: Vector3): Vector3 {
    return out.copy(point).applyQuaternion(this.rotations[this.bones.length - 1]).add(this.positions[this.bones.length - 1]);
  }

  /** the terminal's residual (position m, turn rad: world) into `r` */
  private residual(target: LegTarget, r: Float64Array) {
    this.forward();
    const last = this.bones.length - 1;
    const tip = this.positions[last];
    r[0] = tip.x - target.position.x;
    r[1] = tip.y - target.position.y;
    r[2] = tip.z - target.position.z;
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
  private linearise(target: LegTarget, r: Float64Array) {
    const n = this.n, J = _J;
    this.residual(target, r);
    const tip = this.positions[this.bones.length - 1];
    for (let j = 0; j < n; j++) {
      const w = this.world[j];
      const arm = _v.subVectors(tip, this.at[j]).cross(w).negate();
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
/** the solve's scratch, shared by every leg (a solve runs to its end before another starts): sized for `MOST` coordinates */
const MOST = 16;
const _H = new Float64Array(MOST * MOST), _J = new Float64Array(6 * MOST), _fixed = new Uint8Array(MOST);
const [_g, _d, _trial, _tried, _diagonal, _row] = Array.from({ length: 6 }, () => new Float64Array(MOST));

/** H d = −g over the free coordinates, the fixed ones stepped onto the bound they passed (1: the lower, 2: the upper) */
function solveFree(H: Float64Array, g: Float64Array, fixed: Uint8Array, d: Float64Array, n: number, q: Float64Array, lb: Float64Array, ub: Float64Array) {
  const free: number[] = [];
  for (let j = 0; j < n; j++) {
    if (fixed[j]) d[j] = (fixed[j] === 1 ? lb[j] : ub[j]) - q[j];
    else free.push(j);
  }
  const m = free.length;
  const A = _A;
  const b = _b;
  for (let a = 0; a < m; a++) {
    let rhs = -g[free[a]];
    for (let j = 0; j < n; j++) if (fixed[j]) rhs -= H[free[a] * n + j] * d[j];
    b[a] = rhs;
    for (let c = 0; c < m; c++) A[a * m + c] = H[free[a] * n + free[c]];
  }
  // Cholesky: A is symmetric positive definite (the references' weights on its diagonal)
  for (let a = 0; a < m; a++) {
    for (let c = 0; c <= a; c++) {
      let s = A[a * m + c];
      for (let k = 0; k < c; k++) s -= A[a * m + k] * A[c * m + k];
      if (a === c && !(s > 0 && Number.isFinite(s))) throw new Error(SINGULAR);
      A[a * m + c] = a === c ? Math.sqrt(s) : s / A[c * m + c];
    }
  }
  for (let a = 0; a < m; a++) {
    let s = b[a];
    for (let k = 0; k < a; k++) s -= A[a * m + k] * b[k];
    b[a] = s / A[a * m + a];
  }
  for (let a = m - 1; a >= 0; a--) {
    let s = b[a];
    for (let k = a + 1; k < m; k++) s -= A[k * m + a] * b[k];
    b[a] = s / A[a * m + a];
  }
  for (let a = 0; a < m; a++) d[free[a]] = b[a];
}
const _A = new Float64Array(MOST * MOST), _b = new Float64Array(MOST);
