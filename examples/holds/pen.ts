import { fist, grip } from '@drawcall/hand'
import { CylinderGeometry, Group, Vector3 } from 'three'
import { solid, type Thing } from './thing'

const PEN = { radius: 0.005, long: 0.14, nib: 0.015 }

// along y, the writing end down at -0.07
export const pen: Thing = {
  name: 'pen',
  make() {
    const body = solid(new CylinderGeometry(PEN.radius, PEN.radius, PEN.long - PEN.nib, 24), 0x203080)
    body.position.y = PEN.nib / 2
    const nib = solid(new CylinderGeometry(PEN.radius, 0.0006, PEN.nib, 24), 0x202020)
    nib.position.y = -PEN.long / 2 + PEN.nib / 2
    return new Group().add(body, nib)
  },
  grip: (hand, target) =>
    // pinched between the thumb and index 3.5 cm above the nib, the hand behind it, the nib ahead of the fingertips
    grip(hand, target, {
      at: new Vector3(0, -PEN.long / 2 + 0.035, 0),
      from: new Vector3(0, 1, 0),
      using: ['thumb', 'index'],
      start: fist,
    }),
}
