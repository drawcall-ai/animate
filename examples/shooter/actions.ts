import type { Body, Side, Story } from '@drawcall/animate'
import { flat, point } from '@drawcall/hand'
import { Vector3 } from 'three'
import { hang } from '../carry'
import type { Soldier } from './soldier'

/** a panel on a wall with a button on it: where the face of the button is, which way it faces out of the wall, and whether it is pressed */
export type Panel = { button: Vector3; out: Vector3; pressed: boolean }
/** how far a button goes in, and how long a finger stays on it (m, s) */
export const TRAVEL = 0.008
const PRESSED = 0.3
/** how long a throw takes from the grenade in the hand to its leaving it, how fast it leaves (in his paces) and how far above the aim (rad) */
const THROW = { wind: 1, speed: 3, above: 0.35 }

/**
 * a place on his chest from a shoulder, counted from his own sizes: so far down it and in toward his middle (of his
 * trunk and of how far out a shoulder is), and a hand's breadth (of his arm) ahead of his front there
 */
function chest(body: Body, side: Side, down: number, inward: number) {
  const { trunk, shoulder, arm } = body.size
  const x = (side === 'left' ? -inward : inward) * shoulder
  return new Vector3(x, -down * trunk, body.front(side, -down * trunk) + 0.15 * arm)
}

/** The left hand leaves the foregrip, pulls the magazine out and drops it, takes a fresh one from the pouch on his chest and pushes it home: the rifle is canted in to his chest meanwhile. */
export function* reload(soldier: Soldier): Story {
  const { body, held, magazine, spent } = soldier
  const hand = body.hand.left
  soldier.mode = 'reload'
  hand.shape(flat)
  yield* hand.to(held.magazine, { on: soldier.well, gives: soldier.rifle })
  yield* hand.shape(held.magazine.pose)
  yield* soldier.slide(true)

  magazine.updateWorldMatrix(true, false)
  magazine.matrixWorld.decompose(spent.position, spent.quaternion, spent.scale)
  soldier.drop(spent, hand.velocity)
  magazine.visible = soldier.loaded = false
  yield* hand.to(chest(body, 'left', 0.5, -0.3), { on: body })
  hang(soldier.hands.left, magazine, held.magazine)
  magazine.visible = true
  yield* hand.to(held.magazine, { on: soldier.well, gives: soldier.rifle })
  soldier.seat()
  yield* soldier.slide(false)
}

/**
 * The rifle is held in the left hand, the right takes the grenade from his vest and throws it overarm the way he
 * aims: it leaves the hand above his shoulder, moving as the hand does.
 */
export function* grenade(soldier: Soldier): Story {
  const { body } = soldier
  const hand = body.hand.right
  hand.shape(flat)
  // (from the pouch on the flank of his vest, out past his shoulder, where his elbow clears his trunk however it is turned)
  const fetched = hand.to(chest(body, 'right', 0.55, -0.6), { on: body })
  // the rifle rests in his left shoulder meanwhile, pointing down ahead of him in his left hand
  soldier.mode = 'slung'
  soldier.hold('left', true)
  yield* fetched
  hang(soldier.hands.right, soldier.grenade, soldier.held.grenade)
  yield* hand.shape(soldier.held.grenade.pose)

  const { yaw, pitch } = soldier.aimed
  const up = pitch + THROW.above
  const way = new Vector3(Math.sin(yaw) * Math.cos(up), Math.sin(up), Math.cos(yaw) * Math.cos(up))
  const { arm, pace } = body.size
  // cocked up behind his shoulder by his ear, and from there thrown over it: let go ahead of his face
  hand.to(new Vector3(-0.15 * arm, 0.4 * arm, -0.25 * arm), { on: body })
  const release = new Vector3(0.1 * arm, 0.4 * arm, 0.45 * arm)
  yield* hand.by(body.time + THROW.wind, release, { on: body, velocity: way.multiplyScalar(THROW.speed * pace) })
  soldier.drop(soldier.grenade, hand.velocity)
  hand.shape(flat)
  yield* body.until(body.time + 0.45)
}

/** The left hand leaves the rifle and presses a button with the tip of its index finger: the rifle is lowered meanwhile, and he stays where he is. */
export function* press(soldier: Soldier, panel: Panel): Story {
  const { body } = soldier
  const hand = body.hand.left
  soldier.mode = 'low'
  soldier.rooted = true
  hand.shape(point)
  const pushed = panel.button.clone().addScaledVector(panel.out, -TRAVEL)
  yield* hand.to(pushed, { with: 'index' })
  panel.pressed = true
  yield* body.until(body.time + PRESSED)
  panel.pressed = false
}
