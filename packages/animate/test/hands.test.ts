import { Line3, type Object3D, Quaternion, Vector3 } from 'three'
import { expect, test } from 'vitest'
import { person } from '../../../examples/person'
import { Body, type Story } from '../src'
import { tick } from '../src/size'

const bone = (rig: Object3D, name: string) => {
  const found = rig.getObjectByName(name)
  if (!found) throw new Error(`the person has no ${name}`)
  return found
}
const at = (rig: Object3D, name: string) => bone(rig, name).getWorldPosition(new Vector3())
const play = (body: Body, story: Story<unknown>) => {
  body.play(story)
  while (body.playing) body.update(tick(body.size))
}
/** the person with no bones in his hands */
function mitts() {
  const rig = person()
  for (const side of ['left', 'right']) bone(rig, `${side}Hand`).clear()
  return rig
}
/** which way the palm of the person's right hand faces: down, as his rig has it at rest */
const palm = (rig: Object3D) =>
  new Vector3(0, -1, 0).applyQuaternion(bone(rig, 'rightHand').getWorldQuaternion(new Quaternion()))

test('a hand sent somewhere turned arrives with its palm facing as stated, and stays so: on a rig with no fingers', () => {
  const rig = mitts()
  const body = new Body(rig)
  const up = new Vector3(0, 1, 0)
  play(
    body,
    (function* () {
      yield* body.hand.right.to({ x: -0.2, y: 1.1, z: 0.4 }, { palm: up })
      rig.updateMatrixWorld(true)
      expect(palm(rig).angleTo(up)).toBeLessThan(0.05)
      // he walks on under it, and it stays turned so
      body.walk(0.15)
      yield* body.until(body.time + 0.5)
      rig.updateMatrixWorld(true)
      expect(palm(rig).angleTo(up)).toBeLessThan(0.05)
    })(),
  )
})

test('a wrist asked for more than it turns says so at the statement', () => {
  const hand = new Body(person()).hand.right
  expect(() => hand.to({ x: -0.2, y: 1.1, z: 0.4 }, { palm: { x: -1, y: 0, z: 0 } })).toThrow(
    /right hand is sent to .* the right wrist would twist the forearm .* further than it does: have the palm face/,
  )
})

/**
 * the left hand of a rig, as its bones are now: where a bone is from the wrist along the fingers, across toward the
 * thumb and out of the palm, the way the forearm goes, and how thick a finger is: as far as two knuckles are apart
 */
function hand(rig: Object3D, side = 'left') {
  rig.updateMatrixWorld(true)
  const wrist = at(rig, `${side}Hand`)
  const u = at(rig, `${side}MiddleProximal`).sub(wrist).normalize()
  const w = at(rig, `${side}IndexProximal`).sub(at(rig, `${side}LittleProximal`))
  w.addScaledVector(u, -w.dot(u)).normalize()
  const n = u
    .clone()
    .cross(w)
    .multiplyScalar(side === 'left' ? 1 : -1)
  const from = (p: Vector3) => p.sub(wrist)
  const local = (name: string) => {
    const p = from(at(rig, `${side}${name}`))
    return new Vector3(p.dot(u), p.dot(w), p.dot(n))
  }
  const forearm = wrist
    .clone()
    .sub(at(rig, `${side}LowerArm`))
    .normalize()
  const thick = at(rig, `${side}IndexProximal`).distanceTo(at(rig, `${side}MiddleProximal`))
  return { local, forearm, n, thick, tip: (finger: string) => at(rig, `${side}${finger}Distal_end`) }
}
const DIGITS = ['Index', 'Middle', 'Ring', 'Little']
/** how far each finger is curled: the angle from its knuckle to its tip, away from the way it lies flat (rad) */
const curls = (rig: Object3D) => {
  const { local } = hand(rig)
  return DIGITS.map((finger) => {
    const way = local(`${finger}Distal_end`).sub(local(`${finger}Proximal`))
    return Math.atan2(way.z, way.x)
  })
}
const settle = (body: Body, seconds = 1) => {
  for (let t = 0; t < seconds; t += tick(body.size)) body.update(tick(body.size))
}

test('a shape the fingers are given they keep as the hand is let free and he stands', () => {
  const rig = person()
  const body = new Body(rig)
  play(body, body.hand.left.shape('fist'))
  const fist = curls(rig)
  body.hand.left.free()
  play(body, body.stand())
  settle(body)
  curls(rig).forEach((curl, k) => expect(curl).toBeCloseTo(fist[k], 2))
})

