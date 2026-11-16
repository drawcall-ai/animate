import { BoxGeometry, type BufferGeometry, CylinderGeometry, Euler, Group, Mesh, SphereGeometry, Vector3 } from 'three'
import { expect, test } from 'vitest'
import { pistol } from './pistol'
import { person } from './person'
import { type Finger, fist, type Grip, grip, Hand, hold, point } from '../src'

const V = (x: number, y: number, z: number) => new Vector3(x, y, z)
/** a thing of some meshes, set somewhere in the world and turned */
function thing(...shapes: [BufferGeometry, Vector3?][]) {
  const target = new Group()
  for (const [shape, at = V(0, 0, 0)] of shapes)
    target.add(new Mesh(shape, undefined).translateX(at.x).translateY(at.y).translateZ(at.z))
  target.position.set(0.3, 1, 0.4)
  target.rotation.set(0.3, 0.5, 0.2)
  target.updateMatrixWorld(true)
  return target
}
const rod = (radius: number) => thing([new CylinderGeometry(radius, radius, 0.3, 24)])
const right = () => new Hand(person(), 'right')
/** a finger's rods as the grip holds them, in the target's frame */
const rods = (hand: Hand, target: Group, held: Grip, finger: Finger | 'palm') => {
  hold(hand, target, held)
  const local = (p: Vector3) => target.worldToLocal(p.clone())
  const all = hand.segments(held.pose, hand.bone.matrixWorld).filter((s) => s.element === finger)
  return all.map((s) => ({ ...s, a: local(s.a), b: local(s.b) }))
}
const tip = (hand: Hand, target: Group, held: Grip, finger: Finger) => rods(hand, target, held, finger)[2].b

test("a handle's butt end lies at the heel of the hand, its head out past the index", () => {
  const hand = right()
  const racket = thing([new CylinderGeometry(0.015, 0.015, 0.2, 24)], [new BoxGeometry(0.1, 0.1, 0.02), V(0, 0.15, 0)])
  const held = grip(hand, racket, { at: V(0.015, 0, 0), from: V(1, 0, 0) })
  expect(tip(hand, racket, held, 'index').sub(tip(hand, racket, held, 'little')).y).toBeGreaterThan(0)
})

test('the thumb opposes the fingers round a cylinder', () => {
  const [hand, target] = [right(), rod(0.04)]
  const { contacts } = grip(hand, target, { at: V(0.04, 0, 0), from: V(1, 0, 0) })
  expect(contacts.thumb.gap).toBeLessThan(0.002)
  expect(contacts.thumb.normal.angleTo(contacts.middle.normal)).toBeGreaterThan(Math.PI / 2)
})

test('round a thin handle the thumb comes round its far side and closes the ring onto it or the fingers', () => {
  const [hand, target] = [right(), rod(0.015)]
  const held = grip(hand, target, { at: V(0.015, 0, 0), from: V(1, 0, 0) })
  // the palm is on the handle's +x side: the thumb's and the fingers' tips end past its axis, snug round it
  for (const finger of ['thumb', 'index', 'middle'] as const) {
    const end = tip(hand, target, held, finger)
    expect(end.x).toBeLessThan(0)
    expect(Math.hypot(end.x, end.z)).toBeLessThan(0.015 + 3 * hand.radius)
  }
})

test('a whole-hand grip of a handle of 2,000 triangles takes less than 400 ms', () => {
  // 50 sides, 19 rings: 1,900 triangles round it and 100 in its caps
  const [hand, target] = [right(), thing([new CylinderGeometry(0.015, 0.015, 0.3, 50, 19)])]
  const start = performance.now()
  grip(hand, target, { at: V(0.015, 0, 0), from: V(1, 0, 0) })
  expect(performance.now() - start).toBeLessThan(400)
})

