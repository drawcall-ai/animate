/** A value following its aim as a critically damped spring of stiffness `k` (1/s; higher, snappier). */
export class Spring {
  value = 0
  #velocity = 0

  constructor(public k: number) {}

  /** The value `dt` (s) on toward `aim`, by the exact solution: an explicit step overshoots and blows up once k·dt passes 1, this is stable at any step. */
  step(aim: number, dt: number): number {
    const y = this.value - aim,
      j = this.#velocity + this.k * y,
      e = Math.exp(-this.k * dt)
    this.value = aim + (y + j * dt) * e
    this.#velocity = (this.#velocity - this.k * j * dt) * e
    return this.value
  }
}

/** The spring by `name` in `springs`, made with stiffness `k` the first time it is asked for. */
export function springOf<K>(springs: Map<K, Spring>, name: K, k: number): Spring {
  let spring = springs.get(name)
  if (!spring) springs.set(name, (spring = new Spring(k)))
  return spring
}
