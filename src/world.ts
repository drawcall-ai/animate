export type Xyz = { x: number; y: number; z: number }

/** A story: its statements take effect at once, and every `yield` waits for the next step of time. */
export type Story<T = void> = Generator<void, T, void>

/** the step time goes by (s): short enough for the fastest of what a body does, and what its moments are counted in */
export const TICK = 1 / 200
/** how far on in time something is looked at again to tell how it is moving (s) */
export const NUDGE = 1e-4
export const GRAVITY = 9.81

/** whether a moment has come by now: a moment is told as a sum of steps of time, and may be out by what numbers round to */
export const due = (now: number, moment: number) => now >= moment - 1e-9

/** a share of a way gone evenly, as a way that begins and ends at rest has it */
export const ease = (share: number) => share * share * (3 - 2 * share)
export const clamp = (value: number, least: number, most: number) => Math.min(most, Math.max(least, value))
