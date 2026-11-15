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

test('a ball bound by a point is sent, not the hand: it eases in from where it was, keeps its own turn, and leaves as fast as it was sent', () => {
  const mesh = ball()
  const { body, hands } = setup(mesh)
  const seat = grip(hands.right, mesh, SEAT)
  const right = body.hand.right
  let jump = 0
  let last = place(mesh)
  let velocity = new Vector3()
  let turned = 0
  const release = new Vector3(-0.25, 1.5, 0.45)
  const flying = new Vector3(0, 3, 4)
  play(
    body,
    (function* () {
      yield* right.to(seat)
      const held = body.bind(mesh)
      held.on(right, seat, { turning: false })
      const own = mesh.quaternion.clone()
      // (where it was taken, it does not jump)
      jump = 0
      yield* body.until(body.time + 0.5)
      expect(body.bound).toMatchObject([{ thing: mesh, hands: ['right'], turning: false, outside: false }])
      yield* held.by(body.time + 1, release, { velocity: flying })
      turned = mesh.quaternion.angleTo(own)
      velocity = held.free()
      expect(place(mesh).distanceTo(release)).toBeLessThan(0.05)
      expect(body.bound).toEqual([])
      yield* body.stand()
    })(),
    () => {
      jump = Math.max(jump, place(mesh).distanceTo(last))
      last = place(mesh)
    },
  )
  // (it moves no further in a frame than the hand swings it, and the wrist does not spin it)
  expect(jump).toBeLessThan(0.15)
  expect(turned).toBeLessThan(1e-6)
  expect(velocity.distanceTo(flying)).toBeLessThan(0.15 * flying.length())
})

const SIDES = ['left', 'right'] as const

test('a bar in both hands is sent to point a way: the right hand leads it there and the left follows its grip', () => {
  const bar = new Mesh(new CylinderGeometry(0.02, 0.02, 1.2).rotateX(Math.PI / 2))
  bar.position.set(0, 1.0, 0.35)
  bar.rotation.y = -Math.PI / 2
  const { body, hands } = setup(bar)
  const held = (side: Side) =>
    grip(hands[side], bar, { at: new Vector3(0, 0, side === 'left' ? -0.22 : 0.22), from: new Vector3(0, 1, 0) })
  const grips = { left: held('left'), right: held('right') }
  const { left, right } = body.hand
  const points = { left: new Vector3(0, 0, -0.22), right: new Vector3(0, 0, 0.22) }
  let off = 0
  let tilted = 0
  play(
    body,
    (function* () {
      const reached = left.to(grips.left)
      yield* right.to(grips.right)
      yield* reached
      const carried = body.bind(bar)
      carried.on(right, grips.right)
      carried.on(left, grips.left)
      yield* body.until(body.time + 0.5)
      expect(body.bound).toMatchObject([{ thing: bar, hands: ['right', 'left'], turning: true, outside: false }])
      // its right end raised: it points down to his left
      const way = new Vector3(1, -0.5, 0).normalize()
      yield* carried.to({ x: 0, y: 1.1, z: 0.4 }, { pointing: { x: -way.x, y: -way.y, z: 0 }, seconds: 1.2 })
      yield* body.until(body.time + 0.6)
      tilted = new Vector3(0, 0, 1).applyQuaternion(bar.getWorldQuaternion(new Quaternion())).angleTo(way.clone().negate())
      const apart = (side: Side) => bar.localToWorld(points[side].clone()).distanceTo(body.hand[side].value)
      off = Math.max(...SIDES.map(apart))
      carried.free()
      yield* body.stand()
    })(),
  )
  expect(tilted).toBeLessThan(0.15)
  // (each hand is on its grip, as near as a wrist is to the middle of a palm)
  expect(off).toBeLessThan(0.12)
})

