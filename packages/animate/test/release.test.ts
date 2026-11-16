import { grip, Hand } from '@drawcall/hand'
import { Mesh, Scene, SphereGeometry, Vector3 } from 'three'
import { expect, test } from 'vitest'
import { RADIUS } from '../../../examples/basketball/ball'
import { SEAT, jumpShot } from '../../../examples/basketball/shot'
import { bowl, carry, SIDE } from '../../../examples/bowling/bowl'
import { GRIP, sphere } from '../../../examples/bowling/lane'
import { inHand } from '../../../examples/character'
import { person } from '../../../examples/person'
import { Body, type Thing } from '../src'
import { RANGE } from '../src/rig/joints'
import { tick } from '../src/rig/size'
import * as tennis from '../../../examples/tennis/ball'
import { stroke } from '../../../examples/tennis/stroke'
import { FOREHAND, racket } from '../../../examples/tennis/racket'

/**
 * after a release, each arm that held on as a viewer sees it: how far behind the trunk it is drawn at the most (rad), and how much
 * fast its wrist goes against the hips once a tenth of a second has gone, at the most (m/s)
 */
function after(body: Body, released: () => boolean) {
  const { joints, bones, ends } = (body as unknown as { workings: { joints: any; bones: any; ends: any } }).workings
  const was = { left: new Vector3(), right: new Vector3() }
  let [behind, faster, gone] = [-Infinity, 0, 0]
  const held = new Set<string>()
  const dt = tick(body.size)
  while (body.playing && gone < 1.5) {
    body.update(dt)
    for (const side of ['left', 'right'] as const) {
      const at = bones.wrist[side].clone().sub(body.hips.value)
      const speed = at.distanceTo(was[side]) / dt
      was[side].copy(at)
      // (an arm the body swung freely before is not one let go)
      if (!released()) {
        if (ends.hand[side].held) held.add(side)
        else held.delete(side)
        continue
      }
      if (!held.has(side)) continue
      behind = Math.max(behind, joints.arms[side].first.value.x + joints.trunk.value.x)
      if (gone > 0.1) faster = Math.max(faster, speed)
      expect(joints.arms[side].first.value.x).toBeLessThanOrEqual(RANGE.arm.x[1] + 1e-6)
    }
    if (released()) gone += dt
  }
  return { behind, faster }
}

test('after the ball leaves a jump shot, the arms come down in front of him, only slowing', () => {
  const rig = person()
  const ball = new Mesh(new SphereGeometry(RADIUS))
  new Scene().add(rig, ball)
  const hand = new Hand(rig, 'right')
  const body = new Body(rig)
  let left: Vector3 | undefined
  body.play(jumpShot(body, inHand(body, hand, grip(hand, ball, SEAT)), (velocity) => (left = velocity)))
  const { behind, faster } = after(body, () => left !== undefined)
    expect(behind).toBeLessThan(0.3)
  // (an arm lowered as it sways, not thrown: thrown, it went 13 m/s)
  expect(faster).toBeLessThan(8)
})

test('after the bowling ball leaves, the arm is never thrown back behind him, and only slows', () => {
  const man = person()
  const drawn = sphere()
  new Scene().add(man, drawn)
  const hands = { left: new Hand(man, 'left'), right: new Hand(man, 'right') }
  const body = new Body(man)
  const held: Thing = inHand(body, hands.right, grip(hands.right, drawn, GRIP))
  let left: Vector3 | undefined
  body.play(
    (function* () {
      yield* carry(body, held, grip(hands.left, drawn, SIDE.left))
      yield* bowl(body, held, (velocity) => (left = velocity))
    })(),
  )
  const { behind, faster } = after(body, () => left !== undefined)
    expect(behind).toBeLessThan(0.3)
  // (an arm lowered as it sways, not thrown: thrown, it went 13 m/s)
  expect(faster).toBeLessThan(8)
})

test('a forehand swings on through the ball round his shoulder before it comes to rest', () => {
  const rig = person()
  const bat = racket()
  new Scene().add(rig, bat)
  const hand = new Hand(rig, 'right')
  const body = new Body(rig)
  const held = inHand(body, hand, grip(hand, bat, FOREHAND))
  const ball = tennis.ballAt()
  tennis.feed(ball)
  const { seconds, at } = tennis.top(ball)
  let met = false
  body.play(
    (function* () {
      yield* stroke(body, held, 'forehand', body.time + seconds, at, new Vector3(0, 0, 1))
      met = true
      yield* body.until(body.time + 1)
    })(),
  )
  while (!met) body.update(tick(body.size))
  const from = body.hand.right.value.clone()
  let [far, moving] = [0, 0]
  for (let t = 0; t < 0.8; t += tick(body.size)) {
    body.update(tick(body.size))
    far = Math.max(far, body.hand.right.value.distanceTo(from))
    if (body.hand.right.velocity.length() > 0.5) moving = t
  }
  // (it went on half a metre and more, for 0.15 s and more: frozen, it stopped dead)
  expect(far).toBeGreaterThan(0.5)
  expect(moving).toBeGreaterThan(0.15)
})
