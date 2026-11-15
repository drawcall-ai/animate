import type { Body, Story, Thing } from '@drawcall/animate'
import { flat } from '@drawcall/hand'
import { Vector3 } from 'three'

/** how fast the javelin leaves the hand, and how steeply up from level (m/s, rad) */
const THROW = { speed: 20, up: (30 * Math.PI) / 180 }
/** where it leaves the hand, above his right shoulder and a little behind it, and where the hand draws it back to first, the arm stretched behind him (of his arm) */
const RELEASE = { x: 0, y: 0.75, z: -0.3 }
const DRAWN = { x: 0, y: 0.6, z: -0.7 }
/** how fast he comes onto the front foot (m/s) */
const ARRIVE = 3

/**
 * A run-up and a throw with the `javelin` bound to him, led by his right hand: he runs on at `speed` and brakes onto his
 * left foot `at` a place, and as he comes over it the javelin leaves the hand above his shoulder, moving along its own
 * line; `letGo` gives how fast it leaves to whatever owns it next. The run, the trunk and the arm make up that speed.
 */
export function* javelinThrow(body: Body, javelin: Thing, speed: number, at: Vector3, letGo: (velocity: Vector3) => void): Story {
  const way = at.clone().sub(body.hips.value).setY(0).normalize()
  body.run({ speed, plant: 'left', at, arrive: ARRIVE })
  const flying = way.multiplyScalar(THROW.speed * Math.cos(THROW.up)).setY(THROW.speed * Math.sin(THROW.up))
  const release = body.when(at)
  const { arm } = body.size
  const line = { x: 0, y: Math.sin(THROW.up), z: Math.cos(THROW.up) }
  const of = (place: typeof RELEASE) => new Vector3(place.x, place.y, place.z).multiplyScalar(arm)
  // (the withdrawal: he runs the last strides with the javelin drawn back along its line, the palm up under it)
  void javelin.to(of(DRAWN), { on: body, pointing: line, palm: { x: 0, y: 1, z: 0 } })
  body.hand.right.shape(flat, { by: release })
  yield* javelin.by(release, of(RELEASE), { on: body, velocity: flying, pointing: line })
  letGo(javelin.free())
  body.hand.right.shape()
  yield* body.stand()
}
