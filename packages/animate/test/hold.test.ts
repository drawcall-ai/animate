import { Hand } from '@drawcall/hand'
import { Group, Matrix4, Object3D, Quaternion, Vector3 } from 'three'
import { expect, test } from 'vitest'
import { person } from '../../../examples/person'
import { ARM, fore, pistol, rifle } from '../../../examples/shooter/rifle'
import { Body } from '../src'

const FRAME = 1 / 60
const UP = new Vector3(0, 1, 0)
const HERE = { x: 0, y: 0, z: 0 }

function setup() {
  const scene = new Group()
  const rig = person()
  scene.add(rig)
  return { scene, rig, body: new Body(rig) }
}
const hand = (rig: Object3D) => rig.getObjectByName('rightHand') as Object3D
const place = (thing: Object3D) => thing.getWorldPosition(new Vector3())
/** how far a part has turned from how it was turned against something else (rad) */
const turned = (part: Object3D, against: Quaternion, was: Quaternion) =>
  against.clone().invert().multiply(part.getWorldQuaternion(new Quaternion())).angleTo(was)
const against = (part: Object3D, frame: Quaternion) =>
  frame.clone().invert().multiply(part.getWorldQuaternion(new Quaternion()))

test('a hand on a thing stays on it as the thing moves and he walks and turns, its palm as it is in its frame', () => {
  const { scene, rig, body } = setup()
  const grip = new Object3D()
  scene.add(grip)
  // the game poses it each frame before him, before his right hip, swaying
  const pose = (t: number) => {
    const { x, z } = body.facing
    const hips = body.hips.value
    grip.position.set(hips.x + 0.35 * x - 0.25 * z, 1.05 + 0.05 * Math.cos(3 * t), hips.z + 0.35 * z + 0.25 * x)
    grip.quaternion.setFromAxisAngle(UP, Math.atan2(x, z))
  }
  pose(0)
  body.hand.right.to(HERE, { on: grip, palm: { x: 1, y: 0, z: 0 }, pointing: { x: 0, y: -0.4, z: 0.9 } })
  let worst = 0
  let held: Quaternion | undefined
  let twist = 0
  for (let t = 0; t < 10; t += FRAME) {
    if (t > 2) body.go({ x: 0, z: 1.4 })
    if (t > 6) body.go({ x: 1, z: 0.2 })
    if (t > 6) body.face({ x: 1, z: -1 })
    body.update(FRAME)
    pose(t + FRAME)
    if (t < 1.5) continue
    rig.updateMatrixWorld(true)
    worst = Math.max(worst, body.hand.right.value.distanceTo(place(grip)))
    held ??= against(hand(rig), grip.quaternion)
    twist = Math.max(twist, turned(hand(rig), grip.quaternion, held))
  }
  // (it lags most as he turns sharply)
  expect(worst).toBeLessThan(0.01)
  expect(twist).toBeLessThan(0.05)
})

test('both hands stay on one bar as it moves', () => {
  const { scene, body } = setup()
  const bar = new Object3D()
  scene.add(bar)
  const grips = { left: new Object3D(), right: new Object3D() }
  grips.left.position.x = 0.2
  grips.right.position.x = -0.2
  bar.add(grips.left, grips.right)
  const pose = (t: number) => bar.position.set(0.1 * Math.sin(2 * t), 1.1 + 0.1 * Math.sin(3 * t), 0.4)
  pose(0)
  body.hand.left.to(grips.left.position, { on: bar })
  body.hand.right.to(grips.right.position, { on: bar })
  let worst = 0
  for (let t = 0; t < 5; t += FRAME) {
    body.update(FRAME)
    pose(t + FRAME)
    if (t < 1.5) continue
    for (const side of ['left', 'right'] as const) {
      worst = Math.max(worst, body.hand[side].value.distanceTo(place(grips[side])))
    }
  }
  expect(worst).toBeLessThan(0.005)
})

