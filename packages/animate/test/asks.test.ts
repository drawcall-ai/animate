import { Group, Object3D, Vector3 } from 'three'
import { expect, test } from 'vitest'
import { person } from '../../../examples/person'
import { Body, type Story } from '../src'
import { tick } from '../src/rig/size'

/** a body in a scene of its own */
function setup() {
  const scene = new Group()
  const rig = person()
  scene.add(rig)
  return { scene, body: new Body(rig) }
}

/** steps him on for so long, telling each step what he is like: no step throws */
function play(body: Body, seconds: number, each = () => {}) {
  for (let n = 0; n < seconds / tick(body.size); n++) {
    body.update(tick(body.size))
    each()
  }
}

test('a standing jump to a place beside him or behind goes there: the hips are there at the top, and he lands on that side', () => {
  for (const off of [
    { x: 1.2, z: 0 },
    { x: -0.6, z: -0.6 },
  ]) {
    const { body } = setup()
    const top = new Vector3(off.x, body.size.stand + 0.3, off.z)
    body.play(body.jump(top))
    const when = body.highest()
    let at: Vector3 | undefined
    play(body, 4, () => {
      if (!at && body.time >= when) at = body.hips.value.clone()
    })
    expect(at?.distanceTo(top)).toBeLessThan(0.25)
    // (he lands further on the way he jumped, on both feet)
    const landed = body.hips.value
    expect(landed.x * off.x + landed.z * off.z).toBeGreaterThan(off.x ** 2 + off.z ** 2)
    // (and comes to rest there, the knees giving, not carried on along the ground)
    expect(Math.hypot(landed.x - off.x, landed.z - off.z)).toBeLessThan(1.1 * Math.hypot(off.x, off.z))
    for (const side of ['left', 'right'] as const) expect(body.foot[side].value.y).toBeLessThan(body.size.ankle + 0.03)
  }
})

test('a jump whose top is lower than he stands is a hop or a dive there: he comes down on his feet at it, as low as it is', () => {
  const { body } = setup()
  const top = { x: 1.4, y: 0.6, z: 0.1 }
  body.play(body.jump(top))
  play(body, 4)
  expect(Math.hypot(body.hips.value.x - top.x, body.hips.value.z - top.z)).toBeLessThan(0.25)
  expect(body.hips.value.y).toBeCloseTo(top.y, 1)
  for (const side of ['left', 'right'] as const) expect(body.foot[side].value.y).toBeLessThan(body.size.ankle + 0.03)
})

test('a dive with the hands sent to a ball at its top ends low, but no lower than a full squat', () => {
  const { body } = setup()
  body.play(
    (function* () {
      const dive = body.jump({ x: 1.4, y: 0.6, z: 0.1 })
      yield
      void body.hand.left.by(body.highest(), { x: 1.75, y: 0.75, z: 0.3 })
      void body.hand.right.by(body.highest(), { x: 1.75, y: 0.5, z: 0.3 })
      yield* dive
    })(),
  )
  let lowest = Infinity
  play(body, 4, () => (lowest = Math.min(lowest, body.hips.value.y)))
  expect(lowest / body.size.stand).toBeGreaterThan(0.3)
})

test('a ladder is climbed by sending the feet and the hands to its rungs in turn: each foot stands on its rung', () => {
  const { scene, body } = setup()
  const { ankle } = body.size
  // (leaning at 75°, its rungs 0.28 m apart)
  const rungs = Array.from({ length: 9 }, (_, k) => {
    const rung = new Object3D()
    rung.position.set(0, 0.28 * (k + 1), 0.4 + 0.075 * (k + 1))
    scene.add(rung)
    return rung
  })
  scene.updateMatrixWorld(true)
  const at = (side: 'left' | 'right', x: number, y: number) => ({ x: side === 'left' ? x : -x, y, z: 0 })
  const stood: { side: 'left' | 'right'; rung: Object3D }[] = []
  body.play(
    (function* (): Story {
      const grip = (k: number, side: 'left' | 'right') => body.hand[side].to(at(side, 0.16, 0.02), { on: rungs[k] })
      void grip(3, 'right')
      yield* grip(4, 'left')
      for (let k = 0; k < 4; k++) {
        const side = k % 2 ? 'right' : 'left'
        expect(yield* body.foot[side].to(at(side, 0.1, ankle), { on: rungs[k] })).toBe(true)
        stood.push({ side, rung: rungs[k] })
        yield* grip(k + 5, side)
      }
      yield* body.until(body.time + 1)
    })(),
  )
  // each foot that was put on a rung is on it as it gets there, and the last two stay on theirs while he holds on
  const place = ({ side, rung }: (typeof stood)[number]) => rung.position.clone().add(new Vector3(side === 'left' ? 0.1 : -0.1, ankle, 0))
  let [off, kept, seen] = [0, 0, 0]
  play(body, 12, () => {
    for (; seen < stood.length; seen++) off = Math.max(off, body.foot[stood[seen].side].value.distanceTo(place(stood[seen])))
    if (stood.length === 4) for (const each of stood.slice(-2)) kept = Math.max(kept, body.foot[each.side].value.distanceTo(place(each)))
  })
  expect(off).toBeLessThan(0.05)
  expect(kept).toBeLessThan(0.05)
  expect(body.playing).toBe(false)
  expect(stood).toHaveLength(4)
  // up on the fourth rung, his hips are as high above it as he stands
  expect(body.hips.value.y).toBeGreaterThan(rungs[2].position.y + 0.8 * body.size.stand)
})

test('a foot sent to the ground in so many seconds steps there in them', () => {
  const { body } = setup()
  let done = Number.NaN
  body.play(
    (function* (): Story {
      yield* body.until(0.5)
      expect(yield* body.foot.left.to(body.ground('left', 0.4), { seconds: 0.6 })).toBe(true)
      done = body.time
    })(),
  )
  play(body, 3)
  expect(done).toBeGreaterThan(1.05)
  expect(done).toBeLessThan(1.25)
  expect(body.foot.left.value.z).toBeCloseTo(0.4, 1)
})
