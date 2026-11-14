import { grip, point } from '@drawcall/hand'
import { BoxGeometry, Euler, Group, Vector3 } from 'three'
import { solid, type Thing } from './thing'

// the barrel along +z, up is +y, the right of the gun is -x; the origin is the top of the grip's rear
const RAKE = 0.2
const TRIGGER = { y: -0.016, z: 0.052, size: 0.006 }

export const pistol: Thing = {
  name: 'pistol',
  make() {
    const handle = solid(new BoxGeometry(0.03, 0.11, 0.04).translate(0, -0.055, 0.02), 0x303030)
    handle.rotation.x = RAKE
    const slide = solid(new BoxGeometry(0.03, 0.035, 0.18).translate(0, 0.0175, 0.08), 0x505050)
    const front = solid(new BoxGeometry(0.006, 0.03, 0.006), 0x303030)
    front.position.set(0, -0.015, 0.078)
    const under = solid(new BoxGeometry(0.006, 0.006, 0.04), 0x303030)
    under.position.set(0, -0.03, 0.058)
    const trigger = solid(new BoxGeometry(TRIGGER.size, 0.022, TRIGGER.size), 0x808080)
    trigger.position.set(0, TRIGGER.y, TRIGGER.z)
    return new Group().add(handle, slide, front, under, trigger)
  },
  grip(hand, target) {
    // the hand round the grip: the palm on its back strap, coming from behind and the gun's right
    const backStrap = new Vector3(0, -0.05, 0).applyEuler(new Euler(RAKE, 0, 0))
    const held = grip(hand, target, {
      at: backStrap,
      from: new Vector3(-1, 0, -1).normalize(),
      using: ['palm', 'thumb', 'middle', 'ring', 'little'],
      start: point,
    })
    // then the index on the trigger's rear face
    const trigger = new Vector3(0, TRIGGER.y, TRIGGER.z - TRIGGER.size / 2)
    return grip(hand, target, { at: trigger, using: ['index'], start: held })
  },
}
