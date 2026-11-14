import { grip } from '@drawcall/hand'
import { CylinderGeometry, Group, Vector3 } from 'three'
import { solid, type Thing } from './thing'

const BOTTLE = { radius: 0.033, high: 0.2 }
/** how far round toward +x from the side facing -z the palm is on it (rad): centred there, the thumb comes round the
 * bottle only as far as square to the fingers */
const ROUND = 0.3
const toward = new Vector3(Math.sin(ROUND), 0, -Math.cos(ROUND))

// upright on y, its middle at the origin
export const bottle: Thing = {
  name: 'water bottle',
  make: () => new Group().add(solid(new CylinderGeometry(BOTTLE.radius, BOTTLE.radius, BOTTLE.high, 48), 0x4090d0)),
  grip: (hand, target) =>
    // the palm at the middle
    grip(hand, target, { at: toward.clone().multiplyScalar(BOTTLE.radius), from: toward }),
}
