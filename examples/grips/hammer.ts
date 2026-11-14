import { grip } from '@drawcall/hand'
import { BoxGeometry, CylinderGeometry, Group, Mesh, Vector3 } from 'three'
import { type Held, stuff } from './held'

/** a hammer: its shaft along +y from the butt at the origin, its head across it along z (m) */
const HAMMER = { shaft: 0.3, thick: 0.014, head: 0.14, headHigh: 0.03 }

function make() {
  const hammer = new Group()
  hammer.name = 'hammer'
  const shaft = new Mesh(new CylinderGeometry(HAMMER.thick, HAMMER.thick, HAMMER.shaft, 16), stuff(0xb08050))
  shaft.scale.z = 1.3 // oval, longer along the head
  shaft.position.y = HAMMER.shaft / 2
  const head = new Mesh(new BoxGeometry(0.03, HAMMER.headHigh, HAMMER.head), stuff(0x707880))
  head.position.y = HAMMER.shaft + HAMMER.headHigh / 2 - 0.01
  return hammer.add(shaft, head)
}

/** a power grip near the butt, the palm to the side of the shaft, the head away from the hand */
export const hammer: Held = {
  name: 'hammer, by the shaft',
  make,
  by: (hand, hammer) => grip(hand, hammer, { at: new Vector3(-HAMMER.thick, 0.07, 0), from: new Vector3(-1, 0, 0) }),
}
