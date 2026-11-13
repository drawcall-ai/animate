import type { Body, Story } from 'animate-2d'
import { Vector3 } from 'three'
import { type Box, SHELF, clear, grip, shelved } from './box'

/** He walks up to a box on the floor, takes it up by its sides, carries it to the shelf, sets it down there and steps back. */
export function* shelve(body: Body, box: Box): Story {
  // he walks up to the box, and the hands take it by its sides
  body.walk(box.position.z - 0.45)
  body.hand.left.to(grip(box.position, 'left'))
  yield* body.hand.right.to(grip(box.position, 'right'))
  yield* body.until(body.time + 0.2)
  box.held = true

  // he carries it in front of him to the shelf, has it up over the edge as he comes to rest, and sets it down
  const front = new Vector3(0, -0.3, 0.3)
  const stop = SHELF.edge - 0.3
  body.walk(stop)
  body.hand.left.to(front, { carried: true })
  body.hand.right.to(front, { carried: true })
  const near = body.when(stop - 0.1)
  body.hand.left.by(near, grip(clear(), 'left'))
  yield* body.hand.right.by(near, grip(clear(), 'right'))
  body.hand.left.to(grip(shelved(), 'left'))
  yield* body.hand.right.to(grip(shelved(), 'right'))
  box.held = false

  // he steps back, the hands coming out over the edge and falling
  const out = { velocity: new Vector3(0, -0.5, -1), seconds: 0.4 }
  const back = body.walk(stop - 0.6)
  body.hand.left.to(grip(clear(), 'left'), out)
  yield* body.hand.right.to(grip(clear(), 'right'), out)
  yield* back
}
