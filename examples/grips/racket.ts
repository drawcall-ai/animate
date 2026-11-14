import { grip } from '@drawcall/hand'
import { CatmullRomCurve3, CylinderGeometry, Group, Mesh, TubeGeometry, Vector3 } from 'three'
import { type Held, stuff } from './held'

/** a tennis racket: along +y from the butt of its handle at the origin, its face facing ±z (m) */
const RACKET = { grip: 0.18, handle: 0.0165, throat: 0.08, hoopWide: 0.13, hoopLong: 0.16, tube: 0.008 }

function make() {
  const racket = new Group()
  racket.name = 'racket'
  const handle = new Mesh(new CylinderGeometry(RACKET.handle, RACKET.handle, RACKET.grip, 8), stuff(0x202020))
  handle.rotation.y = Math.PI / 8 // a flat on each side, not an edge
  handle.position.y = RACKET.grip / 2
  racket.add(handle)
  const top = RACKET.grip + RACKET.throat
  const centre = top + RACKET.hoopLong - RACKET.tube
  const frame = stuff(0xd8d8d8)
  // the throat: two arms from the handle's end to the hoop's sides
  for (const side of [-1, 1]) {
    const from = new Vector3(0, RACKET.grip, 0)
    const to = new Vector3(side * RACKET.hoopWide * 0.55, centre - RACKET.hoopLong * 0.85, 0)
    const arm = new Mesh(new TubeGeometry(new CatmullRomCurve3([from, to]), 4, RACKET.tube, 8), frame)
    racket.add(arm)
  }
  const ring = Array.from({ length: 48 }, (_, i) => {
    const turn = (i / 48) * 2 * Math.PI
    return new Vector3(Math.cos(turn) * RACKET.hoopWide, centre + Math.sin(turn) * RACKET.hoopLong, 0)
  })
  racket.add(new Mesh(new TubeGeometry(new CatmullRomCurve3(ring, true), 96, RACKET.tube, 8, true), frame))
  return racket
}

/** an eastern forehand: the palm behind a flat of the handle, the fingers round it, the butt at the heel of the hand */
export const racket: Held = {
  name: 'tennis racket, forehand grip',
  make,
  by: (hand, racket) => grip(hand, racket, { at: new Vector3(0, 0.07, -RACKET.handle), from: new Vector3(0, 0, -1) }),
}
