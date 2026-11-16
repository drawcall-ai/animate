/** A story: its statements take effect at once, and every `yield` waits for the next step of time. */
export type Story<T = void> = Generator<void, T, void>

/** how far out a moment may be for what numbers round to, told as a sum of steps of time (s) */
const ROUNDS = 1e-9
/** whether a moment has come by now */
export const due = (now: number, moment: number) => now >= moment - ROUNDS

/** a story that waits while what it waits for is `still` on until it is `done`: and tells whether it was */
export function* waits(still: () => boolean, done: () => boolean): Story<boolean> {
  while (still() && !done()) yield
  return done()
}
