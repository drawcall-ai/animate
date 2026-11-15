import type { Body, Held, Story } from '@drawcall/animate'
import { flat } from '@drawcall/hand'
import { type Object3D, Vector3 } from 'three'
import { type Flight, RADIUS, arc, letGo } from './court'

const place = (x: number, y: number, z: number) => new Vector3(x, y, z)
/** where he shoots from, ahead of where he starts (m) */
const SPOT = 1.5
/** how steeply the ball leaves the hand, up from level (rad): a high arc drops into the ring */
const UP = (52 * Math.PI) / 180
/** the guide hand's palm faces the ball from its left side */
const SIDE = place(-1, 0, 0)

/**
 * A scripted jump shot, played by the library's tests rather than the game: a few steps to the spot, the ball `held`
 * in the right hand, which shoots, and the left at its side. He gathers the ball before his chest as he walks, comes
 * to rest, dips and springs up, raising it to above his forehead; at the top of the jump the right arm sends it off
 * and stays up, the left still where the ball was.
 */
export function* jumpShot(body: Body, ball: Flight, drawn: Object3D, held: Held): Story {
  const { shoulder, arm, forearm, leg, stand, trunk } = body.size
  // places of the ball, counted from his right shoulder: halfway in to his middle, which is in line with his right eye;
  // before his chest it is far enough out for the forearms to come round it clear of the trunk
  const inward = shoulder / 2
  const chest = place(inward, -arm / 3, body.front('right', -arm / 3, inward) + RADIUS + forearm / 2)
  const set = place(inward, arm / 2, arm / 3)
  // the left hand's palm on the ball's left side: the ball counted from the left shoulder, one width of shoulders over
  const beside = (ballAt: Vector3) => ballAt.clone().add({ x: RADIUS - 2 * shoulder, y: 0, z: 0 })
  held.to(chest, { on: body })
  body.hand.left.to(beside(chest), { on: body, with: 'palm', palm: SIDE })
  body.hand.left.shape(flat)
  yield* body.walk(SPOT)

  // he springs straight up from where he stands; the ball is up at the set point halfway to the top, about as he
  // leaves the ground, the guide hand with it
  const top = place(0, stand + leg / 3, SPOT)
  const jumping = body.jump(top)
  const highest = body.highest()
  const lifted = (body.time + highest) / 2
  held.by(lifted, set, { on: body })
  body.hand.left.by(lifted, beside(set), { on: body, with: 'palm', palm: SIDE })
  // at the top, the ball leaves the fingertips above and ahead of his shoulder on its way to the ring, the hand open
  const release = place(-shoulder + inward, top.y + trunk + arm, SPOT + arm / 4)
  const flying = arc(release, UP)
  body.hand.right.shape(flat, { by: highest })
  const there = yield* held.by(highest, release, { velocity: flying })
  // (a hand the body could not bring there it has let go, and said why: the ball stays in it rather than leave from
  // somewhere else)
  if (there) {
    held.free()
    letGo(ball, drawn, flying)
  }

  // the shooting arm follows the ball on up toward the ring and stays there, the wrist dropped, until he lands
  body.hand.right.to(place(inward, arm * 0.7, arm * 0.6), { on: body, palm: place(0, -1, 0.5) })
  yield* jumping
  yield* body.stand()
}
