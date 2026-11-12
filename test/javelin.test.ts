import RAPIER from '@dimforge/rapier3d-compat'
import { expect, test } from 'vitest'
import { field, flight, hold, released } from '../examples/javelin/field'
import { javelinThrow } from '../examples/javelin/throw'
import { Humanoid, STEP } from '../src'

await RAPIER.init()

test('the javelin leaves at the speed asked, forward and up, and the thrower ends standing', () => {
  const { world, javelin } = field()
  const human = new Humanoid(world)
  const held = hold(human, javelin)
  let left: ReturnType<typeof flight> | undefined
  human.play(javelinThrow(human, held, 12))
  for (let n = 0; n < 5 / STEP && human.playing; n++) {
    human.step()
    if (!left && released(world, held) !== undefined) left = flight(javelin)
  }
  expect(Math.abs((left?.speed ?? 0) - 12)).toBeLessThan(0.5)
  expect(left?.forward).toBe(true)
  expect(left?.angle).toBeGreaterThan(0.3)
  expect(left?.angle).toBeLessThan(0.65)
  expect(human.playing).toBe(false)
  expect(human.parts.head.body.translation().y).toBeGreaterThan(1.6)
})
