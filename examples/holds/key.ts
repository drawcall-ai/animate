import { fist, grip } from '@drawcall/hand'
import { BoxGeometry, CylinderGeometry, Group, Vector3 } from 'three'
import { solid, type Thing } from './thing'

const KEY = { bow: 0.0125, thick: 0.003, blade: 0.03 }

// flat in the xy plane, the bow's middle at the origin and the blade going off down y
export const key: Thing = {
  name: 'key',
  make() {
    const bow = solid(new CylinderGeometry(KEY.bow, KEY.bow, KEY.thick, 32), 0xd0b040)
    bow.rotation.x = Math.PI / 2
    const blade = solid(new BoxGeometry(0.01, KEY.blade, KEY.thick), 0xd0b040)
    blade.position.y = -KEY.bow - KEY.blade / 2
    return new Group().add(bow, blade)
  },
  grip: (hand, target) =>
    // the bow pinched at its middle between the thumb and the curled index, the hand behind it, the blade going on away
    grip(hand, target, {
      at: new Vector3(0, 0, 0),
      from: new Vector3(0, 1, 0),
      using: ['thumb', 'index'],
      start: fist,
    }),
}
