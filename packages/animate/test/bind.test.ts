import { grip, Hand, type Statement } from '@drawcall/hand'
import { BoxGeometry, CylinderGeometry, Mesh, type Object3D, Quaternion, Scene, SphereGeometry, Vector3 } from 'three'
import { expect, test } from 'vitest'
import { person } from '../../../examples/person'
import { Body, type Side, type Story } from '../src'

const FRAME = 1 / 60
const place = (thing: Object3D) => thing.getWorldPosition(new Vector3())

/** the person in a scene with things, his hands read at rest, and his body */
function setup(...things: Object3D[]) {
  const rig = person()
  const scene = new Scene().add(rig, ...things)
  scene.updateMatrixWorld(true)
  const hands = { left: new Hand(rig, 'left'), right: new Hand(rig, 'right') }
  return { rig, hands, body: new Body(rig) }
}
/** plays a story to its end, a frame at a time, calling `each` after every frame */
function play(body: Body, story: Story<unknown>, each = () => {}) {
  body.play(story)
  for (let t = 0; t < 20 && body.playing; t += FRAME) {
    body.update(FRAME)
    each()
  }
  expect(body.playing).toBe(false)
}
const ball = () => {
  const mesh = new Mesh(new SphereGeometry(0.12))
  mesh.position.set(-0.3, 0.9, 0.35)
  return mesh
}
const SEAT: Statement = { at: new Vector3(0, -0.12, 0), from: new Vector3(0, -1, 0) }

test('a ball taken by the hand goes with it, eased in from where it was, and leaves as fast as the hand sent it', () => {
  const thing = ball()
  const { body, hands } = setup(thing)
  const seat = grip(hands.right, thing, SEAT)
  const right = body.hand.right
  let jump = 0
  let last = place(thing)
  let velocity = new Vector3()
  const release = new Vector3(-0.25, 1.5, 0.45)
  const flying = new Vector3(0, 3, 4)
  play(
    body,
    (function* () {
      yield* right.to(seat)
      right.take(seat)
      // (where it was taken, it does not jump)
      jump = 0
      yield* body.until(body.time + 0.5)
      expect(body.bound).toEqual([{ thing, hands: ['right'], turning: true }])
      yield* right.by(body.time + 1, release, { velocity: flying, with: seat })
      velocity = right.letGo()
      expect(place(thing).distanceTo(release)).toBeLessThan(0.05)
      expect(body.bound).toEqual([])
      yield* body.stand()
    })(),
    () => {
      jump = Math.max(jump, place(thing).distanceTo(last))
      last = place(thing)
    },
  )
  // (it moves no further in a frame than the hand swings it)
  expect(jump).toBeLessThan(0.15)
  expect(velocity.distanceTo(flying)).toBeLessThan(0.15 * flying.length())
})

test('a bar taken by a point in each hand lies between the palms and follows either hand sent alone', () => {
  const bar = new Mesh(new CylinderGeometry(0.02, 0.02, 1.2).rotateZ(Math.PI / 2))
  bar.position.set(0, 1.0, 0.35)
  const { body, hands } = setup(bar)
  const held = (side: Side) =>
    grip(hands[side], bar, { at: new Vector3(side === 'left' ? 0.22 : -0.22, 0, 0), from: new Vector3(0, 0, -1) })
  const grips = { left: held('left'), right: held('right') }
  const { left, right } = body.hand
  const ends = { left: new Vector3(0.22, 0, 0), right: new Vector3(-0.22, 0, 0) }
  let off = 0
  play(
    body,
    (function* () {
      const reached = left.to(grips.left)
      yield* right.to(grips.right)
      yield* reached
      left.take(grips.left, { turning: false })
      right.take(grips.right, { turning: false })
      yield* body.until(body.time + 0.5)
      const apart = (side: Side) => bar.localToWorld(ends[side].clone()).distanceTo(body.hand[side].value)
      const was = { left: apart('left'), right: apart('right') }
      expect(body.bound).toEqual([{ thing: bar, hands: ['left', 'right'], turning: false }])
      left.to({ x: 0.25, y: 1.0, z: 0.4 })
      yield* right.to({ x: -0.2, y: 1.0, z: 0.4 })
      const before = bar.getWorldQuaternion(new Quaternion())
      // the right hand alone is raised, and the bar tilts up to it
      yield* right.to({ x: -0.2, y: 1.35, z: 0.45 }, { seconds: 1 })
      yield* body.until(body.time + 0.4)
      off = Math.max(...SIDES.map((side) => Math.abs(apart(side) - was[side])))
      expect(bar.getWorldQuaternion(new Quaternion()).angleTo(before)).toBeGreaterThan(0.2)
      left.letGo()
      right.letGo()
      yield* body.stand()
    })(),
  )
  // (each point stays where that hand's palm has it, as near as the hands are as far apart as the points)
  expect(off).toBeLessThan(0.04)
})
const SIDES = ['left', 'right'] as const

