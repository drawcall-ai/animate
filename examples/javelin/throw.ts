import type { Body, Story } from '@drawcall/animate'
import { Vector3 } from 'three'
import { type Javelin, THICK, letGo } from './field'

const degrees = (angle: number) => (angle * Math.PI) / 180
const place = (x: number, y: number, z: number) => new Vector3(x, y, z)
/** where the front foot comes down, ahead of where the thrower starts (m) */
const PLANT = 10

/** A run-up and a throw with the right arm: the javelin leaves the hand at 20 m/s, 30° up. */
export function* javelinThrow(body: Body, javelin: Javelin): Story {
  // the javelin is carried over the shoulder, the hand beside his head
  body.hand.right.shape({ around: THICK })
  body.hand.right.to(place(-0.05, 0.3, -0.1), { on: body })
  // he brakes onto the front leg, and as he comes over it the hand lets go, above and behind the shoulder, moving across the arm:
  // the run, the trunk and the arm make up that speed between them, and the fingers open as it goes
  body.run({ speed: 5.5, plant: 'left', at: PLANT, arrive: 3 })
  const [speed, up] = [20, degrees(30)]
  const flying = place(0, speed * Math.sin(up), speed * Math.cos(up))
  const release = body.when(PLANT)
  body.hand.right.shape('flat', { by: release })
  yield* body.hand.right.by(release, place(0, 0.46, -0.3), { velocity: flying, on: body, with: 'grip' })
  letGo(javelin, body.hand.right.grip, flying)

  yield* body.stand()
}
