import type { Start } from '../play'
import { model } from '../play'
import { court } from './court'
import { rig } from './skeleton'
import { Spiker } from './spiker'

/** the court with its net, and the player on his half of it, facing the net, the setter tossing him the ball */
export const start: Start = async (scene, world) => {
  scene.add(court())
  return new Spiker(await model(rig()), world, scene)
}