test('four fingers lie on the face of a board held over its edge, and the thumb on the other face', () => {
  const [hand, board] = [right(), thing([new BoxGeometry(0.3, 0.02, 0.2)])]
  const { contacts } = grip(hand, board, { at: V(0, 0, 0.1), from: V(0, 0, 1) })
  for (const finger of ['index', 'middle', 'ring', 'little'] as const) {
    expect(contacts[finger].gap).toBeLessThan(0.002)
    expect(Math.abs(contacts[finger].normal.y)).toBeGreaterThan(0.9)
    expect(Math.sign(contacts[finger].normal.y)).toBe(-Math.sign(contacts.thumb.normal.y))
  }
})

test('round a stem thinner than a finger, the fingers close to a fist without crossing', () => {
  const [hand, wire] = [right(), rod(0.003)]
  const held = grip(hand, wire, { at: V(0.003, 0, 0), from: V(1, 0, 0) })
  const fingers = ['index', 'middle', 'ring', 'little'] as const
  for (const finger of fingers.slice(1))
    expect(held.pose[finger].bend.reduce((a, b) => a + b)).toBeGreaterThan(
      fist[finger].bend.reduce((a, b) => a + b) - 0.6,
    )
  // across the knuckles, each fingertip stays on its own side of the next
  const thumbward = hand.thumbward.clone().applyQuaternion(held.quaternion.clone().invert())
  const across = fingers.map((f) => tip(hand, wire, held, f).dot(thumbward))
  for (let k = 1; k < across.length; k++) expect(across[k - 1]).toBeGreaterThan(across[k])
})

test('a fingertip pinch leaves the palm clear, the thumb level with the index', () => {
  const [hand, cube] = [right(), thing([new BoxGeometry(0.02, 0.02, 0.02)])]
  // the fingers left out curled away: relaxed, the middle stands where the thumb comes level
  const { contacts } = grip(hand, cube, { at: V(0, 0, 0), from: V(0, 1, 0), using: ['thumb', 'index'], start: fist })
  expect(contacts.palm.gap).toBeGreaterThan(0.01)
  const off = contacts.thumb.at.clone().sub(contacts.index.at)
  expect(off.addScaledVector(contacts.index.normal, -off.dot(contacts.index.normal)).length()).toBeLessThan(0.02)
})

/** a pinch's index as the grip holds it: its bends, whether its contact lies on its pad, how far the thumb's lands from
 * it along the target's face, and the angle at the grip between the target's long end and the way to the wrist */
function pinched(hand: Hand, target: Group, held: Grip, long: Vector3) {
  const last = (pose: Grip['pose']) => rods(hand, target, { ...held, pose }, 'index')[2]
  const { a, b } = last(held.pose)
  // the pad faces the way the tip goes as the last joint folds on
  const [knuckle, middle, end] = held.pose.index.bend
  const folded = last({ ...held.pose, index: { ...held.pose.index, bend: [knuckle, middle, end + 1e-3] } })
  const along = b.clone().sub(a).normalize()
  const pad = folded.b.clone().sub(b).projectOnPlane(along).normalize()
  const { thumb, index } = held.contacts
  const share = index.at.clone().sub(a).dot(along) / a.distanceTo(b)
  const off = index.at.clone().sub(a).projectOnPlane(along)
  const wrist = target.worldToLocal(hand.bone.getWorldPosition(new Vector3()))
  const between = thumb.at.clone().add(index.at).multiplyScalar(0.5)
  return {
    bends: held.pose.index.bend,
    onPad: share > 0 && share < 1 && off.angleTo(pad) < Math.PI / 4,
    apart: thumb.at.clone().sub(index.at).projectOnPlane(index.normal).length(),
    away: long.angleTo(wrist.sub(between)),
  }
}

