import type { Statement } from '@drawcall/hand'
import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { FOIL } from './target'

/** a foil along +z from the middle of its handle, which is where it is held, to its point: how long and thick its handle is, how wide its bell guard, and how thick its blade (m) */
const HILT = { long: 0.12, thick: 0.011, bell: 0.045, blade: 0.006 }

/** the palm on the handle's right side, the thumb along its top toward the bell */
export const GRIP: Statement = { at: new Vector3(-HILT.thick, 0, 0), from: new Vector3(-1, 0, 0) }

export function foil() {
  const rod = (radius: number, from: number, to: number, color = 0xd0d4d8) => {
    const geometry = new CylinderGeometry(radius, radius, to - from, 12).rotateX(Math.PI / 2)
    const made = new Mesh(geometry, new MeshStandardMaterial({ color }))
    made.position.z = (from + to) / 2
    return made
  }
  const { long, thick, bell, blade } = HILT
  return new Group().add(
    rod(thick, -long / 2, long / 2, 0x303030),
    rod(bell, long / 2, long / 2 + 0.01),
    rod(blade, long / 2, FOIL),
  )
}
