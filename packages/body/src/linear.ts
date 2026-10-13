/**
 * Factors a symmetric positive definite `A` (n × n, row-major) in place into its Cholesky
 * factor (lower triangle); throws when `A` is not positive definite.
 */
export function factor(A: Float64Array, n: number): Float64Array {
  for (let j = 0; j < n; j++) {
    let d = A[j * n + j];
    for (let k = 0; k < j; k++) d -= A[j * n + k] * A[j * n + k];
    if (!(d > 0)) throw new Error(`matrix is not positive definite (pivot ${j}: ${d})`);
    const l = Math.sqrt(d);
    A[j * n + j] = l;
    for (let i = j + 1; i < n; i++) {
      let s = A[i * n + j];
      for (let k = 0; k < j; k++) s -= A[i * n + k] * A[j * n + k];
      A[i * n + j] = s / l;
    }
  }
  return A;
}

/**
 * solves `L z = b` (`L` a factor from `factor`); overwrites `b` with `z`. `b` may be known to be
 * zero before `from` (a column of the identity), which spares that part.
 */
export function forward(L: Float64Array, b: Float64Array, n: number, from = 0): Float64Array {
  for (let i = from; i < n; i++) {
    let s = b[i];
    for (let k = from; k < i; k++) s -= L[i * n + k] * b[k];
    b[i] = s / L[i * n + i];
  }
  return b;
}

/** solves `Lᵀ x = z`; overwrites `z` with `x` */
export function backward(L: Float64Array, z: Float64Array, n: number): Float64Array {
  for (let i = n - 1; i >= 0; i--) {
    let s = z[i];
    for (let k = i + 1; k < n; k++) s -= L[k * n + i] * z[k];
    z[i] = s / L[i * n + i];
  }
  return z;
}

/** solves `A x = b` with `L`, `A`'s factor from `factor`; overwrites `b` with `x` */
export const substitute = (L: Float64Array, b: Float64Array, n: number): Float64Array => backward(L, forward(L, b, n), n);

/** solves `A x = b` for a symmetric positive definite `A`; overwrites `A` and `b` (with `x`) */
export const solve = (A: Float64Array, b: Float64Array, n: number): Float64Array => substitute(factor(A, n), b, n);