test('a shape by a moment is had at it, and not a tenth of a second before', () => {
  const rig = person()
  const body = new Body(rig)
  play(body, body.hand.left.shape('fist'))
  const fist = curls(rig)
  play(body, body.hand.left.shape())
  const moment = body.time + 1
  body.hand.left.shape('fist', { by: moment })
  while (body.time < moment - 0.1 - 1e-9) body.update(tick(body.size))
  expect(Math.max(...curls(rig).map((curl, k) => Math.abs(curl - fist[k])))).toBeGreaterThan(0.3)
  while (body.time < moment - 1e-9) body.update(tick(body.size))
  curls(rig).forEach((curl, k) => expect(curl).toBeCloseTo(fist[k], 2))
})

test('relaxed fingers are lightly curled, each more than the last, the thumb resting by the index: at any size', () => {
  for (const scale of [0.5, 1, 1.5]) {
    const rig = person(scale)
    const body = new Body(rig)
    settle(body)
    const relaxed = curls(rig)
    for (const curl of relaxed) expect(curl).toBeGreaterThan(0.3)
    for (const curl of relaxed) expect(curl).toBeLessThan(1.4)
    relaxed.slice(1).forEach((curl, k) => expect(curl).toBeGreaterThan(relaxed[k]))
    const { tip, thick } = hand(rig)
    const index = ['IndexProximal', 'IndexIntermediate', 'IndexDistal', 'IndexDistal_end'].map((name) =>
      at(rig, `left${name}`),
    )
    const near = Math.min(
      ...[0, 1, 2].map((k) =>
        new Line3(index[k], index[k + 1])
          .closestPointToPoint(tip('Thumb'), true, new Vector3())
          .distanceTo(tip('Thumb')),
      ),
    )
    expect(near).toBeLessThan(1.5 * thick)
  }
})

test('in a fist the fingertips are tucked into the palm, and the thumb lies across the outside of the index: at any size', () => {
  for (const scale of [0.5, 1, 1.5]) {
    const rig = person(scale)
    const body = new Body(rig)
    play(body, body.hand.left.shape('fist'))
    const { local, thick } = hand(rig)
    for (const finger of DIGITS) expect(local(`${finger}Distal_end`).z).toBeLessThan(thick)
    const [thumb, index] = [local('ThumbDistal_end'), local('IndexIntermediate')]
    expect(thumb.y).toBeLessThan(index.y)
    expect(thumb.z).toBeGreaterThan(index.z)
  }
})

test('a hand that throws has the wrist drawn back before the moment, and bent on through it after', () => {
  const rig = person()
  const body = new Body(rig)
  // (how far the hand is bent toward the palm against the forearm, rad)
  const flexed = () => {
    const { forearm, n } = hand(rig, 'right')
    return -Math.asin(forearm.dot(n))
  }
  const seen: number[] = []
  play(
    body,
    (function* () {
      yield* body.hand.right.shape({ around: 0.03 })
      const moment = body.time + 1
      const thrown = body.hand.right.by(
        moment,
        { x: -0.25, y: 1.6, z: 0.4 },
        { velocity: { x: 0, y: 3, z: 6 }, with: 'grip' },
      )
      for (const [when, k] of [
        [moment - 0.1, 0],
        [moment + 0.1, 1],
      ] as const) {
        while (body.time < when - 1e-9) yield
        seen[k] = flexed()
      }
      yield* thrown
    })(),
  )
  expect(seen[0]).toBeLessThan(-0.1)
  expect(seen[1]).toBeGreaterThan(0.1)
})

test('a handle hung at the grip lies in the closed fingers, on along the forearm as the wrist rests', () => {
  const rig = person()
  const body = new Body(rig)
  const thick = 0.02
  play(body, body.hand.left.shape({ around: thick }))
  settle(body)
  const { grip } = body.hand.left
  const { tip, forearm, thick: finger } = hand(rig)
  const [o, z] = [grip.localToWorld(new Vector3()), grip.localToWorld(new Vector3(0, 0, 1))]
  const handle = new Line3(o, z)
  for (const name of ['Thumb', ...DIGITS]) {
    expect(handle.closestPointToPoint(tip(name), false, new Vector3()).distanceTo(tip(name)) - thick).toBeLessThan(
      finger,
    )
  }
  expect(z.sub(o).angleTo(forearm)).toBeLessThan((25 * Math.PI) / 180)
})

