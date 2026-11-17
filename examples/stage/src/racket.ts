// The tennis racket, and how the tennis player's hands take hold of it.

import { type GripOptions, mark, type Side } from "@drawcall/animate"
import { CircleGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, TorusGeometry, Vector3 } from "three"
import { PROP } from "."

/** from the hand, at the racket's origin, to the sweet spot (m) */
export const REACH = 0.5

/** How the hands take hold of the handle, in the racket's frame: the right hand at its origin, the palm on the face
 * behind the palm-side strings, an eastern grip, the thumb toward the head but turned 0.2 rad across the handle, which
 * keeps the wrist off its limit in a serve's follow-through; turned much further, the handle lies along the index, which
 * can then no longer close round it. The left, in a two-handed backhand, holds above it, its palm on the other face, its
 * little finger just clear of the right index, which that tilt runs a little up the handle. */
export const GRIPS: Record<Side, GripOptions> = {
  right: { at: new Vector3(), approachFrom: new Vector3(0, 0, -1), thumbToward: new Vector3(Math.sin(0.1), Math.cos(0.1), 0) },
  left: { at: new Vector3(0, 0.12, 0), approachFrom: new Vector3(0, 0, 1), thumbToward: new Vector3(0, 1, 0) },
}

const strings = new MeshStandardMaterial({ color: 0xe8e2c8, transparent: true, opacity: 0.35 })

/** The racket: the handle at its origin, eight-sided and long enough for two hands, the head along +y, the palm-side
 * strings facing +z; and its sweet spot. */
export function createRacket() {
  const racket = new Group()
  racket.name = "racket"
  racket.userData.mass = 0.3
  const handle = new Mesh(new CylinderGeometry(0.0165, 0.0165, 0.3, 8), PROP).translateY(0.06)
  const throat = new Mesh(new CylinderGeometry(0.011, 0.011, 0.17, 12), PROP).translateY(0.295)
  const head = [new Mesh(new TorusGeometry(0.12, 0.008, 8, 48), PROP), new Mesh(new CircleGeometry(0.115, 48), strings)]
  for (const part of head) part.translateY(0.52).scale.set(1, 1.25, 1)
  racket.add(handle, throat, ...head)
  return { racket, sweet: mark(racket, "sweet", new Vector3(0, REACH, 0)) }
}
