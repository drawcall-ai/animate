import { BoxGeometry, type BufferGeometry, CylinderGeometry, Euler, Group, Matrix4, Mesh, SphereGeometry, Vector3 } from "three"
import { expect, test } from "vitest"
import { pistol } from "./pistol"
import { person } from "./person"
import { type Finger, type Grip, grip, Hand, HandPose } from "../src"
import { shapeOf } from "../src/hand"

const V = (x: number, y: number, z: number) => new Vector3(x, y, z)
/** a thing of some meshes, set somewhere in the world and turned */
function thing(...shapes: [BufferGeometry, Vector3?][]) {
  const target = new Group()
  for (const [shape, at = V(0, 0, 0)] of shapes) target.add(new Mesh(shape, undefined).translateX(at.x).translateY(at.y).translateZ(at.z))
  target.position.set(0.3, 1, 0.4)
  target.rotation.set(0.3, 0.5, 0.2)
  target.updateMatrixWorld(true)
  return target
}
const rod = (radius: number) => thing([new CylinderGeometry(radius, radius, 0.3, 24)])
const right = () => new Hand(person(), "right")

/** a finger's rods as the grip holds them, in the target's frame */
const rods = (hand: Hand, { position, quaternion, pose }: Grip, finger: Finger | "palm") => {
  const place = new Matrix4().compose(position, quaternion, new Vector3(1, 1, 1))
  return shapeOf(hand)
    .segments(pose, place)
    .filter((s) => s.part === finger)
}
const tip = (hand: Hand, held: Grip, finger: Finger) => rods(hand, held, finger)[2].b

test("round a cylinder the palm faces it from `approachFrom` and the thumb opposes the fingers", () => {
  const [hand, target] = [right(), rod(0.04)]
  const { contacts } = grip(hand, target, { at: V(0.04, 0, 0), approachFrom: V(1, 0, 0), thumbToward: V(0, 1, 0) })
  expect(contacts.palm.gap).toBeLessThan(0.002)
  expect(contacts.palm.normal.x).toBeGreaterThan(0.9)
  expect(contacts.thumb.gap).toBeLessThan(0.002)
  expect(contacts.thumb.normal.angleTo(contacts.middle.normal)).toBeGreaterThan(Math.PI / 2)
})

test("round a thin handle the thumb comes round its far side and closes the ring onto it or the fingers", () => {
  const [hand, target] = [right(), rod(0.015)]
  const held = grip(hand, target, { at: V(0.015, 0, 0), approachFrom: V(1, 0, 0), thumbToward: V(0, 1, 0) })
  // the palm is on the handle's +x side: the thumb's and the fingers' tips end past its axis, snug round it
  for (const finger of ["thumb", "index", "middle"] as const) {
    const end = tip(hand, held, finger)
    expect(end.x).toBeLessThan(0)
    expect(Math.hypot(end.x, end.z)).toBeLessThan(0.015 + 3 * shapeOf(hand).radius)
  }
})

test("a whole-hand grip of a handle of 2,000 triangles takes less than 400 ms", () => {
  // 50 sides, 19 rings: 1,900 triangles round it and 100 in its caps
  const [hand, target] = [right(), thing([new CylinderGeometry(0.015, 0.015, 0.3, 50, 19)])]
  const start = performance.now()
  grip(hand, target, { at: V(0.015, 0, 0), approachFrom: V(1, 0, 0), thumbToward: V(0, 1, 0) })
  expect(performance.now() - start).toBeLessThan(400)
})

test("four fingers lie on the face of a board held over its edge, and the thumb on the other face", () => {
  const [hand, board] = [right(), thing([new BoxGeometry(0.3, 0.02, 0.2)])]
  const { contacts } = grip(hand, board, { at: V(0, 0, 0.1), approachFrom: V(0, 0, 1), thumbToward: V(1, 0, 0) })
  for (const finger of ["index", "middle", "ring", "little"] as const) {
    expect(contacts[finger].gap).toBeLessThan(0.002)
    expect(Math.abs(contacts[finger].normal.y)).toBeGreaterThan(0.9)
    expect(Math.sign(contacts[finger].normal.y)).toBe(-Math.sign(contacts.thumb.normal.y))
  }
})

