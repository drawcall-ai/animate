/** the error a solve singular at its pose (a leg pulled straight) throws */
export const SINGULAR = 'leg solve lost positive definiteness';
/** H d = −g over the free coordinates, the fixed ones stepped onto the bound they passed (1: the lower, 2: the upper) */
export function solveFree(H: Float64Array, g: Float64Array, fixed: Uint8Array, d: Float64Array, n: number, q: Float64Array, lb: Float64Array, ub: Float64Array) {
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

const _A = new Float64Array(16 * 16);
const _b = new Float64Array(16);
