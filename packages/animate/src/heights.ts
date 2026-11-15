import { CROUCH, HIGH, SPOT, STILL, WALK, lowest } from './gait'
import type { Mover } from './mover'
import type { Size } from './size'

/** How high the hips may be held: each rule a check that throws what it says when it is broken, and changes nothing. */

/** the hips go only from as low as he gets to as high as he stands */
export function within(size: Size, y: number) {
  const [low, stand] = [lowest(size), size.stand]
  if (y >= low - 1e-9 && y <= stand + 1e-9) return
  throw new Error(`the hips are sent ${y.toFixed(2)} m up, and go only from ${low.toFixed(2)} to ${stand.toFixed(2)}`)
}

/** going along, further than he shifts his weight where he stands, the hips go no lower than a crouch */
export function walks({ stand, leg }: Size, y: number, far: number) {
  const [crouch, spot] = [CROUCH * stand, SPOT * leg]
  if (!(y < crouch && far > spot)) return
  throw new Error(
    `the hips are sent ${far.toFixed(2)} m along at ${y.toFixed(2)} m up, and he walks with them no lower than ${crouch.toFixed(2)} m: walk there, then squat`,
  )
}

/** over feet the story has put down the hips go no higher than his legs reach them */
export function reaches(mover: Mover, y: number, z: number) {
  const high = mover.ceiling(z)
  if (!mover.placed || y - high <= HIGH * mover.size.leg) return
  throw new Error(
    `the hips are sent ${y.toFixed(2)} m up, and there his legs reach the feet where they were put from no higher than ${high.toFixed(2)} m: send the hips lower, or let the feet free`,
  )
}

/** how low the hips may be held going so fast: going along, no lower than a crouch, and at a run as high as he stands (m) */
export const least = ({ stand, pace }: Size, speed: number) => (speed > WALK.most * pace ? stand : CROUCH * stand)

/** what is wrong with going so fast with the hips held so high, if anything is */
export function carried(size: Size, speed: number, height: number) {
  const { stand, pace } = size
  const [crouch, runs] = [CROUCH * stand, speed > WALK.most * pace]
  if (speed < STILL * pace || height >= least(size, speed) - 1e-9) return undefined
  const walks = `walks with them no lower than ${crouch.toFixed(2)} m`
  return `he is to go ${speed.toFixed(2)} m/s with his hips held ${height.toFixed(2)} m up, and ${runs ? 'runs only standing' : walks}: hold them higher first, hips.to({ y })`
}

/** he can go so fast with the hips held so high, or that is an error */
export function carries(size: Size, speed: number, height: number) {
  const wrong = carried(size, speed, height)
  if (wrong) throw new Error(wrong)
}
