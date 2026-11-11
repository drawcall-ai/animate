import { type Mass, between, pointing, turning } from './physics'
import { clamp, deg, lerp, rad, smooth, wrap } from './vec'

/**
 * The torque that takes the segment joint→tip to an angle, as a spring with a damper. Damped against `base`, the segment it
 * hangs on; without one against the world, for an aim that is a direction in the world while what it hangs on is itself turning.
 */
export function toward(joint: Mass, tip: Mass, angle: number, stiff: number, damp: number, base?: [Mass, Mass]) {
  return stiff * wrap(angle - pointing(joint, tip)) - damp * (turning(joint, tip) - (base ? turning(...base) : 0))
}

export type Strength = { stiff: number; damp: number; most?: number; steady?: boolean }

/**
 * Aims the segment joint→tip at an angle, against the segment root→joint, like a muscle and never harder than `most` (N m).
 * With a great `most` it is all but exact; with a small one the segment goes mostly as its own weight and speed take it.
 * `steady` damps against the world.
 */
export function aim(root: Mass, joint: Mass, tip: Mass, angle: number, { stiff, damp, most = Infinity, steady = false }: Strength) {
  const torque = toward(joint, tip, angle, stiff, damp, steady ? undefined : [root, joint])
  between(root, joint, tip, clamp(torque, -most, most))
}

/** how far joint→tip is folded back from root→joint (degrees) */
export const folded = (root: Mass, joint: Mass, tip: Mass) => deg(wrap(pointing(root, joint) - pointing(joint, tip)))

/** A joint that bends only so far: how far joint→tip is folded back from root→joint (degrees) is kept within `from`…`to`, and returned. */
export function hinge(root: Mass, joint: Mass, tip: Mass, from: number, to: number, { stiff = 4000, damp = 40 } = {}) {
  const fold = folded(root, joint, tip)
  const past = fold < from ? fold - from : fold > to ? fold - to : 0
  if (past) between(root, joint, tip, stiff * rad(past) - damp * (turning(joint, tip) - turning(root, joint)))
  return fold
}

/** A value on its way to where it was last sent: what a driver aims at, not where the body is. */
export type Goal = { from: number; to: number; value: number; t: number; seconds: number }
export const goal = (value: number): Goal => ({ from: value, to: value, value, t: 1, seconds: 0 })

export function send(g: Goal, to: number, seconds = 0.3) {
  g.from = g.value
  g.to = to
  g.t = 0
  g.seconds = seconds
}

export function ease(g: Goal, dt: number) {
  g.t = g.seconds > 0 ? Math.min(1, g.t + dt / g.seconds) : 1
  g.value = lerp(g.from, g.to, smooth(g.t))
}
