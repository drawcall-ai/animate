import { grip, Hand } from '@drawcall/hand'
import { Scene } from 'three'
import { expect, test } from 'vitest'
import { bowl } from '../../../examples/bowling/bowl'
import { ball as ballAt, GRIP, sphere } from '../../../examples/bowling/lane'
import { holds } from '../../../examples/character'
import { Body } from '../src'
import { tick } from '../src/size'
import { person } from '../../../examples/person'

test('the delivery: the ball leaves as written, the body does the rest, and he ends standing', () => {
  const man = person()
  const drawn = sphere()
  new Scene().add(man, drawn)
  const hand = new Hand(man, 'right')
  const gripped = grip(hand, drawn, GRIP)
  const body = new Body(man)
  const held = holds(body, hand, gripped)
  const ball = ballAt()
  body.play(bowl(body, ball, drawn, held))
  let released: { left: number; right: number } | undefined
  let back = 0
  for (let n = 0; n < 2000 && body.playing; n++) {
    body.update(tick(body.size))
    if (!ball.velocity) back = Math.min(back, body.hand.right.value.z - body.hips.value.z)
    else released ??= { left: body.foot.left.value.z, right: body.foot.right.value.z }
  }
  // written: the hand lets the ball go at 7 m/s forward
  expect(ball.velocity?.z).toBeCloseTo(7, 0)
  expect(Math.hypot(ball.velocity?.x ?? NaN, ball.velocity?.y ?? NaN)).toBeLessThan(0.5)
  // not written: the hand swings back behind the hips first, and he lets go over the left foot, the right a stride behind
  expect(back).toBeLessThan(-0.1)
  expect(released?.left).toBeGreaterThan((released?.right ?? NaN) + 0.45)
  expect(body.playing).toBe(false)
  expect(body.hips.value.y).toBeCloseTo(body.size.stand, 1)
  expect(Math.abs(body.foot.left.value.z - body.foot.right.value.z)).toBeLessThan(0.11)
})
