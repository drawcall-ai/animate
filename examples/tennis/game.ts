import type { Start } from '../play'
import { model } from '../play'
import { court } from './court'
import { Player } from './player'
import { rig } from './skeleton'

/** the court with the ball machine at the far end, and the player on his half facing the net */
export const start: Start = async (scene, world) => {
  scene.add(court())
  return new Player(await model(rig()), world, scene)
}
