import type { Body, Side, Story } from '@drawcall/animate'
import { grip, type Hand } from '@drawcall/hand'
import { Vector3 } from 'three'
import { lying } from '../character'
import { BOX, type Box, PALM, SHELF, clear, shelved } from './box'

/**
 * He walks up to a box on the floor, takes it up by its sides, carries it to the shelf, sets it down there and steps
 * back. The box is bound to both hands, the right leading it, and the story sends the box. The `hands` are read from the rig at rest.
 */
export function* shelve(body: Body, box: Box, hands: Record<Side, Hand>): Story {
  const { left, right } = body.hand
  // he walks up to the box, and the hands go onto its sides
  body.walk(box.mesh.position.z - 0.45)
  const grips = { left: grip(hands.left, box.mesh, PALM.left), right: grip(hands.right, box.mesh, PALM.right) }
  const reached = left.to(grips.left)
  yield* right.to(grips.right)
  yield* reached
  const carried = body.bind(box.mesh)
  carried.on(right, grips.right)
  carried.on(left, grips.left)
  box.held = true

  // he carries it square before him to the shelf, has it up over the edge as he comes to rest, and sets it down
  const square = lying(hands.right, grips.right)
  const stop = SHELF.edge - 0.3
  body.walk(stop)
  void carried.to({ x: body.size.shoulder, y: -0.3, z: 0.3 }, { on: body, ...square })
  yield* carried.by(body.when(stop - 0.1), clear(), square)
  yield* carried.to(shelved(), square)
  carried.free()
  box.held = false

  // he steps back, the hands coming out over the edge and falling
  const out = { velocity: new Vector3(0, -0.5, -1), seconds: 0.4 }
  const back = body.walk(stop - 0.6)
  const from = (side: Side) => clear().setX((side === 'left' ? 1 : -1) * (BOX.width / 2))
  left.to(from('left'), { ...out, with: 'palm', palm: { x: -1, y: 0, z: 0 } })
  yield* right.to(from('right'), { ...out, with: 'palm', palm: { x: 1, y: 0, z: 0 } })
  yield* back
  yield* body.stand()
}
