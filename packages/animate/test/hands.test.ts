import { grip, Hand } from '@drawcall/hand'
import { Euler, Line3, Mesh, Object3D, Quaternion, Scene, SphereGeometry, Vector3 } from 'three'
import { expect, test } from 'vitest'
import { other, person } from '../../../examples/person'
import { Body, type Pose, type Story } from '../src'
import { tick } from '@drawcall/limbs'

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
/** a hand flat, in a fist, and pointing with the index: as `@drawcall/hand` has them */
const flat: Pose = {
  thumb: { spread: 0, bend: [0, 0, 0] },
  index: { spread: 0, bend: [0, 0, 0] },
  middle: { spread: 0, bend: [0, 0, 0] },
  ring: { spread: 0, bend: [0, 0, 0] },
  little: { spread: 0, bend: [0, 0, 0] },
}
const fist: Pose = {
  thumb: { spread: -0.4, bend: [0.8, 0.15, 1.2] },
  index: { spread: -0.06, bend: [1.45, 1.75, 0.75] },
  middle: { spread: 0, bend: [1.45, 1.75, 0.75] },
  ring: { spread: 0.05, bend: [1.45, 1.7, 0.7] },
  little: { spread: 0.1, bend: [1.4, 1.55, 0.6] },
}
const point: Pose = { ...fist, index: flat.index }
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

