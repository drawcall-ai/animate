import type { Body, Side, Story } from '@drawcall/animate'
import { point } from '@drawcall/hand'
import { Vector3 } from 'three'
import { holds } from '../character'
import { RIFLE } from './rifle'
import type { Soldier } from './soldier'

/** a panel on a wall with a button on it: where the face of the button is, which way it faces out of the wall, and whether it is pressed */
export type Panel = { button: Vector3; out: Vector3; pressed: boolean }
/** how far a button goes in, and how long a finger stays on it (m, s) */
export const TRAVEL = 0.008
const PRESSED = 0.3
/**
 * a throw: how fast the grenade leaves the hand (in his paces), how far above the aim (rad), and how long after it is
 * in the hand it leaves it, time for the trunk to wind up (s); where the hand is cocked, its elbow bent by his ear,
 * and where it lets go, out beside and above his shoulder and a little ahead of it, the arm out to the side so that
 * the hand swings forward across it, which is far faster than it stretches, and on down into his view (of his arm,
 * from the shoulder: to his left, up, ahead)
 */
const THROW = {
  speed: 3,
  above: 0.3,
  wind: 1,
  cocked: new Vector3(0.1, 0.4, -0.3),
  release: new Vector3(-0.35, 0.65, 0.25),
}

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
  yield* hand.to(held.magazine)
  yield* soldier.slide(true)

  magazine.updateWorldMatrix(true, false)
  magazine.matrixWorld.decompose(spent.position, spent.quaternion, spent.scale)
  soldier.drop(spent, hand.velocity)
  magazine.visible = soldier.loaded = false
  body.hold(soldier.rifle, { rests: RIFLE.butt }).free('left')
  yield* hand.to(chest(body, 'left', 0.5, -0.3), { on: body })
  soldier.shown.attach(magazine)
  const fresh = holds(body, soldier.hands.left, held.magazine)
  magazine.visible = true
  yield* fresh.to({ x: 0, y: 0, z: 0 }, { on: soldier.well, pointing: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 } })
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
  // the rifle hangs in his left hand meanwhile, pointing a little down ahead of him, low in his view
  soldier.mode = 'slung'
  body.hold(soldier.rifle).free('right')
  // (from the pouch on the flank of his vest, out past his shoulder, where his elbow clears his trunk however it is turned)
  yield* hand.to(chest(body, 'right', 0.55, -0.6), { on: body })
  soldier.shown.add(soldier.grenade)
  const grenade = holds(body, soldier.hands.right, soldier.held.grenade)

  const { yaw, pitch } = soldier.aimed
  const up = pitch + THROW.above
  const way = new Vector3(Math.sin(yaw) * Math.cos(up), Math.sin(up), Math.cos(yaw) * Math.cos(up))
  const { arm, pace } = body.size
  const [cocked, release] = [THROW.cocked.clone().multiplyScalar(arm), THROW.release.clone().multiplyScalar(arm)]
  const velocity = way.multiplyScalar(THROW.speed * pace)
  hand.to(cocked, { on: body })
  yield* hand.by(body.time + THROW.wind, release, { on: body, velocity })
  grenade.free()
  soldier.drop(soldier.grenade, hand.velocity)
  // (it swings on across him, and comes back to the rifle)
  yield* body.until(body.time + 0.4)
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
