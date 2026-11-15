import type { Start } from '../play'
import { model } from '../play'
import { field } from './field'
import { Footballer } from './footballer'
import { rig } from './skeleton'

/** the pitch with its goal ahead of him, and the ball on the grass in front of him */
export const start: Start = async (scene) => {
  scene.add(field())
  return Footballer.start(await model(rig()), scene)
}