test('a wrist asked for more than it turns is no error: the hand is there, turned as near as the wrist turns it', () => {
  const body = new Body(person())
  const place = { x: -0.2, y: 1.1, z: 0.4 }
  body.hand.right.to(place, { palm: { x: -1, y: 0, z: 0 } })
  for (let t = 0; t < 1.5; t += 1 / 60) body.update(1 / 60)
  expect(body.hand.right.value.distanceTo(new Vector3().copy(place))).toBeLessThan(0.02)
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

test('a pose the fingers are given they keep as the hand is let free and he stands', () => {
  const rig = person()
  const body = new Body(rig)
  play(body, body.hand.left.shape(fist))
  const closed = curls(rig)
  body.hand.left.free()
  play(body, body.stand())
  settle(body)
  curls(rig).forEach((curl, k) => expect(curl).toBeCloseTo(closed[k], 2))
})

test('a pose by a moment is had at it, and not a tenth of a second before', () => {
  const rig = person()
  const body = new Body(rig)
  play(body, body.hand.left.shape(fist))
  const closed = curls(rig)
  play(body, body.hand.left.shape())
  const moment = body.time + 1
  body.hand.left.shape(fist, { by: moment })
  while (body.time < moment - 0.1 - 1e-9) body.update(tick(body.size))
  expect(Math.max(...curls(rig).map((curl, k) => Math.abs(curl - closed[k])))).toBeGreaterThan(0.3)
  while (body.time < moment - 1e-9) body.update(tick(body.size))
  curls(rig).forEach((curl, k) => expect(curl).toBeCloseTo(closed[k], 2))
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

test('a pose bends a finger toward the palm and spreads it toward the thumb, the two hands mirrored: at any size', () => {
  for (const scale of [0.5, 1, 1.5]) {
    const rig = person(scale)
    const body = new Body(rig)
    const bent: Pose = { ...flat, index: { spread: 0.3, bend: [0, 0, 0] }, middle: { spread: 0, bend: [1.5, 0, 0] } }
    play(body, body.hand.left.shape(bent))
    play(body, body.hand.right.shape(bent))
    const { local, thick } = hand(rig)
    // (the middle finger straight out of the palm from its knuckle, the index turned thumbward in it)
    const out = local('MiddleDistal_end').sub(local('MiddleProximal'))
    expect(out.z).toBeGreaterThan(0.9 * out.length())
    const [index, ring] = ['Index', 'Ring'].map((f) =>
      local(`${f}Distal_end`)
        .sub(local(`${f}Proximal`))
        .normalize(),
    )
    expect(index.y - ring.y).toBeGreaterThan(0.25)
    expect(Math.abs(index.z)).toBeLessThan(thick / 4)
    // (each in its own hand: standing at his ease, his weight is over one foot)
    const [left, right] = (['left', 'right'] as const).map((side) => hand(rig, side).local('IndexDistal_end'))
    expect(right.toArray()).toEqual(left.toArray().map((v) => expect.closeTo(v, 6)))
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
      const moment = body.time + 1
      const thrown = body.hand.right.by(
        moment,
        { x: -0.25, y: 1.6, z: 0.4 },
        { velocity: { x: 0, y: 3, z: 6 }, palm: { x: 0, y: 0, z: 1 } },
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

/** a thing as it sits in the right hand: across the palm, a little out of it and turned (m, in the hand bone's frame) */
const held = {
  position: new Vector3(0.06, -0.03, 0.02),
  quaternion: new Quaternion().setFromEuler(new Euler(0.4, -1.2, 0.3)),
}
/** the fingers hanging loose: a pose for a grip that says nothing of them */
const RELAXED: Pose = {
  thumb: { spread: 0, bend: [0.2, 0.1, 0.2] },
  index: { spread: 0, bend: [0.2, 0.3, 0.2] },
  middle: { spread: 0, bend: [0.2, 0.3, 0.2] },
  ring: { spread: 0, bend: [0.2, 0.3, 0.2] },
  little: { spread: 0, bend: [0.2, 0.3, 0.2] },
}
/** how far off a thing sits from where it is to in the right hand's bone (m, rad) */
function off(rig: Object3D, thing: Object3D) {
  rig.updateMatrixWorld(true)
  const sits = bone(rig, 'rightHand').matrixWorld.clone().invert().multiply(thing.matrixWorld)
  const [at, turned] = [new Vector3(), new Quaternion()]
  sits.decompose(at, turned, new Vector3())
  return { by: at.distanceTo(held.position), turned: turned.angleTo(held.quaternion) }
}

test('a thing bound to his hand is where it is sent, pointing as stated, and rolled as the leading palm is said to face, the same each time', () => {
  const rig = person()
  const body = new Body(rig)
  const scene = new Object3D().add(rig)
  const thing = new Object3D()
  thing.position.set(-0.25, 1.1, 0.4)
  scene.add(thing)
  const grip = { target: thing, ...held, pose: RELAXED }
  play(body, body.hand.right.to(grip))
  const carried = body.bind(thing)
  carried.on(body.hand.right, grip)
  const [place, way] = [new Vector3(-0.25, 1.15, 0.45), new Vector3(0, 0.3, 1).normalize()]
  play(body, carried.to(place, { pointing: way }))
  rig.updateMatrixWorld(true)
  expect(thing.getWorldPosition(new Vector3()).distanceTo(place)).toBeLessThan(0.002)
  const along = (axis: Vector3) => axis.clone().transformDirection(thing.matrixWorld)
  expect(along(new Vector3(0, 0, 1)).angleTo(way)).toBeLessThan(0.01)
  // (rolled about that way as near as the wrist turns the palm to face left, pointing on as it was)
  const up = new Vector3(0, 1, 0)
  const tops = [0, 1].map(() => {
    play(body, carried.to(place, { pointing: way, palm: { x: 1, y: 0, z: 0 } }))
    rig.updateMatrixWorld(true)
    return along(up).clone()
  })
  expect(along(new Vector3(0, 0, 1)).angleTo(way)).toBeLessThan(0.3)
  expect(tops[0].angleTo(tops[1])).toBeLessThan(0.01)
})

test('a hand sent by a grip to a thing he does not hold holds it as stated, and keeps it as the thing moves', () => {
  const rig = person()
  const body = new Body(rig)
  const scene = new Object3D().add(rig)
  const thing = new Object3D()
  thing.position.set(-0.25, 1.1, 0.4)
  thing.quaternion.setFromEuler(new Euler(0, 0.3, 0))
  scene.add(thing)
  const grip = { target: thing, ...held, pose: RELAXED }
  play(body, body.hand.right.to(grip))
  expect(off(rig, thing).by).toBeLessThan(0.002)
  expect(off(rig, thing).turned).toBeLessThan(0.01)
  for (let t = 0; t < 0.5; t += tick(body.size)) {
    thing.position.y += 0.1 * tick(body.size)
    body.update(tick(body.size))
  }
  expect(off(rig, thing).by).toBeLessThan(0.01)
  expect(() => body.hand.right.to(grip, { palm: { x: 0, y: 1, z: 0 } })).toThrow(/leave out `palm`/)
})

/** how thick a finger and the palm are about their bones: half the least that two knuckles side by side are apart */
const thick = (rig: Object3D) => {
  const knuckles = DIGITS.map((finger) => at(rig, `right${finger}Proximal`))
  return Math.min(...knuckles.slice(1).map((knuckle, k) => knuckle.distanceTo(knuckles[k]))) / 2
}

test('a palm sent flat to a wall is on it with its skin', () => {
  const rig = person()
  const body = new Body(rig)
  const wall = 0.5
  play(body, body.hand.right.to({ x: -0.2, y: 1.3, z: wall }, { with: 'palm', palm: { x: 0, y: 0, z: 1 } }))
  rig.updateMatrixWorld(true)
  // (the middle of the palm: halfway from the wrist to the knuckles, as thick as a finger short of the wall)
  const knuckles = DIGITS.map((finger) => at(rig, `right${finger}Proximal`))
  const centre = knuckles.reduce((sum, knuckle) => sum.add(knuckle), new Vector3()).divideScalar(4)
  expect(Math.abs(centre.lerp(at(rig, 'rightHand'), 0.5).z - (wall - thick(rig)))).toBeLessThan(0.005)
})

test('a hand sent with a grip has what hangs in it by that grip at the place', () => {
  const rig = person()
  const ball = new Mesh(new SphereGeometry(0.12))
  new Scene().add(rig, ball)
  const hand = new Hand(rig, 'right')
  const seat = grip(hand, ball, { at: new Vector3(0, -0.12, 0), from: new Vector3(0, -1, 0) })
  hand.bone.attach(ball)
  ball.position.copy(seat.position)
  ball.quaternion.copy(seat.quaternion)
  const body = new Body(rig)
  const place = new Vector3(-0.25, 1.3, 0.35)
  play(body, body.hand.right.to(place, { with: seat, palm: { x: 0, y: 1, z: 0 } }))
  rig.updateMatrixWorld(true)
  expect(ball.getWorldPosition(new Vector3()).distanceTo(place)).toBeLessThan(0.005)
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
    // (the skin at the end of the index: as thick as a finger on from the end of its last bone)
    const tip = () => {
      rig.updateMatrixWorld(true)
      const end = at(rig, 'rightIndexDistal_end')
      return end.clone().sub(at(rig, 'rightIndexDistal')).setLength(thick(rig)).add(end)
    }
    play(
      body,
      (function* () {
        const there = hand.by(body.time + 0.8, place, { with: 'index', velocity })
        hand.shape(point)
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
        // (the tip is put at its place exactly; how fast it goes there is how fast the arm brings it)
        expect(over.lerp(last, -0.5).distanceTo(velocity)).toBeLessThan(1)
      })(),
    )
  }
})

test('a hand turned a way that is none says so at the statement, and one turned faster than its wrist turns is late', () => {
  const rig = person()
  const body = new Body(rig)
  const hand = body.hand.right
  const place = { x: -0.2, y: 1.1, z: 0.4 }
  const [up, down] = [new Vector3(0, 1, 0), new Vector3(0, -1, 0)]
  expect(() => hand.to(place, { palm: { x: 0, y: 0, z: 0 } })).toThrow(/leads nowhere/)
  expect(() => hand.to(place, { palm: up, pointing: down })).toThrow(/point the way its palm faces/)
  play(body, hand.to(place, { palm: up }))
  // (it is there as soon after as its wrist turns it)
  const from = body.time
  play(body, hand.to(place, { palm: down, seconds: 0.02 }))
  expect(body.time - from).toBeGreaterThan(0.1)
  rig.updateMatrixWorld(true)
  expect(palm(rig).angleTo(down)).toBeLessThan(0.1)
})

test('a rig may rest its arms short and bent, the forearms turned and the hands bent back: a palm faces as stated', () => {
  for (const rig of [person(), other()]) {
    const body = new Body(rig)
    const up = new Vector3(0, 1, 0)
    play(body, body.hand.right.to({ x: -0.2, y: 1.15, z: 0.25 }, { palm: up }))
    rig.updateMatrixWorld(true)
    // (out of the palm, as its knuckles have it: square to the way to the middle one and to the row of them)
    const along = at(rig, 'rightMiddleProximal').sub(at(rig, 'rightHand'))
    const across = at(rig, 'rightIndexProximal').sub(at(rig, 'rightLittleProximal'))
    expect(across.cross(along).normalize().angleTo(up)).toBeLessThan(0.05)
  }
})

test('a rig without finger bones says so when its fingers are stated', () => {
  const hand = new Body(mitts()).hand.left
  expect(() => hand.shape(fist)).toThrow(/fingers of the left hand are to take a pose, and its rig has no finger bones/)
  expect(() => hand.to({ x: 0.2, y: 1.1, z: 0.4 }, { with: 'index' })).toThrow(/rig has no finger bones/)
})

test('a pose past how far a finger turns says so at the statement', () => {
  const hand = new Body(person()).hand.left
  expect(() => hand.shape({ ...fist, ring: { spread: 0, bend: [0.2, 2.1, 0.2] } })).toThrow(
    "the left hand's ring is to be bent at the middle joint 2.1 rad, and goes only from 0.00 to 1.90",
  )
})