test("round a stem thinner than a finger, the fingers close to a fist without crossing", () => {
  const [hand, wire] = [right(), rod(0.003)]
  const held = grip(hand, wire, { at: V(0.003, 0, 0), approachFrom: V(1, 0, 0), thumbToward: V(0, 1, 0) })
  const fingers = ["index", "middle", "ring", "little"] as const
  for (const finger of fingers.slice(1))
    expect(held.pose[finger].bend.reduce((a, b) => a + b)).toBeGreaterThan(HandPose.fist[finger].bend.reduce((a, b) => a + b) - 0.6)
  // across the knuckles, each fingertip stays on its own side of the next
  const thumbward = shapeOf(hand).thumbward.clone().applyQuaternion(held.quaternion)
  const across = fingers.map((f) => tip(hand, held, f).dot(thumbward))
  for (let k = 1; k < across.length; k++) expect(across[k - 1]).toBeGreaterThan(across[k])
})

test("a fingertip pinch leaves the palm clear, the thumb level with the index", () => {
  const [hand, cube] = [right(), thing([new BoxGeometry(0.02, 0.02, 0.02)])]
  // the fingers left out curled away: relaxed, the middle stands where the thumb comes level
  const { contacts } = grip(hand, cube, {
    at: V(0, 0, 0),
    approachFrom: V(0, 1, 0),
    thumbToward: V(1, 0, 0),
    using: ["thumb", "index"],
    idlePose: HandPose.fist,
  })
  expect(contacts.palm.gap).toBeGreaterThan(0.01)
  const off = contacts.thumb.at.clone().sub(contacts.index.at)
  expect(off.addScaledVector(contacts.index.normal, -off.dot(contacts.index.normal)).length()).toBeLessThan(0.02)
})

/** a pinch's index as the grip holds it: its bends, whether its contact lies on its pad, how far the thumb's lands from
 * it along the target's face, and the angle at the grip between the target's long end and the way to the wrist */
function pinched(hand: Hand, held: Grip, long: Vector3) {
  const last = (pose: HandPose) => rods(hand, { ...held, pose }, "index")[2]
  const { a, b } = last(held.pose)
  // the pad faces the way the tip goes as the last joint folds on
  const [knuckle, middle, end] = held.pose.index.bend
  const folded = last({ ...held.pose, index: { ...held.pose.index, bend: [knuckle, middle, end + 1e-3] } })
  const along = b.clone().sub(a).normalize()
  const pad = folded.b.clone().sub(b).projectOnPlane(along).normalize()
  const { thumb, index } = held.contacts
  const share = index.at.clone().sub(a).dot(along) / a.distanceTo(b)
  const off = index.at.clone().sub(a).projectOnPlane(along)
  const wrist = held.position.clone()
  const between = thumb.at.clone().add(index.at).multiplyScalar(0.5)
  return {
    bends: held.pose.index.bend,
    onPad: share > 0 && share < 1 && off.angleTo(pad) < Math.PI / 4,
    apart: thumb.at.clone().sub(index.at).projectOnPlane(index.normal).length(),
    away: long.angleTo(wrist.sub(between)),
  }
}

for (const [name, make, at, from, thumb, long] of [
  // the bow round the origin in x-y, 3 mm thick, the blade going off down -y
  [
    "a key by its bow",
    () => thing([new CylinderGeometry(0.0125, 0.0125, 0.003, 32).rotateX(Math.PI / 2)], [new BoxGeometry(0.01, 0.03, 0.003), V(0, -0.0275, 0)]),
    V(0, 0, 0),
    V(0, 1, 0),
    V(0, 0, 1),
    V(0, -1, 0),
  ],
  ["a card by its near edge", () => thing([new BoxGeometry(0.0856, 0.0008, 0.054)]), V(0.0328, 0, 0), V(1, 0, 0), V(0, 1, 0), V(-1, 0, 0)],
] as const)
  test(`${name}, pinched, lies on the pad of a curled index, the thumb across it, its far end away from the wrist`, () => {
    const [hand, target] = [right(), make()]
    const held = grip(hand, target, { at, approachFrom: from, thumbToward: thumb, using: ["thumb", "index"], idlePose: HandPose.fist })
    const { bends, onPad, apart, away } = pinched(hand, held, long)
    // the knuckle, the middle and the last joint all bent, as in an O
    for (const [k, least] of [15, 35, 15].entries()) expect(bends[k]).toBeGreaterThan((least * Math.PI) / 180)
    expect(onPad).toBe(true)
    expect(apart).toBeLessThan(0.003)
    expect(away).toBeGreaterThan(Math.PI / 2)
  })

