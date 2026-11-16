import { grip, Hand } from '@drawcall/hand'
import { Scene } from 'three'
import { expect, test } from 'vitest'
import { bowl, carry, SIDE } from '../../../examples/bowling/bowl'
import * as lane from '../../../examples/bowling/lane'
import { inHand } from '../../../examples/character'
import { GRIP as FOIL, foil } from '../../../examples/fencing/foil'
import { guard, lunge } from '../../../examples/fencing/lunge'
import { targetAt } from '../../../examples/fencing/target'
import { person } from '../../../examples/person'
import { Body } from '../src'

/** plays a story to its end, telling what `each` saw after every frame */
function played(body: Body, each: () => void) {
  for (let t = 0; t < 10 && body.playing; t += 1 / 60) {
    body.update(1 / 60)
    each()
  }
}

test('lunging, the fencer keeps his chest up: he reaches with the legs and the arm, not by pitching his trunk over', () => {
  const rig = person()
  const sword = foil()
  new Scene().add(rig, sword)
  const hand = new Hand(rig, 'right')
  const body = new Body(rig)
  const held = inHand(body, hand, grip(hand, sword, FOIL))
  body.play(
    (function* () {
      yield* guard(body, held)
      yield* lunge(body, held, targetAt(2.3))
    })(),
  )
  let pitched = 0
  played(body, () => (pitched = Math.max(pitched, body.trunk.value.x)))
  // (it pitched 0.74 rad, nearly flat, when posture guessed reach with a lever)
  expect(pitched).toBeLessThan(0.35)
})

test('bowling, he gets down to the boards over the slide without kneeling, and the ball leaves the hand where it was planned', () => {
  const rig = person()
  const ball = lane.sphere()
  new Scene().add(rig, ball)
  const hands = { left: new Hand(rig, 'left'), right: new Hand(rig, 'right') }
  const body = new Body(rig)
  const held = inHand(body, hands.right, grip(hands.right, ball, lane.GRIP))
  let [lowest, off] = [Infinity, Infinity]
  body.play(
    (function* () {
      yield* carry(body, held, grip(hands.left, ball, SIDE.left))
      yield* bowl(body, held, () => (off = body.intent().gaps.find(({ name }) => name === 'right hand')!.planned.distanceTo(body.intent().gaps.find(({ name }) => name === 'right hand')!.posed)))
    })(),
  )
  played(body, () => (lowest = Math.min(lowest, body.hips.value.y)))
  // (he knelt, hips at a third of standing, and the hand was 31-42 cm off its plan at the release)
  expect(lowest / body.size.stand).toBeGreaterThan(0.4)
  expect(off).toBeLessThan(0.1)
})
