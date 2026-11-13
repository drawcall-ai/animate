import type { Story } from 'animate-2d'
import { Vector3 } from 'three'
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

/** places on his chest, counted from the shoulder of the hand that goes there, x to his left, y up, z ahead (m): the pouch a magazine comes out of, the grenade on his vest, where the hands meet to pull its pin, and where it leaves the hand */
const POUCH = { x: -0.05, y: -0.3, z: 0.28 }
const VEST = { x: 0.05, y: -0.27, z: 0.27 }
const PIN = {
  right: { x: 0.15, y: -0.2, z: 0.3 },
  left: { x: -0.13, y: -0.19, z: 0.31 },
  pulled: { x: 0.02, y: -0.2, z: 0.26 },
}
const RELEASE = { x: -0.05, y: 0.22, z: 0.25 }
/** how fast a grenade leaves the hand, and how far above the aim (m/s, rad) */
const THROW = { speed: 9, above: 0.35 }

/** The left hand leaves the foregrip, pulls the magazine out and drops it, takes a fresh one from the pouch on his chest and pushes it home: the rifle is canted in to his chest meanwhile. */
export function* reload(soldier: Soldier): Story {
  const { body, rifle } = soldier
  const hand = body.hand.left
  const [on, carried] = [{ on: rifle }, { on: body }]
  // the rifle comes in first, the hand still under it: the magazine is out of its reach across his chest until then
  soldier.mode = 'reload'
  yield* body.until(body.time + CANT)
  yield* hand.to(soldier.well, on)
  soldier.loaded = 'hand'
  yield* hand.to(soldier.under, on)

  soldier.spent.visible = true
  soldier.spent.position.copy(soldier.magazine.position)
  soldier.spent.quaternion.copy(soldier.magazine.quaternion)
  soldier.drop(soldier.spent, hand.velocity)
  soldier.loaded = 'gone'
  hand.shape({ around: 0.05 })
  yield* hand.to(POUCH, carried)
  yield* hand.shape({ around: 0.03 })
  soldier.loaded = 'hand'
  yield* hand.to(soldier.under, on)
  yield* hand.to(soldier.well, on)
  soldier.loaded = 'rifle'
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
  soldier.armed = 'vest'
  right.shape({ around: 0.06 })
  left.shape('point')
  left.to(PIN.pulled, carried)
  yield* right.to(VEST, carried)
  yield* right.shape({ around: 0.035 })
  soldier.armed = 'hand'

  // the hands meet before his chest, and the left takes the pin out to the side
  right.to(PIN.right, carried)
  yield* left.to(PIN.left, carried)
  yield* left.to(PIN.pulled, carried)
  left.free()

  // it leaves the hand beside his head, going the way he aims and a little above
  const { yaw, pitch } = soldier.aimed
  const up = pitch + THROW.above
  const velocity = new Vector3(Math.sin(yaw) * Math.cos(up), Math.sin(up), Math.cos(yaw) * Math.cos(up)).multiplyScalar(
    THROW.speed,
  )
  yield* right.to(RELEASE, { on: body, velocity })
  soldier.armed = 'thrown'
  soldier.drop(soldier.grenade, right.velocity)
  right.shape('flat')
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
  hand.shape('point')
  const pushed = panel.button.clone().addScaledVector(panel.out, -TRAVEL)
  yield* hand.to(pushed, { with: 'index' })
  panel.pressed = true
  yield* body.until(body.time + PRESSED)
  panel.pressed = false
  hand.free()
  soldier.mode = undefined
  yield* body.until(body.time + RAISED)
}