test('a box the right hand has, the left following it, stays between both hands as the right carries it', () => {
  const box = new Mesh(new BoxGeometry(0.34, 0.24, 0.3))
  box.position.set(0, 0.95, 0.42)
  const { body, hands } = setup(box)
  const side = (s: Side) => {
    const out = new Vector3(s === 'left' ? 1 : -1, 0, 0)
    return grip(hands[s], box, { at: out.clone().multiplyScalar(0.17), from: out, using: ['palm', 'index', 'middle', 'ring', 'little'] })
  }
  const grips = { left: side('left'), right: side('right') }
  const { left, right } = body.hand
  let worst = 0
  let carrying = false
  let held = new Vector3()
  play(
    body,
    (function* () {
      const reached = left.to(grips.left)
      yield* right.to(grips.right)
      yield* reached
      right.take(grips.right)
      left.to(grips.left)
      yield* body.until(body.time + 1)
      held = box.worldToLocal(body.hand.left.value.clone())
      carrying = true
      yield* right.to({ x: -0.1, y: 1.2, z: 0.4 }, { with: grips.right, palm: { x: 1, y: 0, z: 0 }, seconds: 1.2 })
      yield* body.until(body.time + 0.5)
      carrying = false
      right.letGo()
      left.free()
      yield* body.stand()
    })(),
    () => {
      if (!carrying) return
      // (the left wrist stays where its grip has it on the box)
      worst = Math.max(worst, box.localToWorld(held.clone()).distanceTo(body.hand.left.value))
    },
  )
  expect(worst).toBeLessThan(0.01)
})

test('a hand cannot follow what goes with it, nor two hands turn one thing: each is an error at the statement', () => {
  const [one, two] = [ball(), ball()]
  two.position.x = 0.3
  const { body, hands } = setup(one, two)
  const { left, right } = body.hand
  const seat = grip(hands.right, one, SEAT)
  right.take(seat)
  // the hand that has it is not sent onto it
  expect(() => right.to(seat)).toThrow(/moves/)
  expect(() => right.to({ x: 0, y: 0, z: 0 }, { on: one })).toThrow(/moves/)
  // nor does the other take it turning, while one has it
  expect(() => left.take(grip(hands.left, one, SEAT))).toThrow(/one hand/)
  // a loop through two things: the left follows the ball, has the other, and the right is sent onto that
  left.to(grip(hands.left, one, SEAT))
  left.take(grip(hands.left, two, SEAT))
  expect(() => right.to({ x: 0, y: 0, z: 0 }, { on: two })).toThrow(/moves/)
  // letting go of nothing is no statement
  right.letGo()
  expect(() => right.letGo()).toThrow(/nothing/)
})

test('taking what the hand follows turns the binding round, and a hand that cannot reach a thing leaves it where it is', () => {
  const near = ball()
  const far = ball()
  far.position.set(-0.3, 1.0, 3)
  const { body, hands } = setup(near, far)
  const right = body.hand.right
  const lying = place(far)
  play(
    body,
    (function* () {
      const there = yield* right.to(grip(hands.right, far, SEAT))
      expect(there).toBe(false)
      expect(place(far).distanceTo(lying)).toBe(0)
      const seat = grip(hands.right, near, SEAT)
      yield* right.to(seat)
      right.take(seat)
      expect(body.bound.length).toBe(1)
      right.letGo()
      yield* body.stand()
    })(),
  )
})
