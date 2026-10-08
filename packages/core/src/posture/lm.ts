import { solveLinear } from './gauss';
import type { SolveMemo } from './memo';

/**
 * Residuals are written into `out`, returning how many there are; that number must not
 * change within a solve (a fixed row layout: the Jacobian is built by finite differences).
 */
export interface Residuals {
  evaluate(p: Float64Array, out: Float64Array): number;
}

/** What a solve runs within: per parameter, its limits and whether it is free. */
export interface Bounds {
  readonly lower: Float64Array;
  readonly upper: Float64Array;
  /** parameters with active[i] = 0 are held fixed */
  readonly active: Uint8Array;
}

export interface Effort {
  /** upper limit on Gauss–Newton steps */
  maxIterations: number;
  /** stop once an accepted step lowers the cost by less than this fraction */
  minDecrease: number;
}

/** damping retries after a rejected step, per iteration */
const MAX_RETRIES = 2;
/**
 * Damping each solve starts from. Fresh per solve: a problem that converged last tick
 * leaves the damping saturated, and a new target then needs real steps.
 */
const INITIAL_DAMPING = 1e-2;

/** Tiny bounded Levenberg–Marquardt for low-dimensional problems with finite-difference Jacobians. */
export class LevenbergMarquardt implements Bounds {
  readonly lower: Float64Array;
  readonly upper: Float64Array;
  /** parameters with active[i] = 0 are held fixed */
  readonly active: Uint8Array;
  /** largest change of each parameter per step */
  readonly maxStep: Float64Array;
  private r: Float64Array;
  private r2: Float64Array;
  /** column-major: column c holds the derivatives by parameter free[c] */
  private J: Float64Array;
  private A: Float64Array;
  private A2: Float64Array;
  private g: Float64Array;
  private delta: Float64Array;
  private trial: Float64Array;
  /** indices of the parameters solved for in this iteration */
  private free: Int32Array;
  /** parameters that hit a bound on an accepted step: held there for the rest of the solve */
  private pinned: Uint8Array;

  constructor(
    private n: number,
    private capacity: number,
  ) {
    this.lower = new Float64Array(n);
    this.upper = new Float64Array(n);
    this.active = new Uint8Array(n);
    this.maxStep = new Float64Array(n).fill(Infinity);
    this.r = new Float64Array(capacity);
    this.r2 = new Float64Array(capacity);
    this.J = new Float64Array(capacity * n);
    this.A = new Float64Array(n * n);
    this.A2 = new Float64Array(n * n);
    this.g = new Float64Array(n);
    this.delta = new Float64Array(n);
    this.trial = new Float64Array(n);
    this.free = new Int32Array(n);
    this.pinned = new Uint8Array(n);
  }

  /**
   * Improves `p` in place within the bounds; returns the cost it reached. With a `memo`,
   * a warm start that would find what the last solve settled on returns at once.
   */
  solve(p: Float64Array, f: Residuals, effort: Effort, memo: SolveMemo | null = null): number {
    const { n, r, r2, A, A2, g, delta, trial, free, pinned, lower, upper, maxStep } = this;
    let lambda = INITIAL_DAMPING;
    pinned.fill(0);
    const m = this.evaluate(f, p, r);
    let cost = sumSq(r, m);
    if (memo?.unchanged(p, r, m, this)) return cost;
    /** relative cost decrease of the last step (0 when no step improved the cost) */
    let decrease = 0;

    // k free parameters; J, A and g hold the linearisation at p while `linear` is true
    let k = 0;
    let linear = false;
    for (let it = 0; it < effort.maxIterations; it++) {
      if (!linear) {
        k = 0;
        for (let j = 0; j < n; j++) if (this.active[j] && !pinned[j]) free[k++] = j;
        if (k === 0) break;
        this.linearise(f, p, m, k);
        linear = true;
      }
      decrease = 0;
      // a rejected step raises the damping and retries on the same linearisation; the
      // retries left over carry into the next iteration (the Jacobian is still valid)
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        for (let i = 0; i < k * k; i++) A2[i] = A[i];
        for (let a = 0; a < k; a++) {
          A2[a * k + a] += lambda * (A[a * k + a] + 1e-6) + 1e-9;
          delta[a] = -g[a];
        }
        solveLinear(A2, delta, k);
        trial.set(p);
        for (let c = 0; c < k; c++) {
          const j = free[c];
          const step = Math.max(-maxStep[j], Math.min(maxStep[j], delta[c]));
          trial[j] = Math.min(upper[j], Math.max(lower[j], p[j] + step));
        }
        const c2 = sumSq(r2, this.evaluate(f, trial, r2, m));
        if (c2 < cost) {
          for (let c = 0; c < k; c++) {
            const j = free[c];
            if (trial[j] !== p[j] + delta[c] && (trial[j] === lower[j] || trial[j] === upper[j])) pinned[j] = 1;
          }
          p.set(trial);
          for (let i = 0; i < m; i++) r[i] = r2[i];
          decrease = (cost - c2) / cost;
          cost = c2;
          lambda = Math.max(1e-6, lambda / 3);
          linear = false;
          break;
        }
        lambda = Math.min(1e6, lambda * 4);
      }
      if (!linear && decrease < effort.minDecrease) break;
    }
    memo?.settle(p, r, m);
    return cost;
  }

  /** Forward-difference Jacobian of the free parameters, and the normal equations JᵀJ δ = −Jᵀr. */
  private linearise(f: Residuals, p: Float64Array, m: number, k: number) {
    const { r, r2, J, A, g, free } = this;
    for (let c = 0; c < k; c++) {
      const j = free[c];
      const h = 1e-5 * Math.max(1, Math.abs(p[j]));
      const saved = p[j];
      p[j] = saved + h;
      this.evaluate(f, p, r2, m);
      p[j] = saved;
      for (let i = 0; i < m; i++) J[c * m + i] = (r2[i] - r[i]) / h;
    }
    for (let a = 0; a < k; a++) {
      g[a] = dot(J, a * m, r, 0, m);
      for (let b = a; b < k; b++) A[a * k + b] = A[b * k + a] = dot(J, a * m, J, b * m, m);
    }
  }

  /** evaluate the residuals, failing loudly if they overflow the buffer or change their layout */
  private evaluate(f: Residuals, p: Float64Array, out: Float64Array, expected = -1): number {
    const m = f.evaluate(p, out);
    if (m > this.capacity) throw new Error(`LevenbergMarquardt: ${m} residuals exceed the capacity of ${this.capacity}`);
    if (expected >= 0 && m !== expected) throw new Error(`LevenbergMarquardt: residual count changed within a solve (${expected} → ${m})`);
    return m;
  }
}

function sumSq(r: Float64Array, m: number): number {
  let s = 0;
  for (let i = 0; i < m; i++) s += r[i] * r[i];
  return s;
}

/** Σ x[i + n] · y[j + n] over n < m */
function dot(x: Float64Array, i: number, y: Float64Array, j: number, m: number): number {
  let s = 0;
  for (let n = 0; n < m; n++) s += x[i + n] * y[j + n];
  return s;
}
