import { expect, test } from 'vitest'
import { ballAt, fly } from '../examples/football/pitch'
import { shot } from '../examples/football/shot'
import { Body, STAND } from '../src'
import { SIDES } from '../src/size'

const degrees = (angle: number) => (angle * 180) / Math.PI

test('the shot: what is written holds at the strike, the body does the rest, and he ends standing', () => {
  const body = new Body()
  const ball = ballAt(5.2)
  body.play(shot(body, ball))
  let struck: { speed: number; up: number; plant: number } | undefined
  let [drawn, risen, back] = [0, 0, 0]
  const steps: string[] = []
  const stood = { left: true, right: true }
  for (let n = 0; n < 2000 && body.playing; n++) {
    body.update(1 / 200)
    fly(ball, 1 / 200)
    for (const side of SIDES) {
      const stands = body.foot[side].anchor !== undefined
      if (stands && !stood[side] && !struck) steps.push(side)
      stood[side] = stands
    }
    if (!struck && ball.velocity.lengthSq() > 0) {
      const up = degrees(Math.atan2(ball.velocity.y, ball.velocity.z))
      struck = { speed: ball.velocity.length(), up, plant: (body.foot.left.anchor?.z ?? NaN) - 5.2 }
    }
    if (struck) risen = Math.max(risen, body.foot.right.value.y)
    else drawn = Math.max(drawn, body.foot.right.value.y)
    back = Math.min(back, degrees(body.trunk.value.x))
  }
  // written: the foot meets the ball at 20 m/s rising 8.6°, which sends it off at 27, with the left foot beside it
  expect(struck?.speed).toBeCloseTo(27, 0)
  expect(struck?.up).toBeCloseTo(8.6, 0)
  expect(struck?.plant).toBeCloseTo(-0.35, 1)
  // not written: the strides come out one foot after the other onto the planted one, the right foot is drawn up
  // behind him first and swings on up after, and he leans back against it
  expect(steps.every((side, k) => side !== steps[k - 1])).toBe(true)
  expect(steps.at(-1)).toBe('left')
  expect(drawn).toBeGreaterThan(0.2)
  expect(risen).toBeGreaterThan(0.3)
  expect(back).toBeLessThan(-10)
  expect(body.playing).toBe(false)
  expect(body.hips.value.y).toBeCloseTo(STAND, 1)
  // feet side by side: within a tenth of a metre of each other
  expect(Math.abs(body.foot.left.value.z - body.foot.right.value.z)).toBeLessThan(0.11)
})
