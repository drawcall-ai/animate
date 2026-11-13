import { Body } from 'animate-2d'
import { CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { mannequin } from '../mannequin'
import { run } from '../stage'
import { BAG, type Bag, bagAt, swing } from './bag'
import { combination } from './combination'

// the bag and what it hangs by, in a group that turns about where it hangs from
const sack = new Mesh(
  new CylinderGeometry(BAG.radius, BAG.radius, BAG.length),
  new MeshStandardMaterial({ color: 0xa03030 }),
)
sack.position.y = -BAG.hang
const chain = new Mesh(
  new CylinderGeometry(0.01, 0.01, BAG.hang - BAG.length / 2),
  new MeshStandardMaterial({ color: 0x808890 }),
)
chain.position.y = -(BAG.hang - BAG.length / 2) / 2
const hanging = new Group().add(sack, chain)
let body: Body
let bag: Bag
let most = 0

run({
  begin() {
    const man = mannequin()
    body = new Body(man)
    bag = bagAt(1.2)
    most = 0
    hanging.position.copy(bag.pivot)
    body.play(combination(body, bag))
    return new Group().add(man, hanging)
  },
  update(delta) {
    body.update(delta)
    swing(bag, delta)
    most = Math.max(most, bag.swung.length())
    hanging.rotation.set(-Math.asin(bag.swung.z / BAG.hang), 0, Math.asin(bag.swung.x / BAG.hang))
  },
  focus: () => body.hips.value.z,
  readout() {
    return [
      `landed    ${['…', 'the jab', 'the jab and the cross'][bag.landed]}`,
      `bag       swung ${(most * 100).toFixed(0)} cm at the most`,
      `story     ${body.playing ? 'playing' : 'over'}`,
    ].join('\n')
  },
})
