import type { Side, Size as Legs } from '@drawcall/gait'

export const both = <T>(make: (side: Side) => T): Record<Side, T> => ({ left: make('left'), right: make('right') })

/**
 * the sizes of a body (m), as its rig has them at rest: the gait's measures of the legs, and of the trunk and the
 * arms: how far above the hips the shoulders are, how far out from the middle of the trunk a shoulder is, and how long
 * an upper arm, a forearm and an arm, from shoulder to wrist, are
 */
export type Size = Legs & Readonly<{ trunk: number; shoulder: number; upperArm: number; forearm: number; arm: number }>
/** the step his time goes by, and what his moments are counted in (s): so many to a beat, short enough for the fastest of what he does */
export const TICKS = 60
export const tick = ({ beat }: Size) => beat / TICKS
/** how far off counts as none, for what numbers round to (m) */
export const EXACT = 1e-6
