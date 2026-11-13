import { expect, test } from 'vitest'
import { Body, type Story } from '../src'
import { tick } from '../src/size'
import { person } from '../examples/person'

/** a walk, a stance on a foot put ahead, a reach for the ground and a jump: all of it counted in his own sizes */
function* story(body: Body): Story {
  const { stand, leg } = body.size
  yield* body.walk(2.5 * leg)
  yield* body.foot.right.to(body.ground('right', body.foot.left.value.z + 0.6 * leg))
  yield* body.hand.right.to({ x: -0.2 * leg, y: 0.3 * leg, z: body.foot.right.value.z + 0.2 * leg })
  yield* body.stand()
  yield* body.jump({ x: 0, y: stand + 0.35 * leg, z: body.hips.value.z + 0.6 * leg })
  yield* body.stand()
}

/** where the hips and a hand are, a step of his time after another, on a person so many times as large: in lengths of his leg */
function track(scale: number) {
  const body = new Body(person(scale))
  const steps = []
  body.play(story(body))
  while (body.playing) {
    body.update(tick(body.size))
    steps.push([body.hips.value, body.hand.right.value].map((at) => at.clone().divideScalar(body.size.leg)))
  }
  return steps
}

test('a body half as large and one half as large again make the motion a man makes, in their own lengths and their own time', () => {
  const man = track(1)
  // he walked, got down and jumped
  expect(man.at(-1)?.[0].z).toBeGreaterThan(3.5)
  expect(Math.min(...man.map(([hips]) => hips.y))).toBeLessThan(0.75)
  expect(Math.max(...man.map(([hips]) => hips.y))).toBeGreaterThan(1.4)
  for (const scale of [0.5, 1.5]) {
    const other = track(scale)
    expect(other.length).toBe(man.length)
    const off = other.flatMap((step, k) => step.map((at, part) => at.distanceTo(man[k][part])))
    // (a larger body takes its beats in longer steps of time, and as many: they differ by what numbers round to)
    expect(Math.max(...off)).toBeLessThan(1e-4)
  }
})
