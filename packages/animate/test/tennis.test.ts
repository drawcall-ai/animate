import { buildWorld } from '@drawcall/physics-rapier'
import { Scene } from 'three'
import { expect, test } from 'vitest'
import { court } from '../../../examples/tennis/court'
import { Player } from '../../../examples/tennis/player'
import { person } from '../../../examples/person'

test('the game: a forehand and then a backhand at the balls fed send both over the net', async () => {
  const scene = new Scene()
  const world = await buildWorld({ scene })
  scene.add(court())
  const player = new Player(person(), scene)
  const F = 1 / 60
  for (let t = 0; t < 8.5; t += F) {
    player.update(F, { move: { x: 0, z: 0 }, run: false, act: [1.8, 5.8].some((at) => t >= at && t - F < at), held: new Set() })
    world.update(F)
  }
  // (the backhand missed: the strings came 17–26 cm short of the ball across his body)
  expect(player.readout()).toMatch(/over the net 2/)
}, 30000)
