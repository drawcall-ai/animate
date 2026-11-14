import type { Body, Story } from '@drawcall/animate'
import { flat } from '@drawcall/hand'
import { Vector3 } from 'three'
import { type Box, PALM, SHELF, clear, grip, shelved, take } from './box'

/** He walks up to a box on the floor, takes it up by its sides, carries it to the shelf, sets it down there and steps back. */
export function* shelve(body: Body, box: Box): Story {
  // he walks up to the box, and the hands take it by its sides
  for (const hand of [body.hand.left, body.hand.right]) hand.shape(flat)
  body.walk(box.position.z - 0.45)
  body.hand.left.to(grip(box.position, 'left'), PALM.left)
  yield* body.hand.right.to(grip(box.position, 'right'), PALM.right)
  yield* body.until(body.time + 0.2)
  take(box, body.hand.left.value, body.hand.right.value)

  // he carries it in front of him to the shelf, has it up over the edge as he comes to rest, and sets it down
  const front = new Vector3(0, -0.3, 0.3)
  const stop = SHELF.edge - 0.3
  body.walk(stop)
  body.hand.left.to(front, { on: body })
  body.hand.right.to(front, { on: body })
  const near = body.when(stop - 0.1)
  body.hand.left.by(near, grip(clear(), 'left'), PALM.left)
  yield* body.hand.right.by(near, grip(clear(), 'right'), PALM.right)
  body.hand.left.to(grip(shelved(), 'left'), PALM.left)
  yield* body.hand.right.to(grip(shelved(), 'right'), PALM.right)
  take(box)

  // he steps back, the hands coming out over the edge and falling
  const out = { velocity: new Vector3(0, -0.5, -1), seconds: 0.4 }
  const back = body.walk(stop - 0.6)
  body.hand.left.to(grip(clear(), 'left'), { ...PALM.left, ...out })
  yield* body.hand.right.to(grip(clear(), 'right'), { ...PALM.right, ...out })
  yield* back
  yield* body.stand()
}
