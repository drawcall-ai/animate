import type { Side } from 'animate-2d'
import { Vector3 } from 'three'

/** a heavy bag: where it hangs from, how far its middle has swung from under there and how that changes (along the ground), and how many punches have landed on it */
export type Bag = { pivot: Vector3; swung: Vector3; velocity: Vector3; landed: number }

/** how thick and long the bag is, how far under what it hangs from its middle is, and how high that is (m) */
export const BAG = { radius: 0.18, length: 1, hang: 1.3, middle: 1.25 }
/** how far ahead of the wrist a glove meets something (m) */
export const GLOVE = 0.09
/** a fist as it meets the bag: how much of the two in weight it and what is behind it are, and how much of their closing speed comes back */
const FIST = { share: 2 / (2 + 45), bounce: 0.2 }
/** how near the bag a glove counts as on it (m) */
const TOUCH = 0.04
/** how much of its speed a swinging bag loses in a second */
const DRAG = 0.8
const GRAVITY = 9.81

/** a bag hanging at rest `ahead` of the origin (m) */
export const bagAt = (ahead: number): Bag => ({
  pivot: new Vector3(0, BAG.middle + BAG.hang, ahead),
  swung: new Vector3(),
  velocity: new Vector3(),
  landed: 0,
})

/** where the middle line of the bag is at a height, as it has swung */
const line = (bag: Bag, y: number) =>
  new Vector3(bag.pivot.x, y, bag.pivot.z).addScaledVector(bag.swung, (bag.pivot.y - y) / BAG.hang)

/** where a wrist is as its glove meets the near face of the bag `high` up, a little to its own side of the middle, and how it moves there at `speed` (m/s) */
export function meeting(bag: Bag, side: Side, high: number, speed: number) {
  const at = line(bag, high)
  at.x += side === 'left' ? 0.05 : -0.05
  at.z -= BAG.radius + GLOVE
  return { at, velocity: new Vector3(0, 0, speed) }
}

/** the bag as it will hang `seconds` on, left alone */
export function later(bag: Bag, seconds: number): Bag {
  const then = { ...bag, swung: bag.swung.clone(), velocity: bag.velocity.clone() }
  const step = 1 / 200
  for (let gone = 0; gone < seconds; gone += step) swing(then, step)
  return then
}

/** a glove that is on the bag pushes it away from the wrist, with what the fist's speed toward it gives */
export function hit(bag: Bag, wrist: Vector3, velocity: Vector3) {
  const away = line(bag, wrist.y).sub(wrist)
  if (away.length() > BAG.radius + GLOVE + TOUCH) return
  away.normalize()
  const closing = velocity.dot(away) - bag.velocity.dot(away)
  if (closing <= 0) return
  bag.velocity.addScaledVector(away, (1 + FIST.bounce) * FIST.share * closing)
  bag.landed++
}

/** it swings under what it hangs from, and less and less */
export function swing(bag: Bag, dt: number) {
  bag.velocity.addScaledVector(bag.swung, (-GRAVITY / BAG.hang) * dt)
  bag.velocity.multiplyScalar(1 - DRAG * dt)
  bag.swung.addScaledVector(bag.velocity, dt)
}
