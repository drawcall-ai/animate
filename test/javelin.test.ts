import { expect, test } from 'vitest'
import { fly, javelin } from '../examples/javelin/field'
import { javelinThrow } from '../examples/javelin/throw'
import { Body } from '../src'
import { person } from '../examples/person'

test('the throw: the javelin leaves the hand as written, and he ends standing', () => {
  const body = new Body(person())
  const thrown = javelin()
  body.play(javelinThrow(body, thrown))
  let left: { speed: number; up: number } | undefined
  for (let n = 0; n < 600 && body.playing; n++) {
    body.update(1 / 60)
    fly(thrown, 1 / 60)
    if (thrown.velocity && !left)
      left = { speed: thrown.velocity.length(), up: (Math.atan2(thrown.velocity.y, thrown.velocity.z) * 180) / Math.PI }
  }
  // written: 20 m/s, 30° up; read after it has flown for one update, which has taken 0.16 m/s off its speed up
  expect(left?.speed).toBeCloseTo(20, 0)
  expect(Math.abs((left?.up ?? 0) - 30)).toBeLessThan(1)
  expect(body.playing).toBe(false)
  expect(body.hips.value.y).toBeCloseTo(body.size.stand, 1)
  // feet side by side: within a tenth of a metre of each other
  expect(Math.abs(body.foot.left.value.z - body.foot.right.value.z)).toBeLessThan(0.11)
})
