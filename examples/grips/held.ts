import type { Grip, Hand } from '@drawcall/hand'
import { type Group, MeshStandardMaterial } from 'three'

/** a thing a hand holds: its name, its meshes in its own frame (metres), and how a hand grips it */
export type Held = { name: string; make(): Group; by(hand: Hand, thing: Group): Grip }

export const stuff = (color: number) => new MeshStandardMaterial({ color, roughness: 0.6 })
