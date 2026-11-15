import { Group, Object3D, Quaternion, Vector3 } from 'three'
import { expect, test } from 'vitest'
import { person } from '../../../examples/person'
import { Body } from '../src'

const FRAME = 1 / 60
const PARTS = ['neck', 'hips', 'leftHand', 'rightHand', 'leftFoot', 'rightFoot']

const at = (rig: Object3D, name: string) => rig.getObjectByName(name)!.getWorldPosition(new Vector3())
const yaw = (rig: Object3D, name: string) => {
  const ahead = new Vector3(0, 0, 1).applyQuaternion(rig.getObjectByName(name)!.getWorldQuaternion(new Quaternion()))
  return Math.atan2(ahead.x, ahead.z)
}
const range = (values: number[]) => Math.max(...values) - Math.min(...values)

/** plays him for so long, and tells how far his parts jerk at the most: how far a frame's move differs from the last's (m) */
function play(rig: Object3D, body: Body, seconds: number, each = () => {}) {
  let last: Vector3[] = []
  let moves: Vector3[] = []
  let jerk = 0
  for (let t = 0; t < seconds; t += FRAME) {
    body.update(FRAME)
    rig.updateMatrixWorld(true)
    each()
    const now = PARTS.map((name) => at(rig, name))
    const moved = now.map((place, k) => place.clone().sub(last[k] ?? place))
    if (moves.length) jerk = Math.max(jerk, ...moved.map((move, k) => move.distanceTo(moves[k])))
    ;[last, moves] = [now, moved]
  }
  return jerk
}

function setup() {
  const scene = new Group()
  const rig = person()
  scene.add(rig)
  return { scene, rig, body: new Body(rig) }
}

test('standing, he breathes and his weight drifts, never quite the same, and he walks off from it smoothly', () => {
  const { rig, body } = setup()
  const chest: number[] = []
  const hips: number[] = []
  const jerk = play(rig, body, 10, () => {
    chest.push(at(rig, 'neck').y)
    hips.push(body.hips.value.x)
  })
  expect(range(chest.slice(180))).toBeGreaterThan(0.005)
  expect(range(hips.slice(180))).toBeGreaterThan(0.01)
  expect(range(hips.slice(180))).toBeLessThan(0.03)
  expect(jerk).toBeLessThan(0.002)
  // as smoothly as he walks off when he has only just stood
  const fresh = setup()
  fresh.body.walk(3)
  body.walk(3)
  expect(play(rig, body, 2)).toBeLessThan(1.1 * play(fresh.rig, fresh.body, 2))
})

test('he looks round with his head most, his trunk some, and his feet only past what they reach', () => {
  for (const [degrees, steps] of [
    [60, false],
    [150, true],
  ] as const) {
    const { rig, body } = setup()
    const way = (degrees * Math.PI) / 180
    play(rig, body, 1)
    const feet = [body.foot.left.value.clone(), body.foot.right.value.clone()]
    body.look({ x: 5 * Math.sin(way), y: 1.4, z: 5 * Math.cos(way) })
    play(rig, body, 4)
    const moved = Math.max(feet[0].distanceTo(body.foot.left.value), feet[1].distanceTo(body.foot.right.value))
    expect(Math.abs(yaw(rig, 'head') - way)).toBeLessThan(0.1)
    if (steps) expect(moved).toBeGreaterThan(0.05)
    else {
      expect(moved).toBeLessThan(0.001)
      expect(yaw(rig, 'chest')).toBeGreaterThan(0.2)
      expect(yaw(rig, 'chest')).toBeLessThan(way - 0.1)
    }
  }
})

test('looking aside as he walks, his hips and feet go as they would', () => {
  const walk = (looks: boolean) => {
    const { rig, body } = setup()
    if (looks) body.look({ x: 5, y: 1.4, z: 3 })
    body.walk(5)
    const places: Vector3[] = []
    play(rig, body, 3, () =>
      places.push(body.hips.value.clone(), body.foot.left.value.clone(), body.foot.right.value.clone()),
    )
    return places
  }
  const [ahead, aside] = [walk(false), walk(true)]
  for (const [k, place] of ahead.entries()) expect(place.distanceTo(aside[k])).toBeLessThan(1e-9)
})

test('a small knock at the shoulder gives and comes back within a beat, his feet and his hands on a bar staying', () => {
  const { scene, rig, body } = setup()
  const bar = new Object3D()
  bar.position.set(0, 1.1, 0.4)
  const grips = { left: new Object3D(), right: new Object3D() }
  grips.left.position.x = 0.2
  grips.right.position.x = -0.2
  bar.add(grips.left, grips.right)
  scene.add(bar)
  body.hand.left.to(grips.left.position, { on: bar })
  body.hand.right.to(grips.right.position, { on: bar })
  play(rig, body, 2)
  const feet = [body.foot.left.value.clone(), body.foot.right.value.clone()]
  const neck = at(rig, 'neck')
  body.knock({ x: 0, y: 0, z: -0.5 }, at(rig, 'rightUpperArm'))
  let gave = 0
  let off = 0
  play(rig, body, 0.6, () => {
    gave = Math.max(gave, at(rig, 'neck').distanceTo(neck))
    for (const side of ['left', 'right'] as const)
      off = Math.max(off, body.hand[side].value.distanceTo(grips[side].getWorldPosition(new Vector3())))
  })
  expect(gave).toBeGreaterThan(0.003)
  expect(at(rig, 'neck').distanceTo(neck)).toBeLessThan(0.3 * gave + 0.003)
  expect(feet[0].distanceTo(body.foot.left.value) + feet[1].distanceTo(body.foot.right.value)).toBeLessThan(0.001)
  expect(off).toBeLessThan(0.01)
})

test('a hard knock has him step after it and stand again', () => {
  const { rig, body } = setup()
  play(rig, body, 2)
  const standing = body.hips.value.y
  const feet = body.foot.left.value.clone()
  body.knock({ x: 0, y: 0, z: -2.5 })
  play(rig, body, 3)
  expect(feet.distanceTo(body.foot.left.value)).toBeGreaterThan(0.05)
  expect(body.hips.value.z).toBeLessThan(-0.1)
  expect(Math.abs(body.hips.value.y - standing)).toBeLessThan(0.02)
})
