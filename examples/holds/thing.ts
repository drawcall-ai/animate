import type { Grip, Hand } from '@drawcall/hand'
import { type BufferGeometry, Mesh, MeshStandardMaterial, type Object3D } from 'three'

/** something to hold: its meshes, and the statement of how the right hand grips it (the target hangs from the hand bone) */
export type Thing = {
  name: string
  make(): Object3D
  grip(hand: Hand, target: Object3D): Grip
}

export const solid = (geometry: BufferGeometry, color: number) =>
  new Mesh(geometry, new MeshStandardMaterial({ color }))
