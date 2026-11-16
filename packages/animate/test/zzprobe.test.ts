import { grip, Hand } from '@drawcall/hand'
import { Mesh, Scene, SphereGeometry, Vector3 } from 'three'
import { test } from 'vitest'
import { RADIUS } from '../../../examples/basketball/ball'
import { SEAT, jumpShot } from '../../../examples/basketball/shot'
import { bowl, carry, SIDE } from '../../../examples/bowling/bowl'
import { GRIP, sphere } from '../../../examples/bowling/lane'
import { inHand } from '../../../examples/character'
import { person } from '../../../examples/person'
import { Body } from '../src'
test('shot', () => {
  const rig = person(); const ball = new Mesh(new SphereGeometry(RADIUS)); new Scene().add(rig, ball)
  const hand = new Hand(rig, 'right'); const body = new Body(rig); const held = inHand(body, hand, grip(hand, ball, SEAT)); const w = (body as any).workings
  let left = false
  body.play(jumpShot(body, held, () => (left = true)))
  let first: { t0: number; path: Vector3[] } | undefined
  let [worstDrift, worstGap, worstPlanVsBall] = [0, 0, 0]
  while (body.playing && !left) {
    body.update(1 / 60)
    const th = [...w.things.values()][0].channel
    const plan = th.intent()
    if (!first && plan.frames.some((f: any) => f.velocity.length() > 1)) first = { t0: body.time, path: plan.path.map((p: Vector3) => p.clone()) }
    if (first) {
      const k = Math.round((body.time - first.t0) * 30)
      if (k < first.path.length) {
        worstDrift = Math.max(worstDrift, first.path[k].distanceTo(th.value))
        worstPlanVsBall = Math.max(worstPlanVsBall, th.value.distanceTo(ball.position))
      }
    }
    worstGap = Math.max(worstGap, w.ends.hand.right.gap)
  }
  console.log('SHOT first-plan vs current plan', worstDrift.toFixed(3), 'current plan vs ball', worstPlanVsBall.toFixed(3), 'hand gap', worstGap.toFixed(3))
})
test('bowl', () => {
  const rig = person(); const mesh = sphere(); new Scene().add(rig, mesh)
  const hands = { left: new Hand(rig, 'left'), right: new Hand(rig, 'right') }
  const body = new Body(rig); const w = (body as any).workings
  const held = inHand(body, hands.right, grip(hands.right, mesh, GRIP))
  let freed = false
  body.play((function* () { yield* carry(body, held, grip(hands.left, mesh, SIDE.left)); yield* bowl(body, held, () => (freed = true)) })())
  let [plan, pose, gap] = [0, 0, 0]
  for (let n = 0; n < 1000 && !freed; n++) { body.update(1 / 120); plan = Math.min(plan, w.ends.hand.right.channel.value.z - body.hips.value.z); pose = Math.min(pose, body.hand.right.value.z - body.hips.value.z); gap = Math.max(gap, w.ends.hand.right.gap) }
  const th = [...w.things.values()][0]
  console.log('BOWL plan behind hips', plan.toFixed(3), 'pose behind hips', pose.toFixed(3), 'gap', gap.toFixed(3))
})
