import type { Body, Story } from '@drawcall/animate'
import { flat, type Grip } from '@drawcall/hand'
import { type Object3D, Vector3 } from 'three'
import { type Ball, LINE, letGo, release } from './lane'

const place = (x: number, y: number, z: number) => new Vector3(x, y, z)

/** An approach and a delivery with the right arm, the ball `held` in its hand: the hand lets it go low beside the front foot, short of the foul line, at 7 m/s. */
export function* bowl(body: Body, ball: Ball, drawn: Object3D, held: Grip): Story {
  // he takes the ball up in front of him, the forearm level and the palm under it
  body.hand.right.shape(held.pose)
  body.hand.left.to(place(-0.25, -0.4, 0.3), { on: body, palm: place(-1, 0, 0) })
  yield* body.hand.right.to(place(0, -0.3, 0.3), { on: body, palm: place(0, 1, 0) })
  // he walks up and comes to rest short of the line, the left foot comes down in front, and the hand swings the ball through beside it,
  // the palm behind it, opening as it goes
  body.walk(LINE - 0.4, { plant: 'left' })
  yield* body.until(body.when(LINE - 2))
  body.hand.left.free()
  const moment = body.when(LINE - 0.6)
  const velocity = place(0, 0, 7)
  body.hand.right.shape(flat, { by: moment })
  yield* body.hand.right.by(moment, release(LINE - 0.3), { velocity, with: held, palm: place(0, 0, 1) })
  letGo(ball, drawn, velocity)

  yield* body.stand()
}
