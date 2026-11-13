import type { Body, Story } from 'animate-2d'
import { Vector3 } from 'three'
import type { Javelin } from './field'

const degrees = (angle: number) => (angle * Math.PI) / 180
const place = (x: number, y: number, z: number) => new Vector3(x, y, z)
/** where the front foot comes down, ahead of where the thrower starts (m) */
const PLANT = 10

/** A run-up and a throw with the right arm: the javelin leaves the hand at 20 m/s, 30° up. */
export function* javelinThrow(body: Body, javelin: Javelin): Story {
  // the javelin is carried over the shoulder, the hand beside his head
  body.hand.right.to(place(-0.05, 0.3, -0.1), { carried: true })
  // he brakes onto the front leg, and as he comes over it the hand lets go, above and behind the shoulder, moving across the arm:
  // the run, the trunk and the arm make up that speed between them
  body.run({ speed: 5.5, plant: 'left', at: PLANT, arrive: 3 })
  const [speed, up] = [20, degrees(30)]
  const flying = place(0, speed * Math.sin(up), speed * Math.cos(up))
  yield* body.hand.right.by(body.when(PLANT), place(0, 0.46, -0.3), { velocity: flying, carried: true })
  javelin.velocity = body.hand.right.velocity.clone()

  yield* body.stand()
}
