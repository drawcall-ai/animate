import { Euler, Group, type Object3D, Vector3 } from 'three'
import { expect, test } from 'vitest'
import { Body } from '../src'
import { SIDES, tick } from '../src/size'
import { person } from '../examples/person'

const bone = (rig: Object3D, name: string) => {
  const found = rig.getObjectByName(name)
  if (!found) throw new Error(`the person has no ${name}`)
  return found
}

/** the person at another rest: his arms half down, and every bone turned its own way about its joint, the bones under it staying where they are */
function rested() {
  const rig = person()
  bone(rig, 'leftUpperArm').rotation.z = -0.8
  bone(rig, 'rightUpperArm').rotation.z = 0.8
  let turns = 0
  rig.children[0].traverse((part) => {
    const held = [...part.children]
    for (const child of held) rig.attach(child)
    part.rotation.copy(new Euler(0.7 * ++turns, 1.3 * turns, 0.4 * turns))
    for (const child of held) part.attach(child)
  })
  return rig
}

test('the bones of a rig are where the body has its feet and hands, whatever holds the rig and however its bones rest', () => {
  const rig = rested()
  const stage = new Group().add(rig)
  stage.position.set(3, 1, -2)
  stage.rotation.set(0.3, 1.1, -0.2)
  stage.scale.setScalar(1.7)
  const body = new Body(rig)
  // he is measured as the person is, arms out or not
  expect(body.size.stand).toBeCloseTo(0.95)
  expect(body.size.trunk).toBeCloseTo(0.47)
  expect(body.size.arm).toBeCloseTo(0.61)
  // made again of the rig as he stands, he is as large
  expect(new Body(rig).size.trunk).toBeCloseTo(0.47)

  // walking, a hand sent out ahead of its shoulder
  body.walk(2)
  body.hand.right.to({ x: 0, y: -0.2, z: 0.4 }, { on: body })
  while (body.time < 1.2) body.update(tick(body.size))
  stage.updateMatrixWorld(true)
  for (const side of SIDES) {
    for (const [name, end] of [
      ['Foot', body.foot[side]],
      ['Hand', body.hand[side]],
    ] as const) {
      const at = bone(rig, side + name).getWorldPosition(new Vector3())
      expect(at.distanceTo(rig.localToWorld(end.value.clone()))).toBeLessThan(1e-9)
    }
  }
  // and is plainly not at rest
  expect(() => new Body(rig)).toThrow(/rig at rest.*a leg is not straight down/)
})

test('a rig scaled itself is a body as large as it is drawn, where the rig is', () => {
  const rig = person()
  rig.scale.setScalar(0.5)
  rig.position.set(1, 0, 2)
  const body = new Body(rig)
  expect(body.size.stand).toBeCloseTo(0.475)
  body.walk(1)
  while (body.time < 1) body.update(tick(body.size))
  expect(body.hips.value.z).toBeGreaterThan(0.3)
  const at = bone(rig, 'leftFoot').getWorldPosition(new Vector3())
  expect(at.distanceTo(body.foot.left.value.clone().add(rig.position))).toBeLessThan(1e-9)
})

test('a rig with a bone missing, or not hanging from the one before it, is no body', () => {
  const handless = person()
  bone(handless, 'leftHand').removeFromParent()
  expect(() => new Body(handless)).toThrow(/no bone named leftHand/)
  const loose = person()
  loose.attach(bone(loose, 'rightLowerLeg'))
  expect(() => new Body(loose)).toThrow(/no bone named rightLowerLeg hanging from its rightUpperLeg/)
})

test('a rig turned round or off the ground is not at rest', () => {
  const turned = person()
  bone(turned, 'hips').rotation.y = Math.PI
  expect(() => new Body(turned)).toThrow(/the left is not at \+x of the right/)
  const floating = person()
  bone(floating, 'hips').position.y += 1
  expect(() => new Body(floating)).toThrow(/the ankles are 1.07 m above y = 0/)
})

test('he walks on ankles as high as boots have them, and a rig whose ankles are higher than its feet are long is no body', () => {
  const booted = person()
  bone(booted, 'hips').position.y += 0.07
  const body = new Body(booted)
  expect(body.size.ankle).toBeCloseTo(0.14)
  let there = false
  body.play(
    (function* () {
      there = yield* body.walk(1.76)
    })(),
  )
  while (body.playing) {
    body.update(tick(body.size))
    expect(SIDES.some((side) => body.foot[side].anchor)).toBe(true)
  }
  expect(there).toBe(true)
  expect(body.hips.value.z).toBeCloseTo(1.76, 1)
  const stilted = person()
  bone(stilted, 'hips').position.y += 0.1
  expect(() => new Body(stilted)).toThrow(
    /ankles are 0.17 m above y = 0.*lower than the ball of the foot is ahead of them, 0.16 m/,
  )
})
