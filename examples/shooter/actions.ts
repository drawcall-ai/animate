import type { Story } from '@drawcall/animate'
import { flat, point } from '@drawcall/hand'
import { Vector3 } from 'three'
import { hang } from '../carry'
import type { Soldier } from './soldier'

/** a panel on a wall with a button on it: where the face of the button is, which way it faces out of the wall, and whether it is pressed */
export type Panel = { button: Vector3; out: Vector3; pressed: boolean }
/** how far a button goes in, and how long a finger stays on it (m, s) */
export const TRAVEL = 0.008
const PRESSED = 0.3
/** how long the rifle takes to come in to his chest (s) */
const CANT = 0.35
/** how long the rifle takes to come up to where both hands reach it again (s) */
const RAISED = 0.25

/** places on his chest, counted from the shoulder of the hand that goes there, x to his left, y up, z ahead (m, for the arm the rifle is drawn for): the pouch a magazine comes out of, the grenade on his vest, where the hands meet to pull its pin, and where it leaves the hand */
const POUCH = { x: -0.05, y: -0.3, z: 0.28 }
const VEST = { x: 0.05, y: -0.27, z: 0.27 }
const PIN = {
  right: { x: 0.15, y: -0.2, z: 0.3 },
  left: { x: -0.13, y: -0.19, z: 0.31 },
  pulled: { x: 0.02, y: -0.2, z: 0.26 },
}
const RELEASE = { x: -0.05, y: 0.22, z: 0.25 }
/** a place on his chest as it is for him: as much further from the shoulder as his arm is longer */
const mine = (soldier: Soldier, { x, y, z }: { x: number; y: number; z: number }) =>
  new Vector3(x, y, z).multiplyScalar(soldier.scale)
/** how fast a grenade leaves the hand, for the arm the rifle is drawn for, and how far above the aim (m/s, rad): a
 * shorter arm swung as fast throws it as much slower */
const THROW = { speed: 9, above: 0.35 }

/** The left hand leaves the foregrip, pulls the magazine out and drops it, takes a fresh one from the pouch on his chest and pushes it home: the rifle is canted in to his chest meanwhile. */
export function* reload(soldier: Soldier): Story {
  const { body, held, magazine, spent } = soldier
  const hand = body.hand.left
  // the rifle comes in first, the hand still under it: the magazine is out of its reach across his chest until then
  soldier.mode = 'reload'
  yield* body.until(body.time + CANT)
  hand.shape(flat)
  yield* hand.to(held.magazine, { on: soldier.well })
  yield* hand.shape(held.magazine.pose)
  yield* soldier.slide(true)

  magazine.updateWorldMatrix(true, false)
  magazine.matrixWorld.decompose(spent.position, spent.quaternion, spent.scale)
  spent.visible = true
  soldier.drop(spent, hand.velocity)
  magazine.visible = soldier.loaded = false
  yield* hand.to(mine(soldier, POUCH), { on: body })
  hang(soldier.hands.left, magazine, held.magazine)
  magazine.visible = true
  yield* hand.to(held.magazine, { on: soldier.well })
  soldier.seat()
  yield* soldier.slide(false)
}

/** The rifle hangs from its sling, the right hand takes the grenade from his vest, the left pulls the pin, and he throws it the way he aims. */
export function* grenade(soldier: Soldier): Story {
  const { body } = soldier
  const [right, left] = [body.hand.right, body.hand.left]
  const carried = { on: body }
  // the hands let go before the rifle swings down out of their reach
  right.free()
  left.free()
  soldier.mode = 'sling'
  right.shape(flat)
  left.shape(point)
  left.to(mine(soldier, PIN.pulled), carried)
  yield* right.to(mine(soldier, VEST), carried)
  hang(soldier.hands.right, soldier.grenade, soldier.held.grenade)
  soldier.grenade.visible = true
  yield* right.shape(soldier.held.grenade.pose)

  // the hands meet before his chest, and the left takes the pin out to the side
  right.to(mine(soldier, PIN.right), carried)
  yield* left.to(mine(soldier, PIN.left), carried)
  yield* left.to(mine(soldier, PIN.pulled), carried)
  left.free()

  // it leaves the hand beside his head, going the way he aims and a little above
  const { yaw, pitch } = soldier.aimed
  const up = pitch + THROW.above
  const velocity = new Vector3(Math.sin(yaw) * Math.cos(up), Math.sin(up), Math.cos(yaw) * Math.cos(up)).multiplyScalar(
    THROW.speed * soldier.scale,
  )
  yield* right.to(mine(soldier, RELEASE), { on: body, velocity })
  soldier.drop(soldier.grenade, right.velocity)
  right.shape(flat)
  yield* body.until(body.time + 0.45)
  // the rifle comes up off the sling before the hands are on it again: hanging, its grips are too near his chest for his arms
  soldier.mode = undefined
  yield* body.until(body.time + RAISED)
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
  hand.free()
  soldier.mode = undefined
  yield* body.until(body.time + RAISED)
}
