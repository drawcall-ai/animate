import type { Start } from '../play'
import { model } from '../play'
import { Boxer } from './boxer'
import { rig } from './skeleton'

/** the gym, and the boxer in it with the heavy bag hanging ahead of him */
export const start: Start = async (scene, world) => new Boxer(await model(rig()), world, scene)
