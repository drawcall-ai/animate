import type { Body, Story } from '@drawcall/animate'
import { type Ball, meeting, strike } from './pitch'

const degrees = (angle: number) => (angle * Math.PI) / 180

/** A run-up and a shot with the right foot: it meets the ball at 20 m/s, to send it off rising 8.6°. */
export function* shot(body: Body, ball: Ball): Story {
  const spot = ball.position.z
  // the left foot comes down beside the ball and a little behind it, he brakes onto it, and the right foot meets the ball
  body.run({ speed: 3.6, plant: 'left', at: spot - 0.35, arrive: 2.5 })
  const through = meeting(ball, 20, degrees(8.6))
  yield* body.foot.right.to(through.at, through)
  strike(ball, body.foot.right.value, body.foot.right.velocity)

  yield* body.stand()
}