test('a thing that goes out of reach is no error: the hand goes as near it as it can, and is on it again once it is back', () => {
  const { scene, body } = setup()
  const grip = new Object3D()
  grip.position.set(-0.2, 1.1, 0.4)
  scene.add(grip)
  body.hand.right.to(HERE, { on: grip })
  for (let t = 0; t < 1.5; t += FRAME) body.update(FRAME)
  expect(body.hand.right.there).toBe(true)
  for (let t = 0; t < 2; t += FRAME) {
    grip.position.z = Math.min(1.6, grip.position.z + 1.2 * FRAME)
    body.update(FRAME)
  }
  // (reaching after it, as far as his arm goes)
  expect(body.hand.right.value.z).toBeGreaterThan(0.5)
  expect(body.hand.right.there).toBe(false)
  for (let t = 0; t < 2.5; t += FRAME) {
    grip.position.z = Math.max(0.4, grip.position.z - 1.2 * FRAME)
    body.update(FRAME)
  }
  expect(body.hand.right.there).toBe(true)
  expect(body.hand.right.value.distanceTo(place(grip))).toBeLessThan(0.01)
})

test('a palm carried before him faces the same way from him as he turns', () => {
  const { rig, body } = setup()
  body.hand.right.to({ x: -0.15, y: -0.2, z: 0.4 }, { on: body, palm: { x: 1, y: 0, z: 0 } })
  const facing = () => new Quaternion().setFromAxisAngle(UP, Math.atan2(body.facing.x, body.facing.z))
  for (let t = 0; t < 1.5; t += FRAME) body.update(FRAME)
  const was = against(hand(rig), facing())
  body.face({ x: 1, z: 0 })
  for (let t = 0; t < 2; t += FRAME) body.update(FRAME)
  expect(body.facing.x).toBeCloseTo(1, 2)
  expect(turned(hand(rig), facing(), was)).toBeLessThan(0.05)
})

test('what is stated with no story playing is not undone', () => {
  const { body } = setup()
  const there = new Vector3(-0.3, 1.3, 0.35)
  body.hand.right.to(there)
  for (let t = 0; t < 2.5; t += FRAME) body.update(FRAME)
  expect(body.hand.right.value.distanceTo(there)).toBeLessThan(0.005)
})

test('led with his hips held low he goes at that height, stopped he settles to it, and held lower than he walks he goes crouched', () => {
  const { body } = setup()
  const low = 0.76 * body.size.stand
  body.hips.to({ y: low })
  let [lowest, highest] = [Infinity, 0]
  for (let t = 0; t < 6; t += FRAME) {
    body.go(t < 4 ? { x: 0, z: 0.9 } : { x: 0, z: 0 })
    body.update(FRAME)
    if (t > 2 && t < 4) [lowest, highest] = [Math.min(lowest, body.hips.value.y), Math.max(highest, body.hips.value.y)]
  }
  expect(lowest).toBeGreaterThan(low - 0.05)
  expect(highest).toBeLessThan(low + 0.03)
  expect(body.hips.value.y).toBeCloseTo(low, 2)
  body.hips.to({ y: 0.5 * body.size.stand })
  for (let t = 0; t < 2; t += FRAME) {
    body.go({ x: 0, z: 0.9 })
    body.update(FRAME)
  }
  expect(body.hips.value.y).toBeGreaterThan(0.7 * body.size.stand)
})

test('led sideways at 1.2 m/s he keeps up, his feet under him', () => {
  const { body } = setup()
  let [gone, drift] = [0, 0]
  for (let t = 0; t < 6; t += FRAME) {
    body.go({ x: -1.2, z: 0 })
    body.face({ x: 0, z: 1 })
    const from = body.hips.value.clone()
    body.update(FRAME)
    if (t < 3) continue
    gone += body.hips.value.clone().sub(from).setY(0).length()
    const feet = body.foot.left.value.clone().add(body.foot.right.value).multiplyScalar(0.5)
    drift = Math.max(drift, feet.sub(body.hips.value).setY(0).length())
  }
  expect(gone / 3).toBeCloseTo(1.2, 1)
  expect(Math.abs(gone / 3 - 1.2)).toBeLessThan(0.04)
  expect(drift).toBeLessThan(0.1)
})

test('feet tucked up in a jump are his again to land on', () => {
  const { body } = setup()
  body.play(body.jump({ x: 0, y: 1.3 * body.size.stand, z: 0.3 }))
  const top = body.highest()
  for (const foot of [body.foot.left, body.foot.right]) {
    foot.by(top, { x: 0, y: -0.7 * body.size.leg, z: 0.1 }, { on: body })
  }
  for (let t = 0; t < 3; t += FRAME) body.update(FRAME)
  expect(body.foot.left.anchor).toBeDefined()
  expect(body.foot.right.anchor).toBeDefined()
  expect(body.hips.value.y).toBeGreaterThan(0.9 * body.size.stand)
})

