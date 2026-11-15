import type { Start } from '../play'
import { model } from '../play'
import { Fencer } from './fencer'
import { rig } from './skeleton'

/** the piste, and the fencer on it en garde, the target dummy standing ahead of him out of distance */
export const start: Start = async (scene, world) => new Fencer(await model(rig()), world, scene)
