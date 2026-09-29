/**
 * Tiny bounded Levenberg–Marquardt for low-dimensional problems with
 * finite-difference Jacobians. Residual functions write into `out` and return
 * the number of residuals.
 */
export type ResidualFn = (p: Float64Array, out: Float64Array) => number;

const MAX_RES = 96;

export interface LMOptions {
  iterations: number;
  lower: Float64Array;
  upper: Float64Array;
  /** parameters with active[i] = 0 are held fixed */
  active: Uint8Array;
}

export class LevenbergMarquardt {
  private r = new Float64Array(MAX_RES);
  private r2 = new Float64Array(MAX_RES);
  private J: Float64Array;
  private A: Float64Array;
  private g: Float64Array;
  private delta: Float64Array;
  private trial: Float64Array;
  private lambda = 1e-2;

  constructor(private n: number) {
    this.J = new Float64Array(MAX_RES * n);
    this.A = new Float64Array(n * n);
    this.g = new Float64Array(n);
    this.delta = new Float64Array(n);
    this.trial = new Float64Array(n);
  }

  solve(p: Float64Array, f: ResidualFn, opt: LMOptions): number {
    const { n, r, r2, J, A, g, delta, trial } = this;
    // fresh damping per solve: a previous (different) problem may have left it huge
    this.lambda = 1e-2;
    let m = f(p, r);
    let cost = sumSq(r, m);

    for (let it = 0; it < opt.iterations; it++) {
      // Jacobian by forward differences
      for (let j = 0; j < n; j++) {
        if (!opt.active[j]) continue;
        const h = 1e-5 * Math.max(1, Math.abs(p[j]));
        const saved = p[j];
        p[j] = saved + h;
        f(p, r2);
        p[j] = saved;
        for (let i = 0; i < m; i++) J[i * n + j] = (r2[i] - r[i]) / h;
      }
      // normal equations
      for (let a = 0; a < n; a++) {
        g[a] = 0;
        for (let b = 0; b < n; b++) A[a * n + b] = 0;
      }
      for (let i = 0; i < m; i++) {
        for (let a = 0; a < n; a++) {
          if (!opt.active[a]) continue;
          const ja = J[i * n + a];
          if (ja === 0) continue;
          g[a] += ja * r[i];
          for (let b = 0; b < n; b++) if (opt.active[b]) A[a * n + b] += ja * J[i * n + b];
        }
      }

      let improved = false;
      for (let attempt = 0; attempt < 6; attempt++) {
        for (let a = 0; a < n; a++) {
          for (let b = 0; b < n; b++) this.A2[a * n + b] = A[a * n + b];
          this.A2[a * n + a] += this.lambda * (A[a * n + a] + 1e-6) + 1e-9;
          if (!opt.active[a]) {
            for (let b = 0; b < n; b++) this.A2[a * n + b] = this.A2[b * n + a] = 0;
            this.A2[a * n + a] = 1;
          }
          delta[a] = opt.active[a] ? -g[a] : 0;
        }
        solveLinear(this.A2, delta, n);
        for (let a = 0; a < n; a++) {
          trial[a] = opt.active[a] ? Math.min(opt.upper[a], Math.max(opt.lower[a], p[a] + delta[a])) : p[a];
        }
        const m2 = f(trial, r2);
        const c2 = sumSq(r2, m2);
        if (c2 < cost) {
          p.set(trial);
          r.set(r2.subarray(0, m2));
          m = m2;
          cost = c2;
          this.lambda = Math.max(1e-6, this.lambda / 3);
          improved = true;
          break;
        }
        this.lambda = Math.min(1e6, this.lambda * 4);
      }
      if (!improved) break;
    }
    return cost;
  }

  private A2 = new Float64Array(64 * 64);
}

function sumSq(r: Float64Array, m: number): number {
  let s = 0;
  for (let i = 0; i < m; i++) s += r[i] * r[i];
  return s;
}

/** Gaussian elimination with partial pivoting; solves A x = b in place (b ← x). */
function solveLinear(A: Float64Array, b: Float64Array, n: number) {
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r * n + c]) > Math.abs(A[piv * n + c])) piv = r;
    if (piv !== c) {
      for (let k = 0; k < n; k++) {
        const t = A[c * n + k];
        A[c * n + k] = A[piv * n + k];
        A[piv * n + k] = t;
      }
      const t = b[c];
      b[c] = b[piv];
      b[piv] = t;
    }
    const d = A[c * n + c];
    if (Math.abs(d) < 1e-12) continue;
    for (let r = c + 1; r < n; r++) {
      const f = A[r * n + c] / d;
      if (f === 0) continue;
      for (let k = c; k < n; k++) A[r * n + k] -= f * A[c * n + k];
      b[r] -= f * b[c];
    }
  }
  for (let c = n - 1; c >= 0; c--) {
    let s = b[c];
    for (let k = c + 1; k < n; k++) s -= A[c * n + k] * b[k];
    const d = A[c * n + c];
    b[c] = Math.abs(d) < 1e-12 ? 0 : s / d;
  }
}
