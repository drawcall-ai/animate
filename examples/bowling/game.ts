import type { Start } from '../play'
import { model } from '../play'
import { alley } from './alley'
import { Bowler } from './bowler'
import { rig } from './skeleton'

/** the alley, and the bowler on its approach facing down the lane, the ball return to his left */
export const start: Start = async (scene) => {
  scene.add(alley())
  return new Bowler(await model(rig()), scene)
}
