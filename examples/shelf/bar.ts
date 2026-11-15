import { Body, type Side, type Story } from '@drawcall/animate'
import { grip, Hand } from '@drawcall/hand'
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { mannequin } from '../mannequin'
import { run } from '../stage'

/** how long and thick the bar is, how high it rests on its pegs, how far ahead of him, and where each hand has it (m) */
const BAR = { long: 1.4, radius: 0.02, high: 0.9, ahead: 0.5, grips: 0.28 }
const GRAVITY = 9.81

/**
 * how the bar is turned, counted on him as he faces: across before him, its z ahead, tipped up at its right end so far
 * (rad), the right palm on it from above as it tips
 */
const across = (tipped: number) => ({ pointing: { x: 0, y: 0, z: 1 }, palm: { x: -Math.sin(tipped), y: -Math.cos(tipped), z: 0 } })

/**
 * He takes a bar off its pegs in both hands, carries it before him, tips up its right end, then its left, and lets it
 * drop. The story sends the bar: the right hand leads it, and the left follows its grip on it.
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
  const carried = body.bind(bar)
  carried.on(right, grips.right)
  carried.on(left, grips.left)
  // he lifts it to his chest and walks off with it, its middle before his chest (counted from his right shoulder)
  const chest = { x: body.size.shoulder, y: -0.4 * arm, z: 0.6 * arm }
  const at = (tipped: number) => carried.to(chest, { on: body, ...across(tipped), seconds: 1 })
  yield* at(0)
  yield* body.walk(1.6)
  // its right end tips up, then its left
  yield* at(0.5)
  yield* at(0)
  yield* at(-0.5)
  yield* at(0)
  dropped(carried.free())
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
  readout: () => `story     ${body.playing ? 'playing' : 'over'}   bound  ${body.bound.map(({ hands }) => hands.join(' leading, ')).join(', ') || 'nothing'}`,
})
