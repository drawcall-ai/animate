import { Vector3 } from 'three'

export type Xyz = { x: number; y: number; z: number }

/** A story: its statements take effect at once, and every `yield` waits for the next step of time. */
export type Story<T = void> = Generator<void, T, void>

/** how far on in time something is looked at again to tell how it is moving (s) */
export const NUDGE = 1e-4
export const GRAVITY = 9.81
export const UP = new Vector3(0, 1, 0)
/** how far off counts as none, for what numbers round to (m) */
export const EXACT = 1e-6

/** how far out a moment may be for what numbers round to, told as a sum of steps of time (s) */
const ROUNDS = 1e-9
/** whether a moment has come by now: and how many steps of time on one so many seconds on has, the first at or after it */
export const due = (now: number, moment: number) => now >= moment - ROUNDS
export const steps = (seconds: number, tick: number) => Math.ceil((seconds - ROUNDS) / tick)

/** a story that waits while what it waits for is `still` on until it is `done`: and tells whether it was */
export function* waits(still: () => boolean, done: () => boolean): Story<boolean> {
  while (still() && !done()) yield
  return done()
}

/** a share of a way gone evenly, as a way that begins and ends at rest has it */
export const ease = (share: number) => share * share * (3 - 2 * share)
/** an angle read as the turn nearest none (rad) */
export const wrap = (angle: number) => angle - 2 * Math.PI * Math.round(angle / (2 * Math.PI))
export const clamp = (value: number, least: number, most: number) => Math.min(most, Math.max(least, value))
/**
 * a velocity a step of time on, pulled toward where it is `off` from like a weight on a spring that comes round `pull`
 * rad a second, without overshooting: stepped so that it holds for any step of time
 */
export const damped = (velocity: number, off: number, pull: number, dt: number) =>
  (velocity + pull * pull * off * dt) / (1 + pull * dt) ** 2