for (const [name, make, at, from, long] of [
  // the bow round the origin in x-y, 3 mm thick, the blade going off down -y
  [
    'a key by its bow',
    () =>
      thing(
        [new CylinderGeometry(0.0125, 0.0125, 0.003, 32).rotateX(Math.PI / 2)],
        [new BoxGeometry(0.01, 0.03, 0.003), V(0, -0.0275, 0)],
      ),
    V(0, 0, 0),
    V(0, 1, 0),
    V(0, -1, 0),
  ],
  [
    'a card by its near edge',
    () => thing([new BoxGeometry(0.0856, 0.0008, 0.054)]),
    V(0.0328, 0, 0),
    V(1, 0, 0),
    V(-1, 0, 0),
  ],
] as const)
  test(`${name}, pinched, lies on the pad of a curled index, the thumb across it, its far end away from the wrist`, () => {
    const [hand, target] = [right(), make()]
    const held = grip(hand, target, { at, from, using: ['thumb', 'index'], start: fist })
    const { bends, onPad, apart, away } = pinched(hand, target, held, long)
    // the knuckle, the middle and the last joint all bent, as in an O
    for (const [k, least] of [15, 35, 15].entries()) expect(bends[k]).toBeGreaterThan((least * Math.PI) / 180)
    expect(onPad).toBe(true)
    expect(apart).toBeLessThan(0.003)
    expect(away).toBeGreaterThan(Math.PI / 2)
  })

test('a tennis ball held up from below sits in the fingertips, the thumb across from them and the palm clear', () => {
  const [hand, ball] = [right(), thing([new SphereGeometry(0.033, 32, 20)])]
  const using = ['thumb', 'index', 'middle'] as const
  const { contacts } = grip(hand, ball, { at: V(0, 0, 0), from: V(0, -1, 0), using })
  for (const e of using) expect(Math.abs(contacts[e].gap)).toBeLessThan(0.002)
  expect(contacts.thumb.normal.angleTo(contacts.index.normal)).toBeGreaterThan(Math.PI / 2)
  expect(contacts.palm.gap).toBeGreaterThan(0.01)
})

test('a wine glass held by its stem has the thumb and first two fingers on the stem, the palm clear', () => {
  const hand = right()
  const glass = thing(
    [new CylinderGeometry(0.035, 0.035, 0.004, 32), V(0, 0.002, 0)],
    [new CylinderGeometry(0.0035, 0.0035, 0.07, 16), V(0, 0.039, 0)],
    [new SphereGeometry(0.04, 32, 20), V(0, 0.11, 0)],
  )
  const using = ['thumb', 'index', 'middle'] as const
  const { contacts } = grip(hand, glass, { at: V(0, 0.04, 0), from: V(1, 0, 0), using })
  for (const e of using) {
    expect(Math.abs(contacts[e].gap)).toBeLessThan(0.002)
    expect(Math.hypot(contacts[e].at.x, contacts[e].at.z)).toBeLessThan(0.004)
  }
  expect(contacts.thumb.normal.angleTo(contacts.index.normal)).toBeGreaterThan(Math.PI / 2)
  expect(contacts.palm.gap).toBeGreaterThan(0.01)
})

test("a card pinched by its near edge has the thumb's pad pressing directly across from the index's", () => {
  const [hand, card] = [right(), thing([new BoxGeometry(0.0856, 0.0008, 0.054)])]
  const { contacts } = grip(hand, card, { at: V(0.0328, 0, 0), from: V(1, 0, 0), using: ['thumb', 'index'] })
  const off = contacts.thumb.at.clone().sub(contacts.index.at)
  expect(off.projectOnPlane(contacts.index.normal).length()).toBeLessThan(0.3 * hand.radius + 1e-4)
})

test('with the palm taking part, the palm still faces the target from `from`', () => {
  const [hand, target] = [right(), rod(0.04)]
  const { contacts } = grip(hand, target, { at: V(0.04, 0, 0), from: V(1, 0, 0) })
  expect(contacts.palm.gap).toBeLessThan(0.002)
  expect(contacts.palm.normal.x).toBeGreaterThan(0.9)
})

test('the way round a symmetric target holds when the point moves a millimetre', () => {
  const hand = right()
  const [a, b] = [0, 0.001].map((y) => {
    const target = rod(0.015)
    return grip(hand, target, { at: V(0.015, y, 0), from: V(1, 0, 0) }).contacts.thumb.at.y > 0
  })
  expect(a).toBe(b)
})

