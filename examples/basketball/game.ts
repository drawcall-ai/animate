import type { Start } from '../play'
import { model } from '../play'
import { court } from './court'
import { Hooper } from './hooper'
import { rig } from './skeleton'

/** the court, and the player on it with the ball on the floor ahead of him */
export const start: Start = async (scene) => {
  scene.add(court())
  return new Hooper(await model(rig()), scene)
}
