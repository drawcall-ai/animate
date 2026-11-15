import type { Start } from '../play'
import { model } from '../play'
import { rig } from './skeleton'
import { Thrower } from './thrower'

/** the field, and the thrower at the start of its runway facing down it, the rack of javelins on his right */
export const start: Start = async (scene) => new Thrower(await model(rig()), scene)