test("a tennis ball held up from below sits in the fingertips, the thumb across from them and the palm clear", () => {
  const [hand, ball] = [right(), thing([new SphereGeometry(0.033, 32, 20)])]
  const using = ["thumb", "index", "middle"] as const
  const { contacts } = grip(hand, ball, { at: V(0, 0, 0), approachFrom: V(0, -1, 0), thumbToward: V(1, 0, 0), using })
  for (const e of using) expect(Math.abs(contacts[e].gap)).toBeLessThan(0.002)
  expect(contacts.thumb.normal.angleTo(contacts.index.normal)).toBeGreaterThan(Math.PI / 2)
  expect(contacts.palm.gap).toBeGreaterThan(0.01)
})

test("a wine glass held by its stem has the thumb and first two fingers on the stem, the palm clear", () => {
  const hand = right()
  const glass = thing(
    [new CylinderGeometry(0.035, 0.035, 0.004, 32), V(0, 0.002, 0)],
    [new CylinderGeometry(0.0035, 0.0035, 0.07, 16), V(0, 0.039, 0)],
    [new SphereGeometry(0.04, 32, 20), V(0, 0.11, 0)],
  )
  const using = ["thumb", "index", "middle"] as const
  const { contacts } = grip(hand, glass, { at: V(0, 0.04, 0), approachFrom: V(1, 0, 0), thumbToward: V(0, 0, 1), using })
  for (const e of using) {
    expect(Math.abs(contacts[e].gap)).toBeLessThan(0.002)
    expect(Math.hypot(contacts[e].at.x, contacts[e].at.z)).toBeLessThan(0.004)
  }
  expect(contacts.thumb.normal.angleTo(contacts.index.normal)).toBeGreaterThan(Math.PI / 2)
  expect(contacts.palm.gap).toBeGreaterThan(0.01)
})

test("a card pinched by its near edge has the thumb's pad pressing directly across from the index's", () => {
  const [hand, card] = [right(), thing([new BoxGeometry(0.0856, 0.0008, 0.054)])]
  const { contacts } = grip(hand, card, { at: V(0.0328, 0, 0), approachFrom: V(1, 0, 0), thumbToward: V(0, 1, 0), using: ["thumb", "index"] })
  const off = contacts.thumb.at.clone().sub(contacts.index.at)
  expect(off.projectOnPlane(contacts.index.normal).length()).toBeLessThan(0.3 * shapeOf(hand).radius + 1e-4)
})

test("the knuckles run to the thumb's stated side, wherever the point and whichever side the hand comes from", () => {
  const hand = right()
  for (const from of [V(1, 0, 0), V(0, 0, -1), V(-1, 0, 1).normalize()])
    for (const y of [0, 0.001, 0.03])
      for (const up of [1, -1]) {
        const target = rod(0.015)
        const held = grip(hand, target, { at: V(0, y, 0), approachFrom: from, thumbToward: V(0, up, 0) })
        const [index, little] = (["index", "little"] as const).map((f) => rods(hand, held, f)[0].a)
        expect(Math.sign(index.y - little.y)).toBe(up)
      }
})

test("a thumb left out yields to a bar, and the rest still hook round it", () => {
  const [hand, bar] = [right(), rod(0.0125)]
  const using = ["palm", "index", "middle", "ring", "little"] as const
  const { contacts } = grip(hand, bar, { at: V(0.0125, 0, 0), approachFrom: V(1, 0, 0), thumbToward: V(0, 1, 0), using })
  expect(contacts.thumb.gap).toBeGreaterThan(-0.0011)
  for (const finger of using) expect(contacts[finger].gap).toBeLessThan(0.0011)
})

test("a handle of any thickness is held from any side, the point anywhere in it, with nothing sunk in", () => {
  const hand = right()
  for (const radius of [0.005, 0.017, 0.024, 0.035])
    for (const from of [V(1, 0, 0), V(0, 0, -1)]) {
      const { contacts } = grip(hand, rod(radius), { at: V(0, 0.01, 0), approachFrom: from, thumbToward: V(0, 1, 0) })
      expect(contacts.palm.gap).toBeLessThan(0.002)
      for (const c of Object.values(contacts)) expect(c.gap).toBeGreaterThan(-0.002)
    }
})

