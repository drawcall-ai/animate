import { grip } from '@drawcall/hand'
import { BoxGeometry, CylinderGeometry, Group, Vector3 } from 'three'
import { solid, type Thing } from './thing'

// the hilt lies along y from the pommel (0) to the guard (0.10); the blade goes on up y, its flat facing z
const HILT = { radius: 0.014, long: 0.1 }

export const sword: Thing = {
  name: 'sword',
  make() {
    const hilt = solid(new CylinderGeometry(HILT.radius, HILT.radius, HILT.long, 32), 0x6b4a2b)
    hilt.position.y = HILT.long / 2
    const guard = solid(new BoxGeometry(0.12, 0.012, 0.025), 0xb0a060)
    guard.position.y = HILT.long + 0.006
    const blade = solid(new BoxGeometry(0.04, 0.6, 0.006), 0xc8ccd0)
    blade.position.y = HILT.long + 0.012 + 0.3
    return new Group().add(hilt, guard, blade)
  },
  grip: (hand, target) =>
    // the palm on the hilt's side facing -z, half way up it
    grip(hand, target, { at: new Vector3(0, HILT.long / 2, -HILT.radius), from: new Vector3(0, 0, -1) }),
}