/** steps of an update: of a frame at 60 or 200 Hz, or ragged between 2 ms and 30 ms */
const STEPS = {
  60: () => 1 / 60,
  200: () => 1 / 200,
  ragged: (
    (k) => () =>
      0.002 + 0.028 * (((k = (k * 16807) % 2147483647) % 1000) / 1000)
  )(7),
}

test('both hands stay on a bar carried before his chest, the left palm up under it, as he walks, sidesteps and sprints into a hard turn', () => {
  for (const step of Object.values(STEPS)) {
    const { scene, body } = setup()
    const bar = new Object3D()
    scene.add(bar)
    // the game carries it each frame before his chest, as his hips go and he faces
    const pose = () => {
      const { x, z } = body.facing
      bar.position.copy(body.hips.value).add(new Vector3(0.27 * x - 0.12 * z, 0.3, 0.27 * z + 0.12 * x))
      bar.quaternion.setFromAxisAngle(UP, Math.atan2(x, z))
    }
    pose()
    body.hand.right.to({ x: 0, y: -0.03, z: 0 }, { on: bar, palm: { x: 1, y: 0, z: 0 } })
    body.hand.left.to({ x: 0.2, y: -0.04, z: 0.12 }, { on: bar, palm: { x: 0, y: 1, z: 0 } })
    let [worst, errors] = [0, 0]
    for (let t = 0; t < 9;) {
      const ahead = t < 7.5 ? { x: 0, z: 4.5 } : { x: 4.5, z: 0 }
      body.go(t < 2 ? { x: 0, z: 1.4 } : t < 4 ? { x: 1.2, z: 0 } : t < 6 ? { x: -1.2, z: 0 } : ahead)
      if (t < 6) body.face({ x: 0, z: 1 })
      else body.face()
      const dt = step()
      try {
        body.update(dt)
      } catch {
        errors++
      }
      pose()
      t += dt
      if (t < 1) continue
      bar.updateMatrixWorld(true)
      const right = bar.localToWorld(new Vector3(0, -0.03, 0))
      const left = bar.localToWorld(new Vector3(0.2, -0.04, 0.12))
      worst = Math.max(worst, body.hand.right.value.distanceTo(right), body.hand.left.value.distanceTo(left))
    }
    expect(errors).toBe(0)
    expect(worst).toBeLessThan(0.02)
  }
})

test('a thing that leaps away faster than the hand can follow is no error: the hand lags behind it and catches up', () => {
  const { scene, body } = setup()
  const grip = new Object3D()
  grip.position.set(-0.2, 1.1, 0.4)
  scene.add(grip)
  body.hand.right.to(HERE, { on: grip })
  for (let t = 0; t < 1.5; t += FRAME) body.update(FRAME)
  grip.position.set(-0.24, 1.18, 0.44)
  body.update(FRAME)
  expect(body.hand.right.value.distanceTo(place(grip))).toBeGreaterThan(0.02)
  for (let t = 0; t < 1; t += FRAME) body.update(FRAME)
  expect(body.hand.right.there).toBe(true)
  expect(body.hand.right.value.distanceTo(place(grip))).toBeLessThan(0.01)
})

