import { Hand } from '@drawcall/hand'
import { Group, Matrix4, Vector3 } from 'three'
import { test } from 'vitest'
import { person } from '../../../examples/person'
import { ARM, fore, pistol, pocket, rifle } from '../../../examples/shooter/rifle'
import { Body } from '../src'
test('probe', () => {
  const scene = new Group(); const rig = person(); scene.add(rig); const body = new Body(rig)
  const hands = { right: new Hand(rig, 'right'), left: new Hand(rig, 'left') }
  const gun = rifle(); const handle = gun.getObjectByName('fore')!
  const held = { right: pistol(hands.right, gun).held, left: fore(hands.left, handle) }
  gun.scale.setScalar(body.size.arm / ARM); scene.add(gun)
  const pose = (aim: number) => { gun.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), aim); gun.position.copy(pocket(body, 'right')); gun.updateMatrixWorld(true) }
  pose(0)
  const bound = body.bind(gun, { outside: true })
  for (const side of ['right', 'left'] as const) bound.on(body.hand[side], held[side])
  const W = (body as any).workings
  for (let t = 0; t < 6; t += 1 / 60) {
    if (t > 2) body.go({ x: 0, z: 1.4 })
    pose(Math.atan2(body.facing.x, body.facing.z) + 0.05 * Math.sin(3 * t))
    body.update(1 / 60); scene.updateMatrixWorld(true)
    if (t > 2.5) for (const side of ['right', 'left'] as const) {
      const { target, position, quaternion } = held[side]
      const wrist = new Vector3().setFromMatrixPosition(target.matrixWorld.clone().multiply(new Matrix4().compose(position, quaternion, new Vector3(1, 1, 1)).invert()))
      const tp = wrist.distanceTo(rig.getObjectByName(side + 'Hand')!.getWorldPosition(new Vector3())); if (tp > 0.02) console.log(t.toFixed(2), side, 'posed-off', tp.toFixed(3), 'truth-plan', wrist.distanceTo(W.ends.hand[side].channel.value).toFixed(3), 'gap', W.ends.hand[side].gap.toFixed(3), 'fold', W.joints.arms[side].second.value.x.toFixed(2))
    }
  }
})
