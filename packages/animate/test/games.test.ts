import { buildWorld } from '@drawcall/physics-rapier'
import { Scene } from 'three'
import { expect, test } from 'vitest'
import { person } from '../../../examples/person'
import type { Game, Input } from '../../../examples/play'
import { Boxer } from '../../../examples/boxing/boxer'
import { Worker } from '../../../examples/shelf/worker'

const FRAME = 1 / 60

/** plays a game by its own input: keys held over spans of time (s), Space pressed at moments; tells what `each` saw */
function play(game: Game, world: { update(dt: number): void }, seconds: number, moves: [from: number, to: number, x: number, z: number][], acts: number[], each = (_t: number) => {}) {
  for (let t = 0; t < seconds; t += FRAME) {
    const move = moves.find(([from, to]) => t >= from && t < to) ?? [0, 0, 0, 0]
    const act = acts.some((at) => t <= at && at < t + FRAME)
    const input: Input = { move: { x: move[2], z: move[3] }, run: false, act, held: new Set() }
    game.update(FRAME, input)
    world.update(FRAME)
    each(t)
  }
}

test('shelf: Space by a box on the floor takes it up in both hands, he carries it to the shelf, and Space there puts it on a board', async () => {
  const scene = new Scene()
  const world = await buildWorld({ scene })
  const worker = new Worker(person(), world, scene)
  let carried = 0
  let lowest = Infinity
  play(worker, world, 13, [[0.3, 0.9, 0, 1], [5.5, 6, -1, 1], [6, 6.6, 0, 1]], [1.2, 7.5], (t) => {
    if (/carrying/.test(worker.readout())) carried += FRAME
    if (t > 5.5 && t < 7.5) lowest = Math.min(lowest, worker.character.body.hips.value.y)
  })
  expect(carried).toBeGreaterThan(1)
  // (carrying it, he walks upright)
  expect(lowest / worker.character.body.size.stand).toBeGreaterThan(0.85)
  expect(worker.readout()).toMatch(/shelf\s+1 of 3/)
}, 30000)

test('boxing: walking at the bag he stops an arm\'s length from it, and the punches Space throws there land and swing it', async () => {
  const scene = new Scene()
  const world = await buildWorld({ scene })
  const boxer = new Boxer(person(), scene)
  let nearest = Infinity
  play(boxer, world, 5, [[0.2, 2, 0, 1]], [2.5, 3, 3.5, 4], () => {
    nearest = Math.min(nearest, Number(/([\d.]+) m away/.exec(boxer.readout())?.[1]))
  })
  expect(nearest).toBeGreaterThan(0.3)
  expect(Number(/landed\s+(\d+)/.exec(boxer.readout())?.[1])).toBeGreaterThanOrEqual(3)
}, 30000)
