import { grip } from '@drawcall/hand'
import { BoxGeometry, CylinderGeometry, Group, Mesh, Vector3 } from 'three'
import { type Held, stuff } from './held'

/** a door lever: its plate on z = 0 against the door, the stem out along +z, the bar along +x at the stem's end (m) */
const LEVER = { plate: 0.03, stem: 0.04, bar: 0.14, tall: 0.02, deep: 0.015 }

function make() {
  const lever = new Group()
  lever.name = 'lever'
  const metal = stuff(0xa0a8b0)
  const plate = new Mesh(new CylinderGeometry(LEVER.plate, LEVER.plate, 0.008, 32), metal)
  plate.rotation.x = Math.PI / 2
  plate.position.z = 0.004
  const stem = new Mesh(new CylinderGeometry(0.01, 0.01, LEVER.stem, 16), metal)
  stem.rotation.x = Math.PI / 2
  stem.position.z = LEVER.stem / 2
  const bar = new Mesh(new BoxGeometry(LEVER.bar, LEVER.tall, LEVER.deep), metal)
  bar.position.set(LEVER.bar / 2 - 0.015, 0, LEVER.stem + LEVER.deep / 2 - 0.005)
  return lever.add(plate, stem, bar)
}

/** from the front, the palm on the bar's face near its end and the fingers over it */
export const lever: Held = {
  name: 'door lever, from the front',
  make,
  by: (hand, lever) => grip(hand, lever, { at: new Vector3(0.07, 0, 0.05), from: new Vector3(0, 0, 1) }),
}