test("a big ball lies on the palm with the fingers and thumb on it, none sunk in", () => {
  const [hand, ball] = [right(), thing([new SphereGeometry(0.12, 24, 16)])]
  const { contacts } = grip(hand, ball, { at: V(0, -0.12, 0), approachFrom: V(0, -1, 0), thumbToward: V(1, 0, 0) })
  for (const c of Object.values(contacts)) expect(Math.abs(c.gap)).toBeLessThan(0.003)
})

// the barrel along +z, up +y; the palm on the grip's back strap from behind and the gun's right, the index on the
// trigger's rear face
const gun = () => {
  const target = pistol()
  target.updateMatrixWorld(true)
  return target
}
const using = ["palm", "thumb", "middle", "ring", "little"] as const
const strap = {
  at: V(0, -0.05, 0).applyEuler(new Euler(0.2, 0, 0)),
  approachFrom: V(-1, 0, -1).normalize(),
  thumbToward: V(0, 1, 0),
  using,
  idlePose: HandPose.pointing,
}
const trigger = V(0, -0.016, 0.049)

test("a grip started from another keeps its hand where it is, and a finger added reaches its point", () => {
  const [hand, target] = [right(), gun()]
  const held = grip(hand, target, strap)
  const fired = grip(hand, target, { at: trigger, using: ["index"], on: held })
  expect(fired.position.distanceTo(held.position)).toBeLessThan(1e-9)
  expect(fired.quaternion.angleTo(held.quaternion)).toBeLessThan(1e-9)
  for (const finger of ["thumb", "middle", "ring", "little"] as const) expect(fired.pose[finger]).toEqual(held.pose[finger])
  expect(fired.contacts.index.gap).toBeLessThan(0.002)
  expect(fired.using).toEqual(["palm", "thumb", "index", "middle", "ring", "little"])
  expect(fired.contacts.index.at.distanceTo(trigger)).toBeLessThan(4 * shapeOf(hand).radius)
})

test("a grip is relative to the target: the same wherever the target stands", () => {
  const hand = right()
  const [here, there] = [rod(0.017), rod(0.017)]
  there.position.set(-1, 0.5, 2)
  there.rotation.set(1, -0.4, 0.7)
  const [a, b] = [here, there].map((target) => grip(hand, target, { at: V(0.017, 0, 0), approachFrom: V(1, 0, 0), thumbToward: V(0, 1, 0) }))
  // within what the searches narrow to: a millimetre, the skin's give
  expect(a.position.distanceTo(b.position)).toBeLessThan(0.001)
  expect(a.quaternion.angleTo(b.quaternion)).toBeLessThan(0.01)
})

test("a target hanging from something moved since it was last drawn is gripped where it now is", () => {
  const [hand, target, parent] = [right(), rod(0.017), new Group()]
  parent.add(target)
  parent.position.set(2, 0, 1)
  const { contacts, position } = grip(hand, target, { at: V(0.017, 0, 0), approachFrom: V(1, 0, 0), thumbToward: V(0, 1, 0) })
  expect(position.length()).toBeLessThan(0.2)
  for (const e of ["palm", "index", "middle"] as const) expect(contacts[e].gap).toBeLessThan(0.002)
})

test("a statement with nothing to grip, nothing taking part, or a side for the hand or thumb that says nothing, throws saying so", () => {
  const hand = right()
  expect(() => grip(hand, new Group(), { at: V(0, 0, 0), approachFrom: V(1, 0, 0), thumbToward: V(0, 1, 0) })).toThrow("no mesh")
  expect(() => grip(hand, rod(0.04), { at: V(0, 0, 0), approachFrom: V(1, 0, 0), thumbToward: V(0, 1, 0), using: [] })).toThrow("to take part")
  expect(() => grip(hand, rod(0.04), { at: V(0, 0, 0), approachFrom: V(0, 0, 0), thumbToward: V(0, 1, 0) })).toThrow("which side the hand")
  expect(() => grip(hand, rod(0.04), { at: V(0, 0, 0), approachFrom: V(1, 0, 0), thumbToward: V(2, 0, 0) })).toThrow("which side the thumb")
})
