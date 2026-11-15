import { Vector3 } from 'three'
import { expect, test } from 'vitest'
import { Body } from '../src'
import { tick } from '../src/size'
import { person } from '../../../examples/person'

const step = (body: Body, seconds: number) => {
  for (let n = 0; n < seconds * 60; n++) body.update(1 / 60)
}

test('a hand asked to arrive faster than it can arrives as fast as it can; a trunk asked for more says so', () => {
  const body = new Body(person())
  const hand = body.hand.right
  const moving = new Vector3()
  body.play(
    (function* () {
      yield* hand.by(0.3, new Vector3(-0.2, 1.6, 0.3), { velocity: new Vector3(0, 0, 80) })
      moving.copy(hand.velocity)
    })(),
  )
  while (body.playing) body.update(tick(body.size))
  expect(moving.z).toBeGreaterThan(1)
  expect(moving.z).toBeLessThan(80)

  // (a part given too little time is there as soon after as it can be)
  const leaning = new Body(person())
  let late = 0
  leaning.play(
    (function* () {
      yield* leaning.trunk.to(new Vector3(0.8, 0, 0), { seconds: 0.05 })
      late = leaning.time
    })(),
  )
  while (leaning.playing) leaning.update(tick(leaning.size))
  expect(late).toBeGreaterThan(0.2)
  expect(leaning.trunk.value.x).toBeCloseTo(0.8, 2)
})

test('a part told to be somewhere by a moment waits, draws back before a fast arrival, and is there as asked', () => {
  const body = new Body(person())
  const hand = body.hand.right
  const [at, moving] = [new Vector3(), new Vector3()]
  body.play(
    (function* () {
      yield* hand.by(1, new Vector3(-0.2, 0.9, 0.3), { velocity: new Vector3(0, 4, 10) })
      at.copy(hand.value)
      moving.copy(hand.velocity)
    })(),
  )
  step(body, 0.5)
  // halfway there the arm has not set off: the hand only goes with the trunk, which has begun to draw back
  expect(hand.velocity.length()).toBeLessThan(0.6)
  let back = Infinity
  while (body.playing) {
    body.update(1 / 60)
    back = Math.min(back, hand.value.z)
  }
  expect(back).toBeLessThan(-0.05)
  expect(at.z).toBeCloseTo(0.3, 2)
  expect(moving.z).toBeCloseTo(10, 0)
  expect(moving.y).toBeCloseTo(4, 0)
})

test('what a hand is sent to is carried out in the order it was sent', () => {
  const body = new Body(person())
  const hand = body.hand.right
  let [carried, thrown] = [false, false]
  body.play(
    (function* () {
      // stated without waiting for it, then sent on: it is there first, and stays until it has to set off again
      const first = hand.to(new Vector3(0, -0.3, 0.3), { on: body })
      const then = hand.by(2, new Vector3(-0.2, 1.3, 0.5), { velocity: new Vector3(0, 0, 3) })
      carried = yield* first
      thrown = yield* then
    })(),
  )
  step(body, 1)
  expect(hand.value.y).toBeCloseTo(body.hips.value.y + 0.47 - 0.3, 1)
  while (body.playing) body.update(1 / 60)
  expect(carried).toBe(true)
  expect(thrown).toBe(true)
})

test('a hand sent somewhere by a moment and then on with no time is at the first place at its moment, and then at the second', () => {
  const body = new Body(person())
  const hand = body.hand.right
  const [high, low] = [new Vector3(-0.2, 1.5, 0.4), new Vector3(-0.3, 1, 0.3)]
  let [first, second] = [false, false]
  const at = new Vector3()
  body.play(
    (function* () {
      const up = hand.by(1, high)
      const down = hand.to(low)
      first = yield* up
      at.copy(hand.value)
      second = yield* down
    })(),
  )
  while (body.playing) body.update(tick(body.size))
  expect(first).toBe(true)
  expect(at.distanceTo(high)).toBeLessThan(0.02)
  expect(second).toBe(true)
  expect(body.time).toBeGreaterThan(1)
  expect(hand.value.distanceTo(low)).toBeLessThan(0.02)
})

test('a moment is the first step of his time at or after it, for a hand that is to be somewhere by it and a story that waits for it', () => {
  const body = new Body(person())
  const hand = body.hand.right
  const moving = new Vector3(0, 1, 8)
  let speed = 0
  body.play(
    (function* () {
      hand.by(0.332, { x: 0, y: -0.1, z: 0.45 }, { on: body, velocity: moving })
      yield* body.until(0.332)
      speed = hand.velocity.length()
    })(),
  )
  while (body.playing) body.update(tick(body.size))
  expect(speed).toBeCloseTo(moving.length(), 0)
})
