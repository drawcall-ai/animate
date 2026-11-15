import type { Statement } from '@drawcall/hand'
import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { FOIL } from './target'

/**
 * a foil along +z from the middle of its handle, which is where it is held, to its point: how long and thick its handle
 * is, how wide its bell guard, and how thick its blade (m); and how far the handle is canted up off the blade (rad), as
 * a foil's handle is, for the blade to run on along the forearm out of a closed hand
 */
const HILT = { long: 0.12, thick: 0.011, bell: 0.045, blade: 0.006, cant: 0.5 }

/** the palm on the handle's right side, the thumb along its top toward the bell */
export const GRIP: Statement = { at: new Vector3(-HILT.thick, 0, 0), from: new Vector3(-1, 0, 0) }

export function foil() {
  const rod = (radius: number, from: number, to: number, color = 0xd0d4d8) => {
    const geometry = new CylinderGeometry(radius, radius, to - from, 12).rotateX(Math.PI / 2)
    const made = new Mesh(geometry, new MeshStandardMaterial({ color }))
    made.position.z = (from + to) / 2
    return made
  }
  const { long, thick, bell, blade, cant } = HILT
  const handle = rod(thick, -long / 2, long / 2, 0x303030)
  handle.rotation.x = -cant
  return new Group().add(
    handle,
    rod(bell, long / 2, long / 2 + 0.01),
    rod(blade, long / 2, FOIL),
  )
}
