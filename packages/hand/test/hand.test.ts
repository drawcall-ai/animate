import { CylinderGeometry, Mesh, Quaternion, SphereGeometry, Vector3 } from 'three'
import { expect, test } from 'vitest'
import { other, person } from '../../../examples/person'
import { type Finger, fist, grip, Hand, type Pose, relaxed } from '../src'

const spread: Pose = {
  ...relaxed,
  index: { spread: 0.3, bend: [0.4, 0.9, 0.5] },
  thumb: { spread: 0.2, bend: [1, 0.5, 0.6] },
}
/** where a finger's tip bone lies in the world */
const tip = (hand: Hand, finger: Finger) => {
  const name = `${hand.side}${finger[0].toUpperCase()}${finger.slice(1)}Distal`
  const end = hand.bone.getObjectByName(name)?.children[0]
  if (!end) throw new Error(`the rig has no ${name} with a tip`)
  return end.getWorldPosition(new Vector3())
}

test('a pose turns either hand as its rods have it, and the two hands mirror each other', () => {
  const rig = person()
  const [left, right] = [new Hand(rig, 'left'), new Hand(rig, 'right')]
  for (const hand of [left, right]) {
    hand.pose(spread)
    hand.bone.updateMatrixWorld(true)
    const rods = hand.segments(spread, hand.bone.matrixWorld)
    for (const finger of ['thumb', 'index', 'little'] as const)
      expect(rods.filter((s) => s.element === finger)[2].b.distanceTo(tip(hand, finger))).toBeLessThan(1e-6)
  }
  // the person stands mirrored in x: so must his hands holding one pose
  for (const finger of ['thumb', 'index', 'little'] as const) {
    const [l, r] = [tip(left, finger), tip(right, finger)]
    expect(r.toArray()).toEqual([-l.x, l.y, l.z].map((v) => expect.closeTo(v, 6)))
  }
})

test('a pose past what a person can turn throws, naming the finger, the joint and by how much', () => {
  const hand = new Hand(person(), 'left')
  expect(() => hand.pose({ ...relaxed, ring: { spread: 0, bend: [0.2, 2.1, 0.2] } })).toThrow(
    "the ring's bend[1] is turned 11.5° past",
  )
})

test('a rig whose hand lacks a bone, or is scaled unevenly, says which bone', () => {
  const missing = person()
  missing.getObjectByName('rightRingDistal')?.removeFromParent()
  expect(() => new Hand(missing, 'right')).toThrow('rightRingDistal')
  const stretched = person()
  stretched.getObjectByName('rightHand')?.scale.set(1, 1.2, 1)
  expect(() => new Hand(stretched, 'right')).toThrow('rightHand is scaled unevenly')
})

test('a rig may rest its fingers curled and its thumb lifted out of the palm: a pose shapes them as a flat hand', () => {
  const curled = person()
  /** a bone turned at its joint toward the palm, about the line square to it in the palm, which a pose counts from */
  const lift = (name: string, angle: number) => {
    const bone = curled.getObjectByName(name)
    const next = bone?.children[0]
    if (!bone?.parent || !next) throw new Error(`the person has no ${name} with a bone after it`)
    curled.updateMatrixWorld(true)
    const along = next.getWorldPosition(new Vector3()).sub(bone.getWorldPosition(new Vector3()))
    const axis = along.cross(new Vector3(0, 1, 0)).normalize()
    const turn = new Quaternion().setFromAxisAngle(axis, angle)
    const parent = bone.parent.getWorldQuaternion(new Quaternion())
    bone.quaternion.premultiply(parent.clone().invert().multiply(turn).multiply(parent))
  }
  lift('leftMiddleProximal', 0.5)
  lift('leftMiddleIntermediate', 0.7)
  lift('leftThumbMetacarpal', 0.6)
  const flat = new Hand(person(), 'left').segments(fist)
  new Hand(curled, 'left').segments(fist).forEach(({ a, b }, k) => {
    expect(a.distanceTo(flat[k].a)).toBeLessThan(1e-6)
    expect(b.distanceTo(flat[k].b)).toBeLessThan(1e-6)
  })
})

test('a hand with its thumb along the index, bent back at the wrist and curled, closes round a handle', () => {
  for (const side of ['left', 'right'] as const) {
    const hand = new Hand(other(), side)
    const handle = new Mesh(new CylinderGeometry(0.015, 0.015, 0.2, 24))
    handle.updateMatrixWorld(true)
    const { contacts } = grip(hand, handle, { at: new Vector3(0.015, 0, 0), from: new Vector3(1, 0, 0) })
    for (const e of ['palm', 'thumb', 'index', 'middle'] as const) expect(contacts[e].gap).toBeLessThan(0.002)
  }
})

test("a fist's fingertips stay in front of the palm, not through it", () => {
  const hand = new Hand(person(), 'right')
  const rods = hand.segments(fist)
  const palm = rods.filter((s) => s.element === 'palm')
  const centre = palm.reduce((sum, s) => sum.add(s.a).add(s.b), new Vector3()).divideScalar(2 * palm.length)
  for (const finger of ['index', 'middle', 'ring', 'little'] as const) {
    const end = rods.filter((s) => s.element === finger)[2].b
    expect(end.sub(centre).dot(hand.normal)).toBeGreaterThan(0.009)
  }
})

test('a mesh hung on a fingertip bone is not taken for its bone', () => {
  const rig = person()
  const plain = new Hand(rig, 'right').segments(spread)
  rig.getObjectByName('rightIndexDistal')?.add(new Mesh(new SphereGeometry(0.01)))
  expect(new Hand(rig, 'right').segments(spread)).toEqual(plain)
})
