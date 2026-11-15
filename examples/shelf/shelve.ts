import type { Body, Side, Story } from '@drawcall/animate'
import { grip, type Hand } from '@drawcall/hand'
import { Vector3 } from 'three'
import { BOX, type Box, PALM, SHELF, clear, shelved } from './box'

/** the box square to him, as he faces +z: its z ahead and its y up */
const SQUARE = { pointing: new Vector3(0, 0, 1), up: new Vector3(0, 1, 0) }

/**
 * He walks up to a box on the floor, takes it up by its sides, carries it to the shelf, sets it down there and steps
 * back. The `hands` are read from the rig at rest.
 */
export function* shelve(body: Body, box: Box, hands: Record<Side, Hand>): Story {
  // he walks up to the box, and the hands take it by its sides
  body.walk(box.mesh.position.z - 0.45)
  const held = body.hold(box.mesh)
  box.held = true
  const left = body.hand.left.to(grip(hands.left, box.mesh, PALM.left))
  yield* body.hand.right.to(grip(hands.right, box.mesh, PALM.right))
  yield* left

  // he carries it in front of him to the shelf, has it up over the edge as he comes to rest, and sets it down
  const stop = SHELF.edge - 0.3
  body.walk(stop)
  held.to({ x: body.size.shoulder, y: -0.3, z: 0.3 }, { on: body, ...SQUARE })
  yield* held.by(body.when(stop - 0.1), clear(), SQUARE)
  yield* held.to(shelved(), SQUARE)
  held.free()
  box.held = false

  // he steps back, the hands coming out over the edge and falling
  const out = { velocity: new Vector3(0, -0.5, -1), seconds: 0.4 }
  const back = body.walk(stop - 0.6)
  const from = (side: Side) => clear().setX((side === 'left' ? 1 : -1) * (BOX.width / 2))
  body.hand.left.to(from('left'), { ...out, with: 'palm', palm: { x: -1, y: 0, z: 0 } })
  yield* body.hand.right.to(from('right'), { ...out, with: 'palm', palm: { x: 1, y: 0, z: 0 } })
  yield* back
  yield* body.stand()
}
