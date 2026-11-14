import { fist, grip } from '@drawcall/hand'
import { CylinderGeometry, Group, Mesh, TorusGeometry, Vector3 } from 'three'
import { type Held, stuff } from './held'

/** a mug standing on y = -high/2, its handle out toward +x (m) */
const MUG = { radius: 0.04, high: 0.095, loop: 0.03, wire: 0.007 }

function make() {
  const mug = new Group()
  mug.name = 'mug'
  mug.add(new Mesh(new CylinderGeometry(MUG.radius, MUG.radius, MUG.high, 32), stuff(0xf0f0f0)))
  const handle = new Mesh(new TorusGeometry(MUG.loop, MUG.wire, 12, 24, Math.PI), stuff(0xf0f0f0))
  handle.rotation.z = -Math.PI / 2 // the half ring bulges out, its ends in the wall
  handle.position.x = MUG.radius - MUG.wire / 2
  return mug.add(handle)
}

/** the handle pinched from outside between the thumb and the first two fingers, the others curled out of the way */
export const mug: Held = {
  name: 'coffee mug, by the handle',
  make,
  by: (hand, mug) =>
    grip(hand, mug, {
      at: new Vector3(MUG.radius - MUG.wire / 2 + MUG.loop, 0, 0),
      from: new Vector3(1, 0, 0),
      using: ['thumb', 'index', 'middle'],
      start: fist,
    }),
}
