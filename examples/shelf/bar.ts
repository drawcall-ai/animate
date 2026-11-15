import { Body, type Side, type Story } from '@drawcall/animate'
import { grip, Hand } from '@drawcall/hand'
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { mannequin } from '../mannequin'
import { run } from '../stage'

/** how long and thick the bar is, how high it rests on its pegs, how far ahead of him, and where each hand has it (m) */
const BAR = { long: 1.4, radius: 0.02, high: 0.9, ahead: 0.5, grips: 0.28 }
const GRAVITY = 9.81
const SIGN = { left: 1, right: -1 }

/** where a hand is before him, counted from its shoulder: so far out, up and ahead (of his arm) */
const before = (side: Side, up: number, ahead: number, arm: number) => ({ x: SIGN[side] * 0.08 * arm, y: up * arm, z: ahead * arm })

/**
 * He takes a bar off its pegs by a point in each hand, carries it before him, lifts it with his right hand alone,
 * then his left, and lets it drop: the bar lies between his palms however either hand goes.
 */
function* carry(body: Body, bar: Mesh, hands: Record<Side, Hand>, dropped: (velocity: Vector3) => void): Story {
  const { arm } = body.size
  // (the bar lies along x, its own y toward his right and its x up: the hands come onto it from above)
  const grips = {
    left: grip(hands.left, bar, { at: new Vector3(0, -BAR.grips, 0), from: new Vector3(1, 0, 0) }),
    right: grip(hands.right, bar, { at: new Vector3(0, BAR.grips, 0), from: new Vector3(1, 0, 0) }),
  }
  const { left, right } = body.hand
  const reached = left.to(grips.left)
  yield* right.to(grips.right)
  yield* reached
  left.take(grips.left, { turning: false })
  right.take(grips.right, { turning: false })
  // he lifts it to his chest and walks off with it
  left.to(before('left', -0.4, 0.6, arm), { on: body, seconds: 1 })
  yield* right.to(before('right', -0.4, 0.6, arm), { on: body, seconds: 1 })
  yield* body.walk(1.6)
  // one hand raises its end, then the other, the bar going with each
  yield* right.to(before('right', 0.3, 0.5, arm), { on: body, seconds: 1 })
  yield* right.to(before('right', -0.4, 0.6, arm), { on: body, seconds: 1 })
  yield* left.to(before('left', 0.3, 0.5, arm), { on: body, seconds: 1 })
  yield* left.to(before('left', -0.4, 0.6, arm), { on: body, seconds: 1 })
  left.letGo()
  dropped(right.letGo())
  yield* body.stand()
}

let body: Body
let bar: Mesh
/** how the bar falls once let go, until it lies on the floor */
let falling: Vector3 | undefined

run({
  begin() {
    const man = mannequin()
    const wood = new MeshStandardMaterial({ color: 0x9a7a50 })
    bar = new Mesh(new CylinderGeometry(BAR.radius, BAR.radius, BAR.long), new MeshStandardMaterial({ color: 0x8090a0 }))
    bar.rotation.z = Math.PI / 2
    bar.position.set(0, BAR.high, BAR.ahead)
    const pegs = [-1, 1].map((x) => {
      const peg = new Mesh(new BoxGeometry(0.04, BAR.high - BAR.radius, 0.04), wood)
      peg.position.set(x * 0.55, (BAR.high - BAR.radius) / 2, BAR.ahead)
      return peg
    })
    const scene = new Group().add(man, bar, ...pegs)
    scene.updateMatrixWorld(true)
    const hands = { left: new Hand(man, 'left'), right: new Hand(man, 'right') }
    body = new Body(man)
    falling = undefined
    body.play(carry(body, bar, hands, (velocity) => (falling = velocity)))
    return scene
  },
  update(delta) {
    body.update(delta)
    if (!falling) return
    falling.y -= GRAVITY * delta
    bar.position.addScaledVector(falling, delta)
    if (bar.position.y > BAR.radius) return
    // (it lies down flat on the floor, the way it points along it)
    bar.position.y = BAR.radius
    falling.set(0, 0, 0)
    const along = new Vector3(0, 1, 0).applyQuaternion(bar.quaternion).setY(0)
    if (along.lengthSq() > 0) bar.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), along.normalize())
  },
  focus: () => body.hips.value.z,
  readout: () => `story     ${body.playing ? 'playing' : 'over'}   bound  ${body.bound.map(({ hands }) => hands.join(' and ')).join(', ') || 'nothing'}`,
})
