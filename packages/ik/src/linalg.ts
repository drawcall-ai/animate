// Dense symmetric solves on flat row-major n*n Float64Arrays: the one piece of maths three.js does not have.

/** In-place Cholesky (lower triangle). Returns false if the matrix is not positive definite. */
export function cholesky(A: Float64Array, n: number): boolean {
  for (let j = 0; j < n; j++) {
    let d = A[j * n + j]
    for (let k = 0; k < j; k++) d -= A[j * n + k] * A[j * n + k]
    if (!(d > 0)) return false
    d = Math.sqrt(d)
    A[j * n + j] = d
    for (let i = j + 1; i < n; i++) {
      let s = A[i * n + j]
      for (let k = 0; k < j; k++) s -= A[i * n + k] * A[j * n + k]
      A[i * n + j] = s / d
    }
  }
  return true
}

/** Solve L L^T x = b in place, L from `cholesky`. */
export function cholSolve(L: Float64Array, n: number, b: Float64Array) {
  for (let i = 0; i < n; i++) {
    let s = b[i]
    for (let k = 0; k < i; k++) s -= L[i * n + k] * b[k]
    b[i] = s / L[i * n + i]
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i]
    for (let k = i + 1; k < n; k++) s -= L[k * n + i] * b[k]
    b[i] = s / L[i * n + i]
  }
}
