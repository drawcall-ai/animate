import { expect, test } from 'vitest'
import { STEP, deg } from '../src'
import { FOUL_LINE, fly } from '../examples/javelin/field'
import { javelinThrow, thrower } from '../examples/javelin/throw'

test('the javelin leaves at the speed and angle asked, and he stops before the foul line', () => {
  const actor = thrower()
  const { javelin } = actor.world
  actor.play(javelinThrow(actor))
  let lowest = Infinity
  for (let n = 0; n < 6 / STEP && (actor.playing || !javelin.stuck); n++) {
    actor.update(STEP)
    fly(javelin, STEP)
    lowest = Math.min(lowest, actor.figure.hips.p.y)
  }
  const velocity = actor.world.released?.velocity ?? { x: 0, y: 0 }
  expect(Math.hypot(velocity.x, velocity.y)).toBeCloseTo(28, 0)
  expect(deg(Math.atan2(velocity.y, velocity.x))).toBeGreaterThan(25)
  expect(deg(Math.atan2(velocity.y, velocity.x))).toBeLessThan(40)
  expect(actor.playing).toBe(false)
  expect(lowest).toBeGreaterThan(0.6)
  expect(actor.figure.hips.p.x).toBeLessThan(FOUL_LINE)
})
