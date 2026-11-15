import type { Start } from '../play'
import { model } from '../play'
import { rig } from './skeleton'
import { Worker } from './worker'

/** the storeroom: the shelf unit ahead of him, and the boxes on the floor around him */
export const start: Start = async (scene, world) => new Worker(await model(rig()), world, scene)
