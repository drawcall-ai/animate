import type { Body, Held, Story } from '@drawcall/animate'
import { flat } from '@drawcall/hand'
import { type Object3D, Vector3 } from 'three'
import { type Flight, letGo } from './field'

const degrees = (angle: number) => (angle * Math.PI) / 180
const place = (x: number, y: number, z: number) => new Vector3(x, y, z)
/** where the front foot comes down, ahead of where the thrower starts (m) */
const PLANT = 10

/** A run-up and a throw with the right arm, the javelin `held` in its hand: it leaves the hand at 20 m/s, 30° up. */
export function* javelinThrow(body: Body, javelin: Flight, shaft: Object3D, held: Held): Story {
  // the javelin is carried over the shoulder, the hand beside his head
  body.hand.right.to(place(-0.05, 0.3, -0.1), { on: body })
  // he brakes onto the front leg, and as he comes over it the hand lets go, above and behind the shoulder, moving across the arm:
  // the run, the trunk and the arm make up that speed between them, and the fingers open as it goes
  body.run({ speed: 5.5, plant: 'left', at: PLANT, arrive: 3 })
  const [speed, up] = [20, degrees(30)]
  const flying = place(0, speed * Math.sin(up), speed * Math.cos(up))
  const release = body.when(PLANT)
  body.hand.right.shape(flat, { by: release })
  yield* held.by(release, place(0, 0.46, -0.3), { velocity: flying, on: body })
  held.free()
  letGo(javelin, shaft, flying)

  yield* body.stand()
}
