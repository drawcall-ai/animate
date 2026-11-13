export type Side = 'left' | 'right'
export const SIDES: Side[] = ['left', 'right']
export const other = (side: Side): Side => (side === 'left' ? 'right' : 'left')
/** the sign of x on each side: his left is at +x */
export const SIGN = { left: 1, right: -1 }
/** something for either side */
export const both = <T>(make: (side: Side) => T): Record<Side, T> => ({ left: make('left'), right: make('right') })

/** the sizes of the body (m): it faces +z */
export const SIZE = {
  ankle: 0.07,
  shin: 0.44,
  thigh: 0.44,
  hip: 0.09,
  trunk: 0.5,
  shoulder: 0.2,
  upperArm: 0.29,
  forearm: 0.32,
  head: 0.1,
}
/** how long a leg is, from hip to ankle (m) */
export const LEG = SIZE.thigh + SIZE.shin
/** how high the hips are, standing with straight legs */
export const STAND = SIZE.ankle + SIZE.shin + SIZE.thigh
/** how far behind and ahead of its ankle a foot stands on the ground, and how far ahead its ball is, which it turns on when the heel comes up (m) */
export const SOLE = { behind: 0.06, ahead: 0.18, ball: 0.16 }
/** how far the heel comes up off the ground (rad) */
export const HEEL = 0.9
/** how far up and how far on the ankle is with the heel up by an angle, against the foot flat (m) */
export const raised = (angle: number) => ({
  y: SOLE.ball * Math.sin(angle) + SIZE.ankle * (Math.cos(angle) - 1),
  z: SOLE.ball * (1 - Math.cos(angle)) + SIZE.ankle * Math.sin(angle),
})