/** a rifle before him in the scene, which the game poses each frame from his right shoulder along an aim, and both hands that hold it, letting it give way */
function rifleman() {
  const { scene, rig, body } = setup()
  const hands = { right: new Hand(rig, 'right'), left: new Hand(rig, 'left') }
  const gun = rifle()
  const handle = gun.getObjectByName('fore')
  if (!handle) throw new Error('the rifle has no foregrip')
  const held = { right: pistol(hands.right, gun).held, left: fore(hands.left, handle) }
  gun.scale.setScalar(body.size.arm / ARM)
  scene.add(gun)
  const shoulder = rig.getObjectByName('rightUpperArm') as Object3D
  /** the rifle as the game would have it, its butt so far from the shoulder as he faces, along an aim (rad) */
  const pose = (aim: number, butt = new Vector3(0.05, -0.04, 0)) => {
    gun.quaternion.setFromAxisAngle(UP, aim)
    gun.position.copy(shoulder.getWorldPosition(new Vector3())).add(butt.applyAxisAngle(UP, aim))
    return { position: gun.position.clone(), quaternion: gun.quaternion.clone() }
  }
  body.hold(gun)
  for (const side of ['right', 'left'] as const) body.hand[side].to(held[side])
  /** how far each hand is from where its grip has it on the rifle as it is (m) */
  const off = () =>
    Math.max(
      ...(['right', 'left'] as const).map((side) => {
        const { target, position, quaternion } = held[side]
        const sits = new Matrix4().compose(position, quaternion, new Vector3(1, 1, 1))
        const wrist = new Vector3().setFromMatrixPosition(target.matrixWorld.clone().multiply(sits.invert()))
        return wrist.distanceTo(rig.getObjectByName(`${side}Hand`)!.getWorldPosition(new Vector3()))
      }),
    )
  return { scene, rig, body, gun, pose, off }
}

/** the most the rifle moves in a step as it is carried round (m), and turns (rad): never a jump to another hold */
const STEP = { move: 0.08, turn: 0.25 }

test.each([1, 2])(
  'a rifle that gives way stays in both hands as its aim sweeps half round him and back at %i turns a second, faster than his arms follow, never jumps, and is as it is to be again soon after',
  (rate) => {
    const { scene, body, gun, pose, off } = rifleman()
    let [lag, wish] = [0, pose(0)]
    for (let t = 0; t < 1.5; t += FRAME) {
      wish = pose(0)
      body.update(FRAME)
    }
    const long = 1 / (2 * rate)
    for (let t = 0; t < 2 * long + 0.5; t += FRAME) {
      const was = { position: gun.position.clone(), quaternion: gun.quaternion.clone() }
      wish = pose(Math.PI * Math.max(0, t < long ? t / long : 2 - t / long))
      body.update(FRAME)
      scene.updateMatrixWorld(true)
      expect(off()).toBeLessThan(0.01)
      expect(gun.position.distanceTo(was.position)).toBeLessThan(STEP.move)
      expect(gun.quaternion.angleTo(was.quaternion)).toBeLessThan(STEP.turn)
      lag = Math.max(lag, gun.position.distanceTo(wish.position))
    }
    expect(lag).toBeGreaterThan(0.05)
    expect(gun.position.distanceTo(wish.position)).toBeLessThan(0.01)
    expect(gun.quaternion.angleTo(wish.quaternion)).toBeLessThan(0.035)
  },
)

test('a rifle held in both hands that gives way, to be through his chest, is pushed out of it, and no forearm goes into the trunk', () => {
  const { scene, rig, body, gun, pose, off } = rifleman()
  const { shoulder, trunk } = body.size
  const at = (name: string) => (rig.getObjectByName(name) as Object3D).getWorldPosition(new Vector3())
  let [deepest, worst, wish] = [0, 0, pose(0)]
  // (both hands take hold of it first)
  for (let t = 0; t < 2; t += FRAME) {
    pose(0)
    body.update(FRAME)
  }
  expect([body.hand.left.there, body.hand.right.there]).toEqual([true, true])
  for (let t = 0; t < 1.5; t += FRAME) {
    // its butt behind his back, between his shoulders
    wish = pose(0, new Vector3(0.2, -0.1, -0.25))
    body.update(FRAME)
    scene.updateMatrixWorld(true)
    if (t < 0.5) continue
    worst = Math.max(worst, off())
    const middle = at('rightUpperArm').add(at('leftUpperArm')).divideScalar(2)
    for (const side of ['right', 'left']) {
      const forearm = at(`${side}LowerArm`)
        .add(at(`${side}Hand`))
        .divideScalar(2)
      const below = middle.y - forearm.y
      if (below < 0 || below > trunk) continue
      const out = Math.hypot(forearm.x - middle.x, forearm.z - middle.z)
      deepest = Math.max(deepest, 0.65 * shoulder - out)
    }
  }
  expect(gun.position.distanceTo(wish.position)).toBeGreaterThan(0.1)
  expect(worst).toBeLessThan(0.01)
  expect(deepest).toBeLessThan(0.01)
})
