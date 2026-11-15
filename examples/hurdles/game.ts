import type { Start } from '../play'
import { model } from '../play'
import { Hurdler } from './hurdler'
import { rig } from './skeleton'
import { ground, stand, track } from './track'

/** how many hurdles stand in the lane */
const COUNT = 10

/** the track, a lane of hurdles down it along +z, and the hurdler at its start facing them */
export const start: Start = async (scene) => {
  const hurdles = track(COUNT).map((hurdle) => ({ hurdle, solid: stand(hurdle) }))
  scene.add(ground(hurdles.map(({ hurdle }) => hurdle)), ...hurdles.map(({ solid }) => solid))
  const body = await model(rig())
  scene.add(body)
  return new Hurdler(body, hurdles)
}
