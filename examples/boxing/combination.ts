import type { Body, Story } from '@drawcall/animate'
import { fist } from '@drawcall/hand'
import { Vector3 } from 'three'
import { type Bag, hit, later, meeting } from './bag'

/** the guard: the fists in front of the chin, counted from each shoulder, the lead hand a little further out */
const GUARD = { left: new Vector3(-0.1, 0, 0.32), right: new Vector3(0.1, -0.02, 0.26) }
/** how high the punches land (m), and how far short of where the wrist meets the hanging bag the hips come to rest */
const HIGH = 1.4
const RANGE = 0.4
/** how long after the jab the cross lands, and how long the right hand takes back to the guard after it (s) */
const BEAT = 0.25
const BACK = 0.35

/** From a guard he steps in, jabs with the left hand, throws a cross with the right, and steps back out into his guard. */
export function* combination(body: Body, bag: Bag): Story {
  const out = body.hips.value.z
  for (const hand of [body.hand.left, body.hand.right]) hand.shape(fist)
  body.hand.left.to(GUARD.left, { on: body })
  yield* body.hand.right.to(GUARD.right, { on: body })

  // he steps in, and the left hand is on the bag
  const jab = meeting(bag, 'left', HIGH, 6)
  body.walk(jab.at.z - RANGE)
  yield* body.hand.left.to(jab.at, jab)
  hit(bag, body.hand.left.value, body.hand.left.velocity)

  // it comes back to the guard as the right hand goes, to where the bag has swung to by then
  body.hand.left.to(GUARD.left, { on: body, seconds: BEAT })
  const cross = meeting(later(bag, BEAT), 'right', HIGH, 8)
  yield* body.hand.right.to(cross.at, { ...cross, seconds: BEAT })
  hit(bag, body.hand.right.value, body.hand.right.velocity)

  // and he steps back out behind his guard
  body.hand.right.to(GUARD.right, { on: body, seconds: BACK })
  yield* body.walk(out)
  yield* body.stand()
}
