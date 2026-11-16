import { type Object3D, Vector3 } from 'three'
import { expect, test } from 'vitest'
import { person } from '../../../examples/person'
import { Body, type Story } from '../src'
import { SIDES, SOLE, type Side, tick, wrap } from '@drawcall/limbs'

const at = (rig: Object3D, name: string, from = new Vector3()) => {
  const bone = rig.getObjectByName(name)
  if (!bone) throw new Error(`the rig has no ${name}`)
  rig.updateMatrixWorld(true)
  return bone.localToWorld(from)
}
/** which way he faces in the scene (rad about y, from +z toward +x): square to the line from his right hip to his left, or from shoulder to shoulder */
function facing(rig: Object3D, joint = 'UpperLeg') {
  const across = at(rig, `left${joint}`).sub(at(rig, `right${joint}`))
  return Math.atan2(-across.z, across.x)
}
/** a body on the person's bones, and what goes on a step of time at a time until a moment: the story it plays, if it has one, to its end */
function stage(story?: (body: Body) => Story) {
  const rig = person()
  const body = new Body(rig)
  if (story) body.play(story(body))
  const until = (moment: number, each = () => {}) => {
    while (body.time < moment && (!story || body.playing)) {
      body.update(tick(body.size))
      each()
    }
  }
  return { rig, body, until }
}
const flat = ({ x, z }: { x: number; z: number }) => new Vector3(x, 0, z)

test('a walk to a place off the way he faces arrives there, facing the way he went', () => {
  const place = { x: 2, z: 1.5 }
  const { rig, body, until } = stage(function* (body) {
    yield* body.walk(place)
    yield* body.stand()
  })
  until(20)
  expect(body.playing).toBe(false)
  expect(flat(body.hips.value).distanceTo(flat(place))).toBeLessThan(0.03)
  expect(Math.abs(wrap(facing(rig) - Math.atan2(place.x, place.z)))).toBeLessThan(0.15)
})

test('a way he is to face holds while he goes another: sideways and back', () => {
  for (const place of [
    { x: 1.5, z: 0.3 },
    { x: -0.4, z: -1.5 },
  ]) {
    let there = false
    const { rig, body, until } = stage(function* (body) {
      body.face({ x: 0, z: 1 })
      there = yield* body.walk(place)
    })
    // (his pelvis turns toward the way he goes: it is his shoulders that keep facing so)
    let off = 0
    until(20, () => (off = Math.max(off, Math.abs(wrap(facing(rig, 'UpperArm'))))))
    expect(there).toBe(true)
    expect(off).toBeLessThan(0.2)
    expect(flat(body.hips.value).distanceTo(flat(place))).toBeLessThan(0.03)
  }
})

test('he turns where he stands to face as he is told, in a few steps round, and stays so once that is let go', () => {
  const { rig, body, until } = stage(function* (body) {
    yield* body.face({ x: -1, z: -1 })
    yield* body.stand()
  })
  let steps = 0
  const stood = { left: true, right: true }
  until(10, () => {
    for (const side of SIDES) {
      const stands = body.foot[side].anchor !== undefined
      if (stands && !stood[side]) steps++
      stood[side] = stands
    }
  })
  expect(body.playing).toBe(false)
  expect(steps).toBeLessThan(5)
  // (a second after the story is over he still faces so)
  for (let n = 0; n < 1 / tick(body.size); n++) body.update(tick(body.size))
  expect(Math.abs(wrap(facing(rig) - Math.atan2(-1, -1)))).toBeLessThan(0.1)
  expect(flat(body.hips.value).length()).toBeLessThan(0.03)
  for (const side of SIDES) expect(flat(body.foot[side].value).length()).toBeLessThan(0.15)
})

test('led at a steady velocity he comes to go at it, a foot always down at a walk: and led at none, comes to a stand', () => {
  const { body, until } = stage()
  const velocity = { x: 1, z: 1 }
  body.go(velocity)
  let held = true
  const down = () => SIDES.filter((side) => body.foot[side].anchor).length
  until(3, () => (held &&= down() > 0))
  const from = body.hips.value.clone()
  until(6, () => (held &&= down() > 0))
  expect(held).toBe(true)
  const went = flat(body.hips.value).sub(flat(from)).divideScalar(3)
  expect(went.distanceTo(flat(velocity)) / flat(velocity).length()).toBeLessThan(0.03)

  body.go({ x: 0, z: 0 })
  until(9)
  expect(flat(body.hips.velocity).length()).toBeLessThan(0.02)
  expect(down()).toBe(2)
  expect(body.foot.left.value.distanceTo(body.foot.right.value)).toBeLessThan(2 * body.size.hip + 0.1)
})

test('led round a quarter turn at a walk, a foot on the ground stays where it stands', () => {
  const { rig, body, until } = stage()
  // where the ball of a foot is: what it turns on as its heel comes up
  const ball = (side: Side) => at(rig, `${side}Foot`, new Vector3(0, -body.size.ankle, SOLE.ball * body.size.leg))
  const stood: Partial<Record<Side, Vector3>> = {}
  let slid = 0
  const slides = () => {
    for (const side of SIDES) {
      if (!body.foot[side].anchor) stood[side] = undefined
      else slid = Math.max(slid, flat(ball(side)).distanceTo(flat((stood[side] ??= ball(side)))))
    }
  }
  body.go({ x: 0, z: 1.4 })
  until(3, slides)
  body.go({ x: 1.4, z: 0 })
  until(7, slides)
  expect(slid).toBeLessThan(0.02)
  expect(Math.abs(wrap(facing(rig) - Math.PI / 2))).toBeLessThan(0.1)
})

