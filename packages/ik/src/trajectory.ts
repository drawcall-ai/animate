// Small trajectory helpers for planners. Goals carry no time; these turn a plan into this frame's values.

import { Vector3 } from "three"
import type { Pose } from "./goals"

/** A smooth bump: 1 at x = 0, falling to 0 at |x| = 1 and beyond. */
export const bump = (x: number) => (Math.abs(x) < 1 ? Math.cos((Math.PI * x) / 2) ** 2 : 0)

/** A looping curve through timed values: smooth (cubic Hermite, Catmull-Rom tangents, at rest at both ends), repeating with the period from the first time to the last. */
export function loopingCurve(times: number[], values: number[][]): (t: number) => number[] {
  const n = times.length,
    period = times[n - 1] - times[0]
  const slope = (i: number) => values[i].map((_, c) => (i === 0 || i === n - 1 ? 0 : (values[i + 1][c] - values[i - 1][c]) / (times[i + 1] - times[i - 1])))
  return (t) => {
    const x = times[0] + ((((t - times[0]) % period) + period) % period)
    let i = 0
    while (i < n - 2 && x > times[i + 1]) i++
    const h = times[i + 1] - times[i],
      u = (x - times[i]) / h,
      a = slope(i),
      b = slope(i + 1),
      u2 = u * u,
      u3 = u2 * u
    return values[i].map((v, c) => (2 * u3 - 3 * u2 + 1) * v + (u3 - 2 * u2 + u) * h * a[c] + (-2 * u3 + 3 * u2) * values[i + 1][c] + (u3 - u2) * h * b[c])
  }
}

/**
 * A curve from the CURRENT state to a future one: from position p0 moving at v0 now, to position p1 moving at v1
 * after `time` seconds (cubic Hermite; m, m/s, s). The curve gives position and velocity s seconds from now, and goes
 * on at v1 after `time`; replanning every frame from the state then reached keeps the motion continuous in position
 * and velocity.
 */
export function curveTo(p0: Vector3, v0: Vector3, p1: Vector3, v1: Vector3, time: number): (s: number) => { position: Vector3; velocity: Vector3 } {
  return (s) => {
    if (time <= 1e-6 || s >= time) return { position: p1.clone().addScaledVector(v1, Math.max(0, s - time)), velocity: v1.clone() }
    const u = Math.max(0, s) / time,
      u2 = u * u,
      u3 = u2 * u
    const position = p0
      .clone()
      .multiplyScalar(2 * u3 - 3 * u2 + 1)
      .addScaledVector(v0, (u3 - 2 * u2 + u) * time)
      .addScaledVector(p1, -2 * u3 + 3 * u2)
      .addScaledVector(v1, (u3 - u2) * time)
    const velocity = p0
      .clone()
      .multiplyScalar((6 * u2 - 6 * u) / time)
      .addScaledVector(v0, 3 * u2 - 4 * u + 1)
      .addScaledVector(p1, (-6 * u2 + 6 * u) / time)
      .addScaledVector(v1, 3 * u2 - 2 * u)
    return { position, velocity }
  }
}

/** A pose a share u of the way from pose a to pose b (bones only one of them lists are kept as listed). */
export function mix(a: Pose, b: Pose, u: number): Pose {
  const out: Pose = { ...a, ...b }
  for (const name in a) if (b[name]) out[name] = a[name].map((v, i) => v + (b[name][i] - v) * u)
  return out
}
