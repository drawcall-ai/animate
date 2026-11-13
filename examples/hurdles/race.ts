import type { Body, Story } from '@drawcall/animate'
import type { Hurdle } from './track'

/** how fast he sprints (m/s) */
const SPEED = 7
/** how far before a hurdle he takes off, and how far over its bar the hips are at the top (m) */
const OFF = 2
const HIPS = 0.5
/** how far over the bar the ankle of the lead foot goes (m) */
const CLEAR = 0.25
/** where the trail foot is from its hip at the top: folded up, out to the side (m) */
const TUCK = { x: 0.35, y: -0.1, z: -0.3 }
/** how far past the last hurdle he runs on (m) */
const ON = 6

/** He sprints down the track, clears the hurdles in stride, runs on and comes to a stand. */
export function* race(body: Body, hurdles: Hurdle[], speed = SPEED): Story {
  for (const { z, height } of hurdles) {
    // he takes off from the left foot, and is highest over the bar
    body.run({ speed, at: z - OFF, plant: 'left' })
    body.jump({ x: 0, y: height + HIPS, z })
    // the lead foot goes over the bar ahead of him, and the trail foot comes through folded up at his side
    body.foot.right.to({ x: -body.size.hip, y: height + CLEAR, z }, { velocity: { x: 0, y: 0, z: speed } })
    const top = body.highest()
    body.foot.left.by(top, TUCK, { on: body, velocity: { x: 0, y: 0, z: speed } })
    // from the top on he is on his way to the next
    yield* body.until(top)
  }
  yield* body.run({ speed, at: hurdles[hurdles.length - 1].z + ON })
  yield* body.stand()
}
