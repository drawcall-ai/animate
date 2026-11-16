import { buildWorld } from '@drawcall/physics-rapier'
import { Scene } from 'three'
import { expect, test } from 'vitest'
import { field } from '../../../examples/football/field'
import { Footballer } from '../../../examples/football/footballer'
import { ballAt, fly } from '../../../examples/football/pitch'
import { shot } from '../../../examples/football/shot'
import { Body } from '../src'
import { person } from '../../../examples/person'
import { SIDES } from '@drawcall/gait'
import { tick } from '../src/rig/size'

const FRAME = 1 / 60
const degrees = (angle: number) => (angle * 180) / Math.PI

test('the shot: what is written holds at the strike, the body does the rest, and he ends standing', () => {
  const body = new Body(person())
  const ball = ballAt(5.2)
  body.play(shot(body, ball))
  let struck: { speed: number; up: number; plant: number } | undefined
  let [drawn, risen, back, dropped] = [0, 0, 0, 0]
  const was = body.foot.right.value.clone()
  const steps: string[] = []
  const stood = { left: true, right: true }
  for (let n = 0; n < 2000 && body.playing; n++) {
    body.update(tick(body.size))
    fly(ball, tick(body.size))
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
    // (on its way down after the kick, the foot comes down as fast as a swung leg goes, never in a frame)
    if (struck && body.foot.right.value.y < risen - 0.05) dropped = Math.max(dropped, body.foot.right.value.distanceTo(was) / tick(body.size))
    was.copy(body.foot.right.value)
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
  expect(risen).toBeGreaterThan(0.25)
  expect(back).toBeLessThan(-10)
  expect(dropped).toBeLessThan(8)
  expect(body.playing).toBe(false)
  expect(body.hips.value.y).toBeCloseTo(body.size.stand, 1)
  // feet side by side: within a tenth of a metre of each other
  expect(Math.abs(body.foot.left.value.z - body.foot.right.value.z)).toBeLessThan(0.11)
})

test('Space while dribbling, at a run or a walk and from either side of the goal: he meets the ball where it has rolled to and shoots', async () => {
  const shots = [
    { way: 0, run: true, at: 1 },
    { way: 0.5, run: true, at: 1.2 },
    { way: -0.3, run: true, at: 0.8 },
    { way: 0, run: false, at: 1.6 },
  ]
  for (const { way, run, at } of shots) {
    const scene = new Scene()
    const world = await buildWorld({ scene })
    scene.add(field())
    const game = Footballer.start(person(), scene)
    let fastest = 0
    for (let t = 0; t < at + 3; t += FRAME) {
      const move = t < at ? { x: Math.sin(way), z: Math.cos(way) } : { x: 0, z: 0 }
      game.update(FRAME, { move, run, act: t >= at && t - FRAME < at, held: new Set() })
      world.update(FRAME)
      if (t >= at) fastest = Math.max(fastest, game.ball.velocity.length())
    }
    // (a touch sends it at most 9 m/s; a shot over 20)
    expect(fastest, `${way} ${run}`).toBeGreaterThan(15)
  }
}, 30000)
