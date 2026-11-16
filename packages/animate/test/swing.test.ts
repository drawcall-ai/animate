import { grip, Hand } from '@drawcall/hand'
import { Mesh, Scene, SphereGeometry, Vector3 } from 'three'
import { expect, test } from 'vitest'
import { RADIUS } from '../../../examples/basketball/ball'
import { SEAT, jumpShot } from '../../../examples/basketball/shot'
import { inHand } from '../../../examples/character'
import { person } from '../../../examples/person'
import * as shelf from '../../../examples/shelf/box'
import { shelve } from '../../../examples/shelf/shelve'
import { type Mark, Body } from '../src'

const FRAME = 1 / 60

/** where a way of marks has its place at a moment, if the moment is on it */
function along(path: readonly Mark[], time: number) {
  const next = path.findIndex((mark) => mark.time >= time)
  if (next <= 0) return undefined
  const [from, to] = [path[next - 1], path[next]]
  return from.at.clone().lerp(to.at, (time - from.time) / (to.time - from.time))
}

test('a jump shot goes the way its plan has it: the ball in the hand never more than 5 cm off the way first planned, and leaves as fast as planned', () => {
  const rig = person()
  const ball = new Mesh(new SphereGeometry(RADIUS))
  new Scene().add(rig, ball)
  const hand = new Hand(rig, 'right')
  const body = new Body(rig)
  const held = inHand(body, hand, grip(hand, ball, SEAT))
  let left: Vector3 | undefined
  body.play(jumpShot(body, held, (velocity) => (left = velocity)))
  let first: { time: number; path: Mark[]; speed: number } | undefined
  let worst = 0
  while (body.playing && !left) {
    body.update(FRAME)
    // the ball's plan: its way ahead, a thirtieth of a second a mark, and the frame it is sent to
    const plan = body.intent().channels.find(({ frames }) => frames.some(({ velocity }) => velocity.length() > 1))
    const moving = plan?.frames.find(({ velocity }) => velocity.length() > 1)
    if (plan && moving && !first) first = { time: body.time, path: plan.path.map((at, k) => ({ at: at.clone(), time: body.time + k / 30 })), speed: moving.velocity.length() }
    const planned = first && along(first.path, body.time)
    if (planned) worst = Math.max(worst, planned.distanceTo(ball.getWorldPosition(new Vector3())))
  }
  expect(worst).toBeLessThan(0.05)
  expect(left?.length()).toBeCloseTo(first?.speed ?? NaN, 0)
})

test('a hand sent fast where the arm can only just reach still arrives moving the way it was sent', () => {
  const body = new Body(person())
  for (let t = 0; t < 0.5; t += FRAME) body.update(FRAME)
  const place = new Vector3(-0.2, 1.3, 0.3)
  let velocity = new Vector3()
  const sent = body.hand.right.to(place, { velocity: { x: 0, y: 0, z: 10 } })
  body.play(
    (function* () {
      yield* sent
      velocity = body.hand.right.velocity.clone()
    })(),
  )
  for (let t = 0; t < 2 && body.playing; t += FRAME) body.update(FRAME)
  expect(velocity.z).toBeGreaterThan(5)
  expect(body.hand.right.value.distanceTo(place)).toBeLessThan(0.6)
})

test('down for a box on the floor, he comes up once it is lifted, and walks it to the shelf upright', () => {
  const rig = person()
  const box = shelf.boxAt(2)
  new Scene().add(rig, box.mesh)
  const body = new Body(rig)
  body.play(shelve(body, box, { left: new Hand(rig, 'left'), right: new Hand(rig, 'right') }))
  let lowest = Infinity
  for (let t = 0; t < 30 && body.playing; t += FRAME) {
    body.update(FRAME)
    shelf.fall(box, FRAME)
    // (on his way to the shelf with it)
    if (box.held && body.hips.value.z > 2.6 && body.hips.value.z < 3.6) lowest = Math.min(lowest, body.hips.value.y)
  }
  expect(lowest).toBeGreaterThan(0.9 * body.size.stand)
})