test('a box the right hand leads, the left following it, stays between both hands as it is carried', () => {
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
      const carried = body.bind(box)
      carried.on(right, grips.right)
      carried.on(left, grips.left)
      yield* body.until(body.time + 1)
      held = box.worldToLocal(body.hand.left.value.clone())
      carrying = true
      yield* carried.to({ x: -0.1, y: 1.2, z: 0.4 }, { pointing: { x: 0, y: 0, z: 1 }, seconds: 1.2 })
      yield* body.until(body.time + 0.5)
      carrying = false
      carried.free()
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

test('a thing moved from outside has every hand on it follow it, and is never moved by them', () => {
  const rod = new Mesh(new CylinderGeometry(0.02, 0.02, 0.8).rotateX(Math.PI / 2))
  rod.position.set(0, 1.1, 0.4)
  const { body, hands } = setup(rod)
  const held = (side: Side) =>
    grip(hands[side], rod, { at: new Vector3(0, -0.02, side === 'left' ? 0.15 : -0.1), from: new Vector3(0, -1, 0) })
  const grips = { left: held('left'), right: held('right') }
  const moved = body.bind(rod, { outside: true })
  moved.on(body.hand.right, grips.right)
  moved.on(body.hand.left, grips.left)
  let worst = 0
  for (let t = 0; t < 4; t += FRAME) {
    // the game sways it from side to side, slowly
    rod.position.x = 0.1 * Math.sin(t)
    rod.rotation.y = 0.3 * Math.sin(t)
    rod.updateMatrix()
    const set = rod.matrix.clone()
    body.update(FRAME)
    rod.updateMatrix()
    expect(rod.matrix.equals(set)).toBe(true)
    if (t > 1.5) worst = Math.max(worst, ...SIDES.map((side) => body.hand[side].there ? 0 : 1))
  }
  expect(moved.there).toBe(true)
  expect(worst).toBe(0)
  expect(moved.velocity.length()).toBeGreaterThan(0)
})

test('a hand is not sent onto a thing it leads, and a thing with no hand on it goes nowhere when sent', () => {
  const [one, two] = [ball(), ball()]
  two.position.x = 0.3
  const { body, hands } = setup(one, two)
  const right = body.hand.right
  const seat = grip(hands.right, one, SEAT)
  const held = body.bind(one)
  held.on(right, seat)
  expect(() => right.to(seat)).toThrow(/leads/)
  expect(() => right.to({ x: 0, y: 0, z: 0 }, { on: one })).toThrow(/leads/)
  // (going on another thing, it comes off the first)
  body.bind(two).on(right, grip(hands.right, two, SEAT))
  expect(body.bound.map(({ thing }) => thing)).toEqual([two])
  const sent = held.to({ x: 0, y: 1, z: 0.5 })
  expect(sent.next()).toEqual({ done: true, value: false })
})

test('a ball bound by a point keeps its turn as he faces: he turns, and it turns with him, not with the wrist', () => {
  const mesh = ball()
  const { body, hands } = setup(mesh)
  const seat = grip(hands.right, mesh, SEAT)
  const facing = () => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(body.facing.x, body.facing.z))
  const against = () => facing().invert().multiply(mesh.getWorldQuaternion(new Quaternion()))
  let [was, now] = [new Quaternion(), new Quaternion()]
  play(
    body,
    (function* () {
      yield* body.hand.right.to(seat)
      const held = body.bind(mesh)
      held.on(body.hand.right, seat, { turning: false })
      yield* held.to({ x: 0.1, y: -0.35, z: 0.4 }, { on: body, seconds: 1 })
      was = against()
      yield* body.face({ x: 1, z: 0 })
      yield* body.until(body.time + 0.5)
      now = against()
      held.free()
      yield* body.stand()
    })(),
  )
  expect(now.angleTo(was)).toBeLessThan(0.02)
})

test('one thing is handed from outside to the body and back, its leading hand comes off and the next leads it where it is, and it is carried through a stand', () => {
  const box = new Mesh(new BoxGeometry(0.34, 0.24, 0.3))
  box.position.set(0, 0.95, 0.42)
  const { body, hands } = setup(box)
  const side = (s: Side) => {
    const out = new Vector3(s === 'left' ? 1 : -1, 0, 0)
    return grip(hands[s], box, { at: out.clone().multiplyScalar(0.17), from: out })
  }
  const grips = { left: side('left'), right: side('right') }
  const { left, right } = body.hand
  let [drift, through] = [Infinity, Infinity]
  play(
    body,
    (function* () {
      // the game has it while the hands go to it, then hands it to the body, which raises it
      const carried = body.bind(box, { outside: true })
      carried.on(right, grips.right)
      carried.on(left, grips.left)
      yield* body.until(body.time + 1.2)
      carried.outside = false
      expect(body.bound[0].outside).toBe(false)
      yield* carried.to({ x: -0.1, y: 1.15, z: 0.42 }, { seconds: 1 })
      // the right hand comes off: the left leads it, and it stays where it is
      carried.off(right)
      const at = place(box)
      yield* body.until(body.time + 1)
      drift = place(box).distanceTo(at)
      expect(body.bound).toMatchObject([{ thing: box, hands: ['left'], turning: true, outside: false }])
      // he is let stand: the hand stays on it, and it stays where it is on him
      const before = place(box)
      yield* body.stand()
      through = place(box).distanceTo(before)
      carried.free()
      yield* body.stand()
    })(),
  )
  expect(drift).toBeLessThan(0.05)
  expect(through).toBeLessThan(0.05)
})
