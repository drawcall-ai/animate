import { grip } from '@drawcall/hand'
import { BoxGeometry, Group, Vector3 } from 'three'
import { solid, type Thing } from './thing'

const PHONE = { wide: 0.07, long: 0.15, thick: 0.008 }

// lying in x (wide) and y (long), its screen facing +z
export const phone: Thing = {
  name: 'smartphone',
  make: () => new Group().add(solid(new BoxGeometry(PHONE.wide, PHONE.long, PHONE.thick), 0x202428)),
  grip: (hand, target) =>
    // the palm on the right edge and the back, a little below the middle
    grip(hand, target, {
      at: new Vector3(PHONE.wide / 2, -0.03, -PHONE.thick / 2),
      from: new Vector3(1, 0, -1).normalize(),
    }),
}
