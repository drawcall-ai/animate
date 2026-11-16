// A bare right hand as @drawcall/grab reads one: the hand bone and, under it, three bones and a fingertip per
// finger. Palm down, fingers along -x, thumb ahead (+z).

import { Bone } from 'three'

/** Where the joints of each finger are, out from the wrist and ahead of it (m), from the knuckle to the fingertip. */
const FINGERS: Record<string, [number, number][]> = {
  Thumb: [[0.02, 0.025], [0.05, 0.055], [0.073, 0.078], [0.091, 0.096]],
  Index: [[0.09, 0.03], [0.13, 0.03], [0.154, 0.03], [0.174, 0.03]],
  Middle: [[0.092, 0.01], [0.136, 0.01], [0.164, 0.01], [0.185, 0.01]],
  Ring: [[0.088, -0.01], [0.128, -0.01], [0.154, -0.01], [0.175, -0.01]],
  Little: [[0.08, -0.03], [0.112, -0.03], [0.131, -0.03], [0.149, -0.03]],
}

/** how thick the example draws a finger: half of it (m) */
export const FLESH = 0.008

export function createHand(): Bone {
  const bone = (name: string) => Object.assign(new Bone(), { name })
  const hand = bone('rightHand')
  for (const [finger, joints] of Object.entries(FINGERS)) {
    const parts = finger === 'Thumb' ? ['Metacarpal', 'Proximal', 'Distal', 'Distal_end'] : ['Proximal', 'Intermediate', 'Distal', 'Distal_end']
    let parent = hand, [x, z] = [0, 0]
    joints.forEach(([out, ahead], k) => {
      const b = bone(`right${finger}${parts[k]}`)
      b.position.set(-(out - x), 0, ahead - z)
      parent.add(b)
      ;[parent, x, z] = [b, out, ahead]
    })
  }
  return hand
}
