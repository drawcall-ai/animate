import { RigidBody } from '@drawcall/physics'
import { buildWorld } from '@drawcall/physics-rapier'
import { BoxGeometry, Mesh, Scene } from 'three'
import { expect, test } from 'vitest'
import { Character } from '../../../examples/character'
import { yard } from '../../../examples/led/yard'
import { person } from '../../../examples/person'
import type { Game, Input } from '../../../examples/play'
import { Boxer } from '../../../examples/boxing/boxer'
import { Gladiator } from '../../../examples/gladiator/gladiator'
import { Hurdler } from '../../../examples/hurdles/hurdler'
import { HEIGHT, stand, track } from '../../../examples/hurdles/track'
import { Worker } from '../../../examples/shelf/worker'
import { NET } from '../../../examples/volleyball/ball'
import { court } from '../../../examples/volleyball/court'
import { Spiker } from '../../../examples/volleyball/spiker'

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
  let [nearest, throwing] = [Infinity, 0]
  play(boxer, world, 5, [[0.2, 2, 0, 1]], [2.5, 3, 3.5, 4], () => {
    nearest = Math.min(nearest, Number(/([\d.]+) m away/.exec(boxer.readout())?.[1]))
    if (/boxer\s+(jab|cross|hook)/.test(boxer.readout())) throwing += FRAME
  })
  // (each punch thrown at once)
  expect(throwing / 4).toBeLessThan(0.35)
  expect(nearest).toBeGreaterThan(0.3)
  expect(Number(/landed\s+(\d+)/.exec(boxer.readout())?.[1])).toBeGreaterThanOrEqual(3)
}, 30000)

test('gladiator: a press during a blow gives the next blow after it, and between blows he is back in his guard', async () => {
  const scene = new Scene()
  const world = await buildWorld({ scene })
  const floor = new RigidBody({ bodyType: 'static' })
  floor.position.y = -0.1
  scene.add(floor.add(new Mesh(new BoxGeometry(20, 0.2, 20))))
  const things = { gladius: new Mesh(new BoxGeometry(0.05, 0.02, 0.6)), scutum: new Mesh(new BoxGeometry(0.6, 0.05, 1)) }
  const gladiator = new Gladiator(person(), world, scene, things)
  const blows: string[] = []
  let between = Infinity
  play(gladiator, world, 6, [], [0.5, 1, 3.4], () => {
    const blow = /(cut|thrust)[\w ]*$/.exec(gladiator.readout())?.[0]
    if (blow && blow !== blows.at(-1)) blows.push(blow)
    if (!gladiator.character.acting) between = Math.min(between, gladiator.character.body.hips.value.y)
  })
  expect(blows.length).toBe(3)
  expect(between / gladiator.character.body.size.stand).toBeGreaterThan(0.95)
}, 30000)

test('led: down off the first platform into the gap he stands on its floor; walking into the second platform he stays on the ground, never in the air for a frame, and Space takes him up onto it', async () => {
  const scene = new Scene()
  const world = await buildWorld({ scene })
  scene.add(yard())
  const character = new Character(person(), world)
  let [lifted, frames, above] = [0, 0, 0]
  for (let t = 0; t < 8; t += FRAME) {
    if (Math.abs(t - 7) < FRAME / 2) character.jump(5)
    character.update(FRAME, { x: 0, z: 1.5 })
    world.update(FRAME)
    // (up the stairs, along the first platform, down into the gap and against the wall)
    if (t > 5 && t < 7) [lifted, frames, above] = [lifted + Number(!character.capsule.grounded), frames + 1, Math.max(above, character.body.hips.value.y - character.capsule.position.y)]
  }
  expect(frames).toBeGreaterThan(100)
  expect(lifted).toBe(0)
  // (his hips as high over the floor of the gap as he stands: he stood 0.64 m above it on his feet's height before he fell)
  expect(above).toBeLessThan(1.05 * character.body.size.stand)
  expect(character.capsule.position.y).toBeGreaterThan(0.85)
}, 30000)

test('volleyball: a spike lands short of the net, on his own side of it, and the ball goes over', async () => {
  const scene = new Scene()
  const world = await buildWorld({ scene })
  scene.add(court())
  const spiker = new Spiker(person(), world, scene)
  let furthest = -Infinity
  play(spiker, world, 5, [], [0.5], () => {
    const { gait } = spiker.character.body
    furthest = Math.max(furthest, spiker.character.body.hips.value.z, ...(['left', 'right'] as const).map((side) => gait.feet[side].value.z))
  })
  expect(spiker.readout()).toContain('spiked')
  expect(furthest).toBeLessThan(NET.z - 0.1)
}, 30000)

test('hurdles: run at the hurdles pressing Space, he clears them in a hurdling stride: over the bar the lead foot reaches out ahead of him', async () => {
  const scene = new Scene()
  const world = await buildWorld({ scene })
  const hurdles = track(3).map((hurdle) => ({ hurdle, solid: stand(hurdle) }))
  scene.add(...hurdles.map(({ solid }) => solid))
  const hurdler = new Hurdler(person(), hurdles)
  let reach = 0
  // (Space every tenth of a second: it is taken once he is near enough a hurdle and not already over one)
  for (let t = 0; t < 10; t += FRAME) {
    hurdler.update(FRAME, { move: { x: 0, z: 1 }, run: true, act: Math.round(t / FRAME) % 6 === 0, held: new Set() })
    world.update(FRAME)
    const { body } = hurdler.character
    // (the lead foot ahead of the hips, the way he runs, while it is above a hurdle's height)
    if (body.foot.right.value.y > HEIGHT) reach = Math.max(reach, body.foot.right.value.z - body.hips.value.z)
  }
  expect(hurdler.readout()).toContain('cleared 3')
  expect(reach).toBeGreaterThan(0.5 * hurdler.character.body.size.leg)
}, 30000)
