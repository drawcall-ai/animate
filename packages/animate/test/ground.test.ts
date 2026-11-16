import { Vector3 } from 'three'
import { expect, test } from 'vitest'
import { Body, type Story } from '../src'
import { person } from '../../../examples/person'
import { SIDES, type Side, tick } from '@drawcall/limbs'

/** plays a story to its end and tells the longest both feet were off the ground (s) and how high the hips got (m) */
function play(story: (body: Body) => Story) {
  const body = new Body(person())
  body.play(story(body))
  let [air, longest, high, fastest, jolt, quickest, last] = [0, 0, 0, 0, 0, Infinity, -Infinity]
  const went = { left: 0, right: 0 }
  const stood = { left: true, right: true }
  const was: Record<'foot' | 'hand', Partial<Record<Side, Vector3>>> = { foot: {}, hand: {} }
  for (let n = 0; n < 4000 && body.playing; n++) {
    body.update(tick(body.size))
    for (const side of SIDES) {
      for (const [kind, end] of [
        ['foot', body.foot[side]],
        ['hand', body.hand[side]],
      ] as const) {
        const before = (was[kind][side] ??= end.value.clone())
        const far = end.value.distanceTo(before)
        fastest = Math.max(fastest, far / tick(body.size))
        if (kind === 'foot') [jolt, went[side]] = [Math.max(jolt, Math.abs(far - went[side])), far]
        before.copy(end.value)
      }
      const stands = body.foot[side].anchor !== undefined
      if (stands && !stood[side]) [quickest, last] = [Math.min(quickest, body.time - last), body.time]
      stood[side] = stands
    }
    air = SIDES.some((side) => body.foot[side].anchor) ? 0 : air + tick(body.size)
    longest = Math.max(longest, air)
    high = Math.max(high, body.hips.value.y)
  }
  expect(body.playing).toBe(false)
  // nothing he is not asked to do fast is: a foot or a hand that leapt from one step of time to the next would be
  expect(fastest).toBeLessThan(26)
  expect(body.hips.value.y).toBeCloseTo(body.size.stand, 1)
  // feet side by side: within a tenth of a metre of each other
  expect(Math.abs(body.foot.left.value.z - body.foot.right.value.z)).toBeLessThan(0.11)
  return { body, longest, high, jolt, quickest }
}

test('at a walk he keeps a foot on the ground; at a run he is in the air between strides', () => {
  const walked = play(function* (body) {
    yield* body.walk(4)
    yield* body.stand()
  })
  expect(walked.longest).toBeLessThan(0.01)
  // a foot's speed changes by no more than 6 m/s from one step of time to the next, and feet step no quicker than feet do
  expect(walked.jolt).toBeLessThan(0.03)
  expect(walked.quickest).toBeGreaterThan(0.19)
  expect(walked.body.hips.value.z).toBeCloseTo(4, 1)

  const sprint = play(function* (body) {
    yield* body.run({ speed: 7, at: 12, push: 4 })
    yield* body.stand()
  })
  expect(sprint.longest).toBeGreaterThan(0.05)
  expect(sprint.longest).toBeLessThan(0.25)
  expect(sprint.jolt).toBeLessThan(0.06)
  expect(sprint.quickest).toBeGreaterThan(0.19)
})

test('sent any way off at a walk, he gets there and stays on his feet', () => {
  for (const far of [0.3, 1, 1.5, 3, 6, -1]) {
    const { body } = play(function* (body) {
      yield* body.hips.to(new Vector3(0, body.size.stand, far))
      yield* body.stand()
    })
    expect(body.hips.value.z).toBeCloseTo(far, 1)
  }
})

test('a jump has the hips as high as asked at the top, and he lands on his feet', () => {
  // straight up as well as along
  const up = play(function* (body) {
    yield* body.jump(new Vector3(0, body.size.stand + 0.34, 0))
    yield* body.stand()
  })
  expect(up.high).toBeCloseTo(up.body.size.stand + 0.34, 1)

  const { body, longest, high } = play(function* (body) {
    yield* body.jump(new Vector3(0, body.size.stand + 0.34, 0.7))
    yield* body.stand()
  })
  // 0.34 m higher than they left the ground takes the hips 2.6 m/s up, and keeps him up half a second
  expect(high).toBeCloseTo(body.size.stand + 0.34, 1)
  expect(longest).toBeGreaterThan(0.4)
})

test('the top of a jump is a place and a moment: a hand told to be somewhere by then is, moving in the scene as written', () => {
  const body = new Body(person())
  const [moving, at, top] = [new Vector3(), new Vector3(), new Vector3(0, body.size.stand + 0.34, 1.65)]
  let rising = Number.NaN
  body.play(
    (function* () {
      body.walk(1.5)
      body.jump(top)
      // a place carried with the shoulder, and a velocity in the scene
      const release = { velocity: new Vector3(0, 5.5, 4.4), on: body }
      yield* body.hand.right.by(body.highest(), new Vector3(0, 0.45, 0.15), release)
      moving.copy(body.hand.right.velocity)
      rising = body.hips.velocity.y
      at.copy(body.hips.value)
      yield* body.stand()
    })(),
  )
  for (let n = 0; n < 4000 && body.playing; n++) body.update(tick(body.size))
  expect(body.playing).toBe(false)
  // at the top the hips go neither up nor down: within what a step of time changes
  expect(Math.abs(rising)).toBeLessThan(0.1)
  // and are where the jump was to have them: he took off from where the walk ended
  expect(at.distanceTo(top)).toBeLessThan(0.03)
  expect(moving.x).toBeCloseTo(0, 1)
  expect(moving.y).toBeCloseTo(5.5, 1)
  expect(moving.z).toBeCloseTo(4.4, 1)
  // (with no jump to make, he is highest now)
  expect(body.highest()).toBe(body.time)
})

test('a walk that leaves him no foot on the ground is no error: he comes down on his feet, the story no longer having them', () => {
  const body = new Body(person())
  body.play(
    (function* (): Story {
      const there = body.walk(3)
      // (the right foot is taken as the left steps off)
      body.foot.right.to({ x: 0, y: -0.6, z: 0.2 }, { on: body, seconds: 0.3 })
      yield* there
      yield* body.stand()
    })(),
  )
  for (let n = 0; n < 2000 && body.playing; n++) body.update(tick(body.size))
  expect(body.playing).toBe(false)
  for (let n = 0; n < 60; n++) body.update(tick(body.size))
  // he stands on both feet on the ground, near where the walk was to end
  for (const side of ['left', 'right'] as const) expect(body.foot[side].value.y).toBeLessThan(body.size.ankle + 0.03)
  expect(body.hips.value.z).toBeGreaterThan(2.5)
})