test('a thumb left out yields to a bar, and the rest still hook round it', () => {
  const [hand, bar] = [right(), rod(0.0125)]
  const using = ['palm', 'index', 'middle', 'ring', 'little'] as const
  const { contacts } = grip(hand, bar, { at: V(0.0125, 0, 0), from: V(1, 0, 0), using })
  expect(contacts.thumb.gap).toBeGreaterThan(-0.0011)
  for (const finger of using) expect(contacts[finger].gap).toBeLessThan(0.0011)
})

test('a handle of any thickness is held from any side, the point anywhere in it, with nothing sunk in', () => {
  const hand = right()
  for (const radius of [0.005, 0.017, 0.024, 0.035])
    for (const from of [V(1, 0, 0), V(0, 0, -1)]) {
      const { contacts } = grip(hand, rod(radius), { at: V(0, 0.01, 0), from })
      expect(contacts.palm.gap).toBeLessThan(0.002)
      for (const c of Object.values(contacts)) expect(c.gap).toBeGreaterThan(-0.002)
    }
})

test('a big ball lies on the palm with the fingers and thumb on it, none sunk in', () => {
  const [hand, ball] = [right(), thing([new SphereGeometry(0.12, 24, 16)])]
  const { contacts } = grip(hand, ball, { at: V(0, -0.12, 0), from: V(0, -1, 0) })
  for (const c of Object.values(contacts)) expect(Math.abs(c.gap)).toBeLessThan(0.003)
})

// the barrel along +z, up +y; the palm on the grip's back strap from behind and the gun's right, the index on the
// trigger's rear face
const gun = () => {
  const target = pistol()
  target.updateMatrixWorld(true)
  return target
}
const using = ['palm', 'thumb', 'middle', 'ring', 'little'] as const
const strap = {
  at: V(0, -0.05, 0).applyEuler(new Euler(0.2, 0, 0)),
  from: V(-1, 0, -1).normalize(),
  using,
  start: point,
}
const trigger = V(0, -0.016, 0.049)

test('a grip composed on an earlier one keeps its placement, and puts the hand on a fixed target or the target in it', () => {
  const [hand, target] = [right(), gun()]
  const held = grip(hand, target, strap)
  const fired = grip(hand, target, { at: trigger, using: ['index'], start: held })
  expect(fired.position.distanceTo(held.position)).toBeLessThan(1e-9)
  expect(fired.quaternion.angleTo(held.quaternion)).toBeLessThan(1e-9)
  expect(fired.pose.middle).toEqual(held.pose.middle)
  hold(hand, target, fired)
  const placed = hand.bone.worldToLocal(target.localToWorld(V(0, 0, 0)))
  const carried = new Group()
  carried.add(...target.children.map((m) => m.clone()))
  hand.bone.add(carried)
  hold(hand, carried, fired)
  expect(hand.bone.worldToLocal(carried.localToWorld(V(0, 0, 0))).distanceTo(placed)).toBeLessThan(1e-9)
})

test('composing onto another target, or saying `from` again, throws', () => {
  const [hand, target] = [right(), gun()]
  const held = grip(hand, target, strap)
  expect(() => grip(hand, rod(0.02), { at: trigger, using: ['index'], start: held })).toThrow("start from this one's")
  expect(() => grip(hand, target, { at: trigger, from: V(1, 0, 0), using: ['index'], start: held })).toThrow('`from`')
})

test('a statement with nothing to grip, or no side to come from, throws saying so', () => {
  const hand = right()
  expect(() => grip(hand, new Group(), { at: V(0, 0, 0), from: V(1, 0, 0) })).toThrow('no mesh')
  expect(() => grip(hand, rod(0.04), { at: V(0, 0, 0) })).toThrow('which side the hand')
  expect(() => grip(hand, rod(0.04), { at: V(0, 0, 0), from: V(0, 0, 0) })).toThrow('which side the hand')
})