test('a kick stated while he is led strikes where and as it was to, on the way he is going', () => {
  const { body, until } = stage()
  const [place, velocity] = [new Vector3(2.9, 0.15, 0.09), new Vector3(8, 1, 0)]
  let struck: { off: number; moving: number } | undefined
  body.go({ x: 1.4, z: 0 })
  body.play(
    (function* () {
      expect(yield* body.foot.right.to(place, { velocity })).toBe(true)
      struck = { off: body.foot.right.value.distanceTo(place), moving: body.foot.right.velocity.distanceTo(velocity) }
    })(),
  )
  until(6)
  expect(struck?.off).toBeLessThan(0.05)
  expect(struck?.moving).toBeLessThan(0.4)
  // and he goes on as he was led
  expect(body.hips.velocity.x).toBeCloseTo(1.4, 1)
})

test('a place a step behind him he steps back to, facing as he did', () => {
  const { rig, body, until } = stage(function* (body) {
    yield* body.walk(-0.3)
    yield* body.stand()
  })
  let off = 0
  until(10, () => (off = Math.max(off, Math.abs(wrap(facing(rig))))))
  expect(off).toBeLessThan(0.05)
  expect(body.hips.value.z).toBeCloseTo(-0.3, 1)
})

test('sideways at half a metre a second he steps out and closes up, about two steps a second, his feet never nearer than his hips are wide', () => {
  const { body, until } = stage(function* (body) {
    body.face({ x: 0, z: 1 })
    yield* body.walk({ x: 3, z: 0 }, { speed: 0.5 })
  })
  const falls: number[] = []
  const stood = { left: true, right: true }
  let [near, wide] = [Infinity, 0]
  until(20, () => {
    const apart = body.foot.left.value.x - body.foot.right.value.x
    ;[near, wide] = [Math.min(near, apart), Math.max(wide, apart)]
    for (const side of SIDES) {
      const stands = body.foot[side].anchor !== undefined
      if (stands && !stood[side]) falls.push(body.time)
      stood[side] = stands
    }
  })
  expect(near).toBeGreaterThan(2 * body.size.hip - 0.01)
  expect(wide).toBeGreaterThan(0.5)
  const between = (falls[falls.length - 3] - falls[1]) / (falls.length - 4)
  expect(between).toBeGreaterThan(0.35)
  expect(between).toBeLessThan(0.55)
})

test('led round a corner and through a turn of 120 degrees, his knees stay clear of each other', () => {
  const { rig, body, until } = stage()
  let near = Infinity
  const knees = () => (near = Math.min(near, at(rig, 'leftLowerLeg').distanceTo(at(rig, 'rightLowerLeg'))))
  const led = (angle: number) => body.go({ x: 1.4 * Math.sin(angle), z: 1.4 * Math.cos(angle) })
  led(0)
  until(3, knees)
  led(Math.PI / 2)
  until(6, knees)
  led(Math.PI / 2 + 2.1)
  until(10, knees)
  expect(near).toBeGreaterThan(0.12)
})

test('faster than he walks he faces the way he goes, and takes up the way he is to face again as he slows', () => {
  const { rig, body, until } = stage()
  const led = (speed: number) => {
    body.go({ x: speed, z: 0 })
    body.face({ x: 0, z: 1 })
  }
  // (at a run the pelvis turns with his stride)
  until(4, () => led(4.5))
  expect(Math.abs(wrap(facing(rig) - Math.PI / 2))).toBeLessThan(0.25)
  until(9, () => led(1.4))
  expect(Math.abs(wrap(facing(rig)))).toBeLessThan(0.1)
  expect(body.hips.velocity.x).toBeGreaterThan(0.4)
})

test('put a little way off he steps after his hips: put far off he is there as he was, feet and all', () => {
  const { body, until } = stage()
  until(0.5)
  body.hips.at({ x: 0.2, z: 0 })
  until(3)
  expect(flat(body.hips.value).distanceTo(flat({ x: 0.2, z: 0 }))).toBeLessThan(0.03)
  body.hips.at({ x: 3, z: 2 })
  body.update(tick(body.size))
  for (const side of SIDES) expect(flat(body.foot[side].value).distanceTo(flat({ x: 3, z: 2 }))).toBeLessThan(0.15)
  until(5)
  expect(flat(body.hips.value).distanceTo(flat({ x: 3, z: 2 }))).toBeLessThan(0.03)
})

test('a jump stated straight after a run to a place off the way he faces goes there: he turns on the way to take off', () => {
  let landed: Vector3 | undefined
  const { until } = stage(function* (body) {
    body.run({ speed: 4, at: { x: 3, z: 3 } })
    yield* body.jump({ x: 4, y: 1.4, z: 4 })
    landed = flat(body.hips.value)
  })
  until(8)
  if (!landed) throw new Error('he never landed')
  // (he lands on past the top, along the way from where he stood through it)
  const way = landed.clone().normalize()
  expect(way.dot(new Vector3(1, 0, 1).normalize())).toBeGreaterThan(0.98)
})
