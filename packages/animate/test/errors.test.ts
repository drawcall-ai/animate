import { Group, Object3D } from 'three'
import { expect, test } from 'vitest'
import { person } from '../../../examples/person'
import { Body, type Story } from '../src'
import { tick } from '../src/size'

const FRAME = 1 / 60
const HERE = { x: 0, y: 0, z: 0 }

function setup() {
  const scene = new Group()
  const rig = person()
  scene.add(rig)
  return { scene, rig, body: new Body(rig) }
}
/** the errors updating for so long throws, so long at a time */
function run(body: Body, seconds: number, each = (_: number) => {}, frame = FRAME) {
  const said: string[] = []
  for (let t = 0; t < seconds; t += frame) {
    each(t)
    try {
      body.update(frame)
    } catch (error) {
      said.push(String(error))
    }
  }
  return said
}

test('what cannot be done in a step is thrown once, after the step, and his clock goes on', () => {
  const { scene, body } = setup()
  const thing = new Object3D()
  thing.position.set(-0.25, 1.1, 0.35)
  scene.add(thing)
  const dt = tick(body.size)
  const when = Math.ceil(1 / dt) * dt
  body.hand.right.by(when, HERE, { on: thing, velocity: { x: 0, y: 0, z: 0.5 } })
  // (it is somewhere else at the very moment it was to be there, moving)
  const said = run(
    body,
    2,
    () => {
      if (Math.abs(body.time - when) < dt / 2) thing.position.y = 1.3
    },
    dt,
  )
  expect(said).toHaveLength(1)
  expect(said[0]).toMatch(/the right hand was to be/)
  expect(body.time).toBeGreaterThan(1.95)
})

test('a walk or a lead after a foot is put down steps off it', () => {
  const { body } = setup()
  body.foot.left.to(body.ground('left', 0.4))
  const said = run(body, 5, (t) => {
    if (t > 2) body.go({ x: 0, z: 1.3 })
  })
  expect(said).toEqual([])
  expect(body.hips.value.z).toBeGreaterThan(2)
})

test('a thing that leaves his scene is an error once, and one hanging from his own arm at once', () => {
  const { scene, rig, body } = setup()
  const holder = new Group()
  holder.position.set(0, 1, 0.3)
  scene.add(holder)
  const thing = new Object3D()
  thing.position.set(-0.2, 0.1, 0)
  holder.add(thing)
  body.hand.right.to(HERE, { on: thing })
  const said = run(body, 3, (t) => {
    if (Math.abs(t - 1.5) < FRAME / 2) holder.remove(thing)
  })
  expect(said).toHaveLength(1)
  expect(said[0]).toMatch(/not in the scene he is in/)
  const own = new Object3D()
  rig.getObjectByName('rightHand')?.add(own)
  expect(() => body.hand.right.to(HERE, { on: own })).toThrow(/hangs from its own limb/)
})

test('over feet put down, hips held higher than his legs reach them is an error at the statement', () => {
  const { body } = setup()
  let said = ''
  body.play(
    (function* (): Story {
      yield* body.foot.left.to(body.ground('left', 0.85))
      try {
        body.hips.to({ y: body.size.stand })
      } catch (error) {
        said = String(error)
      }
    })(),
  )
  expect(run(body, 4)).toEqual([])
  expect(said).toMatch(/his legs reach the feet where they were put from no higher than/)
})

test('a hand on a moving thing moves as it does', () => {
  const { scene, body } = setup()
  const thing = new Object3D()
  scene.add(thing)
  const pose = (t: number) => thing.position.set(-0.25 + 0.3 * Math.max(0, t - 1), 1.1, 0.35)
  pose(0)
  body.hand.right.to(HERE, { on: thing })
  let speed = 0
  expect(
    run(body, 1.6, (t) => {
      pose(t)
      speed = body.hand.right.velocity.x
    }),
  ).toEqual([])
  expect(speed).toBeCloseTo(0.3, 1)
})

test('what a story has stated stays when it ends', () => {
  const { body } = setup()
  const low = 0.8 * body.size.stand
  const there = { x: -0.15, y: -0.25, z: 0.35 }
  body.play(
    (function* (): Story {
      body.hips.to({ y: low })
      yield* body.hand.right.to(there, { on: body })
    })(),
  )
  expect(run(body, 4)).toEqual([])
  expect(body.playing).toBe(false)
  expect(body.hips.value.y).toBeCloseTo(low, 2)
  expect(body.hand.right.velocity.length()).toBeLessThan(0.01)
})
