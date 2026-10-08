import type { Bounds } from './lm';

/**
 * A warm-started solve needs no rerun while its last run settled (moved the parameters by
 * at most this) and its residuals where that run ended, and the bounds it ran within, are
 * still what they were (to within this): a body holding still over still targets keeps its
 * solution.
 */
const SETTLED = 1e-4;

/**
 * Whether a warm-started solve must run again. It compares the cost's own residuals at the
 * solution the last run left — the numbers the solve starts from anyway — so it depends on
 * exactly what the cost reads: any input that changes the cost there changes them. The
 * bounds count too: one that opened up leaves the residuals of a solution pinned at it as
 * they were.
 */
export class SolveMemo {
  /** the residuals where the last run ended (−1 rows: none yet) */
  private residuals = new Float64Array(0);
  private rows = -1;
  /** the bounds and free parameters of the last run */
  private lower = new Float64Array(0);
  private upper = new Float64Array(0);
  private active = new Uint8Array(0);
  /** how far the last run moved the parameters */
  private moved = Infinity;
  /** the last solve returned at once: its solution held */
  reused = false;
  /** where the running solve started */
  private start = new Float64Array(0);

  /** whether a solve starting at `p` within `bounds`, with the `m` residuals `r`, would find what the last one settled on; if not it runs, from `p` */
  unchanged(p: Float64Array, r: Float64Array, m: number, bounds: Bounds): boolean {
    let same = m === this.rows && this.moved <= SETTLED;
    for (let i = 0; same && i < m; i++) same = Math.abs(r[i] - this.residuals[i]) <= SETTLED;
    for (let i = 0; same && i < p.length; i++) {
      same = bounds.active[i] === this.active[i] && Math.abs(bounds.lower[i] - this.lower[i]) <= SETTLED && Math.abs(bounds.upper[i] - this.upper[i]) <= SETTLED;
    }
    this.reused = same;
    if (same) return true;
    if (this.start.length !== p.length) {
      this.start = new Float64Array(p.length);
      this.lower = new Float64Array(p.length);
      this.upper = new Float64Array(p.length);
      this.active = new Uint8Array(p.length);
    }
    this.start.set(p);
    this.lower.set(bounds.lower);
    this.upper.set(bounds.upper);
    this.active.set(bounds.active);
    return false;
  }

  /** the run ended at `p` with the `m` residuals `r` */
  settle(p: Float64Array, r: Float64Array, m: number) {
    let moved = 0;
    for (let i = 0; i < p.length; i++) moved = Math.max(moved, Math.abs(p[i] - this.start[i]));
    this.moved = moved;
    if (this.residuals.length < m) this.residuals = new Float64Array(m);
    for (let i = 0; i < m; i++) this.residuals[i] = r[i];
    this.rows = m;
  }

  /** the solution was changed from outside: the next solve runs */
  forget() {
    this.rows = -1;
  }
}
