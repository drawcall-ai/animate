import { Vector3 } from 'three'

export type Side = 'left' | 'right'
export const SIDES: Side[] = ['left', 'right']
export const other = (side: Side): Side => (side === 'left' ? 'right' : 'left')
/** the sign of x on each side: his left is at +x */
export const SIGN = { left: 1, right: -1 }
export const both = <T>(make: (side: Side) => T): Record<Side, T> => ({ left: make('left'), right: make('right') })

/** the sizes of a body (m), as its rig has them at rest, and what its times and speeds are counted in */
export type Size = Readonly<{
  /** how high an ankle is above the ground its foot stands on */
  ankle: number
  shin: number
  thigh: number
  /** how far out from the middle of the hips a hip is */
  hip: number
  /** how far above the hips the shoulders are, and how far out from the middle of the trunk a shoulder is */
  trunk: number
  shoulder: number
  upperArm: number
  forearm: number
  /** how long a leg is, from hip to ankle, and an arm, from shoulder to wrist */
  leg: number
  arm: number
  /** how high the hips are, standing with straight legs */
  stand: number
  /**
   * a beat: how long his leg, hanging, takes over a radian of its swing, which is 2π there and back (s); and a pace:
   * how fast it goes its length in that (m/s). A larger body takes longer over what it does, and goes faster
   */
  beat: number
  pace: number
}>
/** the step his time goes by, and what his moments are counted in (s): so many to a beat, short enough for the fastest of what he does */
export const TICKS = 60
export const tick = ({ beat }: Size) => beat / TICKS
/** where a foot stands on the ground under its hip, so far along z */
export const ground = ({ hip, ankle }: Size, side: Side, z: number) => new Vector3(SIGN[side] * hip, ankle, z)
/** how far behind its ankle a foot stands on the ground, and how far ahead its ball is, which it turns on when the heel comes up (in lengths of his leg) */
export const SOLE = { behind: 0.068, ball: 0.182 }
/** how far the heel comes up off the ground (rad) */
export const HEEL = 0.9
/** how far up and how far on the ankle is with the heel up by an angle, against the foot flat (m) */
export const raised = ({ ankle, leg }: Size, angle: number) => ({
  y: SOLE.ball * leg * Math.sin(angle) + ankle * (Math.cos(angle) - 1),
  z: SOLE.ball * leg * (1 - Math.cos(angle)) + ankle * Math.sin(angle),
})
