import RAPIER from '@dimforge/rapier3d-compat'
import { expect, test } from 'vitest'
import { pitch, launch } from '../examples/football/pitch'
import { shot } from '../examples/football/shot'
import { Humanoid, STEP, type Solution } from '../src'

await RAPIER.init()

function shoot(speed: number) {
  const { world, ball } = pitch()
  const human = new Humanoid(world)
  let kick: Solution | undefined
  let left: number | undefined
  human.play(function* () {
    kick = yield* shot(human, ball, speed)
  })
  for (let n = 0; n < 5 / STEP && human.playing; n++) {
    human.step()
    left ??= launch(ball)
  }
  return { human, kick, left }
}

test('the ball leaves at the speed asked and the player ends standing', () => {
  const { human, kick, left } = shoot(20)
  expect(kick?.ok).toBe(true)
  expect(Math.abs((left ?? 0) - 20)).toBeLessThan(0.5)
  expect(human.playing).toBe(false)
  expect(human.parts.head.body.translation().y).toBeGreaterThan(1.6)
})

test('a speed out of reach is reported, with what is in reach, and no shot is taken', () => {
  const { kick, left } = shoot(40)
  expect(kick?.ok).toBe(false)
  expect(kick?.reachable[1]).toBeLessThan(40)
  expect(left).toBeUndefined()
})
