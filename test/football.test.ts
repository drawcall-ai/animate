import { expect, test } from 'vitest'
import { STEP, leaning } from '../src'
import { fly } from '../examples/football/pitch'
import { player, shot } from '../examples/football/shot'

test('the shot leaves at the speed asked, goes in, and he ends standing upright', () => {
  const actor = player()
  const { ball } = actor.world
  actor.play(shot(actor))
  let lowest = Infinity
  for (let n = 0; n < 4 / STEP && (actor.playing || !ball.result); n++) {
    actor.update(STEP)
    fly(ball, STEP)
    lowest = Math.min(lowest, actor.figure.hips.p.y)
  }
  expect(actor.world.struck?.speed).toBeCloseTo(27, 0)
  expect(ball.result).toBe('in the goal')
  expect(actor.playing).toBe(false)
  expect(lowest).toBeGreaterThan(0.7)
  expect(Math.abs(leaning(actor.figure))).toBeLessThan(15)
})
