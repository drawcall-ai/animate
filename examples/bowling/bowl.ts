import type { Body, Held, Story } from '@drawcall/animate'
import { flat } from '@drawcall/hand'
import { type Object3D, Vector3 } from 'three'
import { type Ball, LINE, letGo, RADIUS } from './lane'

const place = (x: number, y: number, z: number) => new Vector3(x, y, z)

/**
 * An approach and a delivery with the right arm, the ball `held` in its hand: from where he stands he walks up to the
 * foul line in front of the lane, and the hand lets it go down the lane low beside the front foot, short of the line, at 7 m/s.
 */
export function* bowl(body: Body, ball: Ball, drawn: Object3D, held: Held): Story {
  // he takes the ball up in front of him, the forearm level and the palm under it
  body.hand.left.to(place(-0.25, -0.4, 0.3), { on: body, palm: place(-1, 0, 0) })
  yield* body.hand.right.to(place(0, -0.3, 0.3), { on: body, palm: place(0, 1, 0) })
  // he walks up and comes to rest short of the line, the left foot comes down in front, and the hand swings the ball through beside it,
  // the palm behind it, opening as it goes; places on his way are told by how far short of the line they are
  const from = body.hips.value.clone().setY(0)
  const end = place(0, 0, LINE - 0.4)
  const short = (far: number) => from.clone().lerp(end, 1 - (far - 0.4) / from.distanceTo(end))
  body.walk(end, { plant: 'left' })
  yield* body.until(body.when(short(2)))
  body.hand.left.free()
  const moment = body.when(short(0.6))
  const velocity = place(0, 0, 7)
  body.hand.right.shape(flat, { by: moment })
  const release = short(0.3).add(place(-0.2, RADIUS + 0.09, 0))
  yield* held.by(moment, release, { velocity, palm: place(0, 0, 1) })
  held.free()
  letGo(ball, drawn, velocity)

  yield* body.stand()
}
