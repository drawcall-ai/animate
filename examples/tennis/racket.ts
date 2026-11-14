import type { Statement } from '@drawcall/hand'
import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, TorusGeometry, Vector3 } from 'three'

/**
 * a racket, along +z from the butt of its handle, its face square to y (m): how long and thick its handle is, how wide
 * and long its head, how far its strings' middle is from the butt, and how much of the closing speed they give back
 */
export const RACKET = { handle: 0.18, thick: 0.0165, wide: 0.13, long: 0.16, strings: 0.5, spring: 0.4 }

/** an eastern forehand: the palm behind a flat of the handle, as the face faces, 7 cm up from the butt */
export const FOREHAND: Statement = { at: new Vector3(0, RACKET.thick, 0.07), from: new Vector3(0, 1, 0) }

export function racket() {
  const handle = new Mesh(
    // (a flat on each side, not an edge, and along z)
    new CylinderGeometry(RACKET.thick, RACKET.thick, RACKET.handle, 8).rotateY(Math.PI / 8).rotateX(Math.PI / 2),
    new MeshStandardMaterial({ color: 0x303030 }),
  )
  handle.position.z = RACKET.handle / 2
  const head = new Mesh(new TorusGeometry(RACKET.wide, 0.008, 8, 48), new MeshStandardMaterial({ color: 0xe0e0e0 }))
  head.rotation.x = Math.PI / 2
  head.scale.y = RACKET.long / RACKET.wide
  head.position.z = RACKET.strings
  const throat = new Mesh(
    new CylinderGeometry(0.008, 0.008, RACKET.strings - RACKET.long - RACKET.handle).rotateX(Math.PI / 2),
    head.material,
  )
  throat.position.z = (RACKET.strings - RACKET.long + RACKET.handle) / 2
  return new Group().add(handle, throat, head)
}
