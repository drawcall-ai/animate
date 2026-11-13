import type { Body, Story } from 'animate-2d'
import { Vector3 } from 'three'
import { type Ball, LINE, release } from './lane'

const place = (x: number, y: number, z: number) => new Vector3(x, y, z)

/** An approach and a delivery with the right arm: the hand lets the ball go low beside the front foot, short of the foul line, at 7 m/s. */
export function* bowl(body: Body, ball: Ball): Story {
  // he takes the ball up in front of him, the forearm level
  yield* body.hand.right.to(place(0, -0.3, 0.3), { carried: true })
  // he walks up and comes to rest short of the line, the left foot comes down in front, and the hand swings the ball through beside it
  body.walk(LINE - 0.4, { plant: 'left' })
  yield* body.hand.right.by(body.when(LINE - 0.6), release(LINE - 0.3), { velocity: place(0, 0, 7) })
  ball.velocity = body.hand.right.velocity.clone()

  yield* body.stand()
}