test('a hand that holds something points what it holds', () => {
  const body = new Body(person())
  const way = new Vector3(0, 0.3, 1).normalize()
  play(
    body,
    (function* () {
      yield* body.hand.right.shape({ around: 0.02 })
      yield* body.hand.right.to({ x: -0.25, y: 1.1, z: 0.45 }, { pointing: way })
    })(),
  )
  const { grip } = body.hand.right
  grip.updateWorldMatrix(true, false)
  const [o, z] = [grip.localToWorld(new Vector3()), grip.localToWorld(new Vector3(0, 0, 1))]
  expect(z.sub(o).angleTo(way)).toBeLessThan((3 * Math.PI) / 180)
})

test('a palm sent flat to a wall is on it', () => {
  const rig = person()
  const body = new Body(rig)
  const wall = 0.5
  play(body, body.hand.right.to({ x: -0.2, y: 1.3, z: wall }, { with: 'palm', palm: { x: 0, y: 0, z: 1 } }))
  rig.updateMatrixWorld(true)
  // (the middle of the palm: halfway from the wrist to the knuckles)
  const knuckles = DIGITS.map((finger) => at(rig, `right${finger}Proximal`))
  const centre = knuckles.reduce((sum, knuckle) => sum.add(knuckle), new Vector3()).divideScalar(4)
  expect(Math.abs(centre.lerp(at(rig, 'rightHand'), 0.5).z - wall)).toBeLessThan(0.005)
})

test('a fingertip sent somewhere is there at its moment, moving as stated, however the arm is bent and whenever the fingers were shaped', () => {
  for (const [place, velocity] of [
    [new Vector3(-0.2, 1.25, 0.5), new Vector3()],
    [new Vector3(-0.2, 0.9, 0.3), new Vector3()],
    [new Vector3(-0.2, 1, 0.45), new Vector3(0, -1.5, 0)],
  ]) {
    const rig = person()
    const body = new Body(rig)
    const hand = body.hand.right
    const tip = () => (rig.updateMatrixWorld(true), at(rig, 'rightIndexDistal_end'))
    play(
      body,
      (function* () {
        const there = hand.by(body.time + 0.8, place, { with: 'index', velocity })
        hand.shape('point')
        // how it moved over the step of time before the last
        let [last, was] = [new Vector3(), tip()]
        while (!there.next().done) {
          const now = tip()
          last = now.clone().sub(was).divideScalar(tick(body.size))
          was = now
          yield
        }
        expect(tip().distanceTo(place)).toBeLessThan(0.002)
        const over = tip().sub(was).divideScalar(tick(body.size))
        // (it speeds up into the moment: how it moves at it is half a step on from how it moved over the last)
        expect(over.lerp(last, -0.5).distanceTo(velocity)).toBeLessThan(0.1)
      })(),
    )
  }
})

test('a hand turned a way that is none, or faster than its wrist turns, says so at the statement', () => {
  const body = new Body(person())
  const hand = body.hand.right
  const place = { x: -0.2, y: 1.1, z: 0.4 }
  const [up, down] = [new Vector3(0, 1, 0), new Vector3(0, -1, 0)]
  expect(() => hand.to(place, { palm: { x: 0, y: 0, z: 0 } })).toThrow(/leads nowhere/)
  expect(() => hand.to(place, { palm: up, pointing: down })).toThrow(/point the way its palm faces/)
  play(body, hand.to(place, { palm: up }))
  expect(() => hand.to(place, { palm: down, seconds: 0.02 })).toThrow(/right wrist would have to be pushed/)
})

test('a rig whose palms do not face down with the arms out is not at rest', () => {
  const rig = person()
  bone(rig, 'leftHand').rotateX(-Math.PI / 2)
  rig.updateMatrixWorld(true)
  expect(() => new Body(rig)).toThrow(/rig at rest.*a palm does not face down/)
})

test('a rig without finger bones says so when its fingers are stated', () => {
  const hand = new Body(mitts()).hand.left
  expect(() => hand.shape('fist')).toThrow(
    /fingers of the left hand are to take a shape, and its rig has no finger bones/,
  )
  expect(() => hand.to({ x: 0.2, y: 1.1, z: 0.4 }, { with: 'index' })).toThrow(/rig has no finger bones/)
})
