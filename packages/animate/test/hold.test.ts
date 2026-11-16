import { Hand } from '@drawcall/hand'
import { Group, Matrix4, Object3D, Quaternion, Vector3 } from 'three'
import { expect, test } from 'vitest'
import { person } from '../../../examples/person'
import { ARM, fore, pistol, pocket, rifle } from '../../../examples/shooter/rifle'
import { Body } from '../src'
import { RANGE } from '../src/rig/joints'

/** how far a turn is past a range, summed over its axes (rad) */
const beyond = (value: Vector3, range: Partial<Record<'x' | 'y' | 'z', readonly number[]>>) =>
  (['x', 'y', 'z'] as const).reduce((sum, axis) => {
    const [least, most] = range[axis] ?? [-Infinity, Infinity]
    return sum + Math.max(0, least - value[axis], value[axis] - most)
  }, 0)

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

test('hands on a rifle the game moves are on it as he stands, and follow it as he walks and turns, as near as the arms reach', () => {
  const { scene, body, gun, pose, off } = rifleman()
  let [standing, going, turning] = [0, 0, 0]
  for (let t = 0; t < 10; t += FRAME) {
    if (t > 2) body.go({ x: 0, z: 1.4 })
    if (t > 6) body.go({ x: 1, z: 0.2 })
    if (t > 6) body.face({ x: 1, z: -1 })
    // the game sets it each frame along the way he faces, its butt in his shoulder's pocket, swaying a little
    const set = pose(Math.atan2(body.facing.x, body.facing.z) + 0.05 * Math.sin(3 * t))
    body.update(FRAME)
    scene.updateMatrixWorld(true)
    // (it is where the game set it: the hands never move it)
    expect(gun.position.distanceTo(set.position)).toBe(0)
    if (t > 1.5 && t < 2) standing = Math.max(standing, off())
    if (t > 2.5 && t < 6) going = Math.max(going, off())
    if (t > 6) turning = Math.max(turning, off())
  }
  expect(standing).toBeLessThan(0.002)
  // (between the steps of his clock they are drawn going on as they went; turning sharply, the rifle along the way he
  // is to face leads his trunk, and the arms come as near as they reach)
  expect(going).toBeLessThan(0.03)
  expect(turning).toBeLessThan(0.12)
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
  expect(drift).toBeLessThan(0.25)
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
    expect(worst).toBeLessThan(0.025)
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

/** a rifle the game moves, set each frame in his right shoulder's pocket along an aim, and both hands on it */
function rifleman() {
  const { scene, rig, body } = setup()
  const hands = { right: new Hand(rig, 'right'), left: new Hand(rig, 'left') }
  const gun = rifle()
  const handle = gun.getObjectByName('fore')
  if (!handle) throw new Error('the rifle has no foregrip')
  const held = { right: pistol(hands.right, gun).held, left: fore(hands.left, handle) }
  gun.scale.setScalar(body.size.arm / ARM)
  scene.add(gun)
  /** the rifle as the game has it, its butt in his shoulder's pocket, along an aim (rad) */
  const pose = (aim: number) => {
    gun.quaternion.setFromAxisAngle(UP, aim)
    gun.position.copy(pocket(body, 'right'))
    gun.updateMatrixWorld(true)
    return { position: gun.position.clone(), quaternion: gun.quaternion.clone() }
  }
  pose(0)
  const bound = body.bind(gun, { outside: true })
  for (const side of ['right', 'left'] as const) bound.on(body.hand[side], held[side])
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
  return { scene, rig, body, gun, bound, pose, off }
}

test.each([1, 2])(
  'a rifle the game sweeps half round him and back at %i turns a second, turning him to face where it aims as the shooter does and carrying it along the way his chest faces, is where the game sets it, no error, and the hands stay on it',
  (rate) => {
    const { scene, body, gun, bound, pose, off } = rifleman()
    for (let t = 0; t < 1.5; t += FRAME) {
      pose(0)
      body.update(FRAME)
    }
    const long = 1 / (2 * rate)
    let lag = 0
    for (let t = 0; t < 2 * long + 1.5; t += FRAME) {
      const aim = Math.PI * Math.max(0, t < long ? t / long : 2 - t / long)
      body.face({ x: Math.sin(aim), z: Math.cos(aim) })
      // (the rifle along the way his chest faces, as he comes round to the aim)
      const set = pose(Math.atan2(body.facing.x, body.facing.z) + body.trunk.value.y)
      body.update(FRAME)
      scene.updateMatrixWorld(true)
      expect(gun.position.distanceTo(set.position)).toBe(0)
      lag = Math.max(lag, off())
    }
    expect(lag).toBeLessThan(0.03)
    expect(off()).toBeLessThan(0.02)
    expect(bound.there).toBe(true)
  },
)

test('a rifle swept half round him with his feet planted is no error: the hands come as near as their arms turn, never past a joint, and are not there while it is out of reach', () => {
  const { scene, body, bound, pose, off } = rifleman()
  for (let t = 0; t < 1.5; t += FRAME) {
    pose(0)
    body.update(FRAME)
  }
  let [past, short] = [0, false]
  for (let t = 0; t < 2; t += FRAME) {
    pose(Math.PI * Math.min(1, t))
    body.update(FRAME)
    scene.updateMatrixWorld(true)
    for (const side of ['left', 'right'] as const) {
      const { first, second } = body.arm[side] === undefined ? { first: undefined, second: undefined } : { first: body.arm[side].value, second: body.forearm[side].value }
      if (first) past = Math.max(past, beyond(first, RANGE.arm), beyond(second!, RANGE.forearm))
    }
    if (off() > 0.03) short ||= !bound.there
  }
  expect(past).toBeLessThan(1e-6)
  expect(short).toBe(true)
})
