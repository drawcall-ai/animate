import { grip, Hand } from '@drawcall/hand'
import { Scene, Vector3 } from 'three'
import { expect, test } from 'vitest'
import { bowl, carry, SIDE } from '../../../examples/bowling/bowl'
import { GRIP, sphere } from '../../../examples/bowling/lane'
import { inHand } from '../../../examples/character'
import { Body } from '../src'
import { tick } from '../src/rig/size'
import { person } from '../../../examples/person'

test('the delivery: the ball sent leaves as written, the body does the rest, and he ends standing', () => {
  const man = person()
  const drawn = sphere()
  new Scene().add(man, drawn)
  const hands = { left: new Hand(man, 'left'), right: new Hand(man, 'right') }
  const body = new Body(man)
  const held = inHand(body, hands.right, grip(hands.right, drawn, GRIP))
  let velocity: Vector3 | undefined
  body.play(
    (function* () {
      yield* carry(body, held, grip(hands.left, drawn, SIDE.left))
      yield* bowl(body, held, (leaves) => (velocity = leaves))
    })(),
  )
  let released: { left: number; right: number } | undefined
  let [back, topped, leaves] = [0, 0, 0]
  for (let n = 0; n < 3000 && body.playing; n++) {
    body.update(tick(body.size))
    const behind = body.hand.right.value.z - body.hips.value.z
    if (!velocity && behind < back) [back, topped] = [behind, body.time]
    else if (velocity) released ??= { left: body.foot.left.value.z, right: body.foot.right.value.z }
    if (velocity && !leaves) leaves = body.time
  }
  // (the backswing tops out during the last strides, not once he is down at the line)
  expect(leaves - topped).toBeGreaterThan(0.25)
  // written: the ball leaves at 7 m/s forward
  expect(velocity?.z).toBeCloseTo(7, 0)
  expect(Math.hypot(velocity?.x ?? NaN, velocity?.y ?? NaN)).toBeLessThan(0.5)
  // not written: the hand swings back behind the hips first, and he lets go over the left foot, the right a stride behind
  expect(back).toBeLessThan(-0.1)
  expect(released?.left).toBeGreaterThan((released?.right ?? NaN) + 0.45)
  expect(body.playing).toBe(false)
  expect(body.hips.value.y).toBeCloseTo(body.size.stand, 1)
  expect(Math.abs(body.foot.left.value.z - body.foot.right.value.z)).toBeLessThan(0.11)
})
