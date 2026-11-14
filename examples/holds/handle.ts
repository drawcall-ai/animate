import { grip } from '@drawcall/hand'
import { CylinderGeometry, Group, Vector3 } from 'three'
import { solid, type Thing } from './thing'

const BAR = { radius: 0.0125, long: 0.12, post: 0.035, postRadius: 0.008 }

// the bar along x at the origin, its posts going up y to the case
export const handle: Thing = {
  name: 'suitcase handle',
  make() {
    const bar = solid(new CylinderGeometry(BAR.radius, BAR.radius, BAR.long, 32), 0x303030)
    bar.rotation.z = Math.PI / 2
    const out = new Group().add(bar)
    for (const side of [-1, 1]) {
      const post = solid(new CylinderGeometry(BAR.postRadius, BAR.postRadius, BAR.post, 16), 0x303030)
      post.position.set((side * (BAR.long - 0.016)) / 2, BAR.post / 2, 0)
      out.add(post)
    }
    return out
  },
  grip: (hand, target) =>
    // a hook, the thumb left out: the palm on the bar's front (+z)
    grip(hand, target, {
      at: new Vector3(0, 0, BAR.radius),
      from: new Vector3(0, 0, 1),
      using: ['palm', 'index', 'middle', 'ring', 'little'],
    }),
}
