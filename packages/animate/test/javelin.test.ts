import { grip, Hand } from '@drawcall/hand'
import { Line3, Scene, Vector3 } from 'three'
import { expect, test } from 'vitest'
import { inHand } from '../../../examples/character'
import { GRIP, LENGTH, shaft } from '../../../examples/javelin/field'
import { javelinThrow } from '../../../examples/javelin/throw'
import { Body } from '../src'
import { person } from '../../../examples/person'

test('the throw: the javelin leaves the hand as written, point first, and he ends standing', () => {
  const man = person()
  const drawn = shaft()
  new Scene().add(man, drawn)
  const hand = new Hand(man, 'right')
  const body = new Body(man)
  const held = inHand(body, hand, grip(hand, drawn, GRIP))
  let left: { speed: number; up: number; off: number } | undefined
  body.play(
    javelinThrow(body, held, 5.5, new Vector3(0, 0, 10), (velocity) => {
      drawn.updateWorldMatrix(true, false)
      const pointing = new Vector3(0, 0, 1).transformDirection(drawn.matrixWorld)
      left = {
        speed: velocity.length(),
        up: (Math.atan2(velocity.y, velocity.z) * 180) / Math.PI,
        off: (pointing.angleTo(velocity) * 180) / Math.PI,
      }
    }),
  )
  for (let n = 0; n < 600 && body.playing; n++) body.update(1 / 60)
  // written: 20 m/s, 30° up, along its own line
  expect(left?.speed).toBeCloseTo(20, 0)
  expect(Math.abs((left?.up ?? 0) - 30)).toBeLessThan(2)
  expect(left?.off).toBeLessThan(10)
  expect(body.playing).toBe(false)
  expect(body.hips.value.y).toBeCloseTo(body.size.stand, 1)
  // feet side by side: within a tenth of a metre of each other
  expect(Math.abs(body.foot.left.value.z - body.foot.right.value.z)).toBeLessThan(0.11)
})

test('the javelin never passes through his head on its way to the release', () => {
  const man = person()
  const drawn = shaft()
  new Scene().add(man, drawn)
  const hand = new Hand(man, 'right')
  const body = new Body(man)
  const held = inHand(body, hand, grip(hand, drawn, GRIP))
  let gone = false
  body.play(javelinThrow(body, held, 5.5, new Vector3(0, 0, 10), () => (gone = true)))
  let nearest = Infinity
  for (let n = 0; n < 4000 && body.playing && !gone; n++) {
    body.update(body.size.beat / 60)
    drawn.updateWorldMatrix(true, false)
    const [point, butt] = [new Vector3(0, 0, LENGTH.ahead), new Vector3(0, 0, -LENGTH.behind)].map((end) => end.applyMatrix4(drawn.matrixWorld))
    const eyes = body.eye('left').add(body.eye('right')).multiplyScalar(0.5)
    nearest = Math.min(nearest, new Line3(point, butt).closestPointToPoint(eyes, true, new Vector3()).distanceTo(eyes))
  }
  // (the hand's way round the shoulder dipped in through it and out, and the shaft went 12 cm from his eyes)
  expect(nearest).toBeGreaterThan(0.2)
})
