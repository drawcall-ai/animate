import { CROUCH, SPOT, WALK, lowest } from './gait'
import type { Mover } from './mover'

/**
 * How high the hips are held, as near as he can to how high they are asked (m): from as low as he gets to as high as he
 * stands; going `far` along, further than he shifts his weight where he stands, no lower than a crouch, and so fast
 * that he runs, as high as he stands; and over feet the story has put down, no higher than his legs reach them at `z`.
 */
export function held(mover: Mover, y: number, { speed = 0, far = 0, z = mover.value.z } = {}) {
  const { stand, leg, pace } = mover.size
  const along = far > SPOT * leg || speed > 0 ? CROUCH * stand : lowest(mover.size)
  const least = speed > WALK.most * pace ? stand : along
  const most = mover.placed ? Math.min(stand, mover.ceiling(z)) : stand
  return Math.min(most, Math.max(least, y))
}
