import type { Body, Held, Story } from '@drawcall/animate'
import { flat } from '@drawcall/hand'
import { type Object3D, Vector3 } from 'three'
import { type Ball, LINE, letGo, RADIUS } from './lane'

const place = (x: number, y: number, z: number) => new Vector3(x, y, z)

/**
 * An approach and a delivery with the right arm, the ball `held` in its hand and the left letting go of it if it is on
 * it: from where he stands he hurries up to the foul line in front of the lane, braking onto the left foot short of it,
 * and the hand lets the ball go down the lane low beside that foot at 7 m/s.
 */
export function* bowl(body: Body, ball: Ball, drawn: Object3D, held: Held): Story {
  // he hurries up and brakes onto the left foot short of the line, and the hand swings the ball through beside it, the
  // palm behind it, opening as it goes: sent as he sets off, well ahead of its moment, so that it draws back in full;
  // places on his way are told by how far short of the line they are
  const from = body.hips.value.clone().setY(0)
  const end = place(0, 0, LINE - 0.4)
  const short = (far: number) => from.clone().lerp(end, 1 - (far - 0.4) / from.distanceTo(end))
  body.run({ speed: 2.5, at: end, plant: 'left', arrive: 1 })
  held.free('left')
  const moment = body.when(short(0.6))
  const velocity = place(0, 0, 7)
  body.hand.right.shape(flat, { by: moment })
  const release = short(0.3).add(place(-0.2, RADIUS + 0.09, 0))
  yield* held.by(moment, release, { velocity, palm: place(0, 0, 1) })
  held.free()
  letGo(ball, drawn, velocity)

  yield* body.stand()
}
