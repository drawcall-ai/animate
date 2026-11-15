import { grip, Hand } from '@drawcall/hand'
import { CylinderGeometry, Mesh, Scene, Vector3 } from 'three'
import { expect, test } from 'vitest'
import { person } from '../../../examples/person'
import { Body } from '../src'

const FRAME = 1 / 60
const degrees = (radians: number) => (radians * 180) / Math.PI

test('a tool sent with its grip points its z the way said, its palm rolled as near the way said', () => {
  const rod = new Mesh(new CylinderGeometry(0.015, 0.015, 0.8).rotateX(Math.PI / 2))
  rod.position.set(-0.35, 0.95, 0.2)
  const rig = person()
  new Scene().add(rig, rod).updateMatrixWorld(true)
  const hand = new Hand(rig, 'right')
  // (round the rod, the palm on its -x side)
  const held = grip(hand, rod, { at: new Vector3(-0.015, 0, 0), from: new Vector3(-1, 0, 0) })
  const body = new Body(rig)
  const pointing = new Vector3(0.3, 0.6, 1).normalize()
  const palm = new Vector3(1, 0, 0)
  const asked = [] as { points: number; faces: number }[]
  body.play(
    (function* () {
      yield* body.hand.right.to(held)
      const thing = body.bind(rod)
      thing.on(body.hand.right, held)
      yield* thing.to({ x: -0.25, y: 1.25, z: 0.45 }, { pointing, palm, seconds: 1 })
      rod.updateWorldMatrix(true, false)
      const z = new Vector3(0, 0, 1).transformDirection(rod.matrixWorld)
      // (the palm faces the rod's +x, from its -x side)
      const x = new Vector3(1, 0, 0).transformDirection(rod.matrixWorld)
      const flat = palm.clone().addScaledVector(pointing, -palm.dot(pointing)).normalize()
      asked.push({ points: degrees(z.angleTo(pointing)), faces: degrees(x.angleTo(flat)) })
      yield* body.stand()
    })(),
  )
  for (let t = 0; t < 10 && body.playing; t += FRAME) body.update(FRAME)
  expect(asked).toHaveLength(1)
  expect(asked[0].points).toBeLessThan(8)
  expect(asked[0].faces).toBeLessThan(15)
})
