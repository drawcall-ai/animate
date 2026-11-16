import { buildWorld } from '@drawcall/physics-rapier'
import { Scene } from 'three'
import { expect, test } from 'vitest'
import { court as hoops } from '../../../examples/basketball/court'
import { Hooper } from '../../../examples/basketball/hooper'
import { person } from '../../../examples/person'

test('shot from a dribble: the ball leaves his hand above his head at the top of the jump', async () => {
  const scene = new Scene()
  const world = await buildWorld({ scene })
  scene.add(hoops())
  const game = new Hooper(person(), scene)
  const { body } = game.character
  const F = 1 / 60
  const pressed = (t: number, at: number) => t >= at && t - F < at
  let left: { y: number; head: number; rising: number } | undefined
  for (let t = 0; t < 10 && !left; t += F) {
    // he walks up to the ball and picks it up, dribbles it walking on, and shoots while dribbling
    const walking = t < 0.75 || (t > 4.5 && t < 7.6)
    game.update(F, { move: { x: 0, z: walking ? 1 : 0 }, run: false, act: pressed(t, 1.2) || pressed(t, 6.4), held: new Set() })
    world.update(F)
    if (game.ball.free && t > 6.4) left = { y: game.ball.place.y, head: body.eye('left').y, rising: body.hips.velocity.y }
  }
  expect(left).toBeDefined()
  expect(left!.y).toBeGreaterThan(left!.head)
  // (at the top: the hips neither rising nor falling much; it left from the hip, standing, before)
  expect(Math.abs(left!.rising)).toBeLessThan(0.5)
}, 30000)
