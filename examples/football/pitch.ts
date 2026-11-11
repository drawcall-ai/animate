import { type Mass, type Round, advance, len, mass, mul } from 'animate-2d'

export const GOAL = { away: 11, high: 2.44, deep: 1.6 }

export type Ball = Mass & Round & { spot: number; result: 'in the goal' | 'over the bar' | 'short of the goal' | null }
export type Strike = { time: number; speed: number; angle: number; foot: number }
/** what the player acts on: the ball, and how it was struck */
export type Pitch = { ball: Ball; struck: Strike | null }

export const ballAt = (x: number): Ball => ({ ...mass(x, 0.11, 0.43), radius: 0.11, spot: x, result: null })

export function fly(ball: Ball, dt: number) {
  advance([ball], [], dt)
  if (ball.p.y < ball.radius) {
    ball.p.y = ball.radius
    if (ball.v.y < 0) ball.v.y = ball.v.y < -0.8 ? -0.55 * ball.v.y : 0
    ball.v.x *= 1 - 0.5 * dt
  }
  const line = ball.spot + GOAL.away
  if (!ball.result && ball.p.x >= line) ball.result = ball.p.y < GOAL.high ? 'in the goal' : 'over the bar'
  if (!ball.result && ball.p.x > ball.spot + 0.3 && len(ball.v) < 0.3) ball.result = 'short of the goal'
  if (ball.result !== 'in the goal') return
  // the net takes the ball's speed
  ball.v = mul(ball.v, 1 - Math.min(1, 9 * dt))
  if (ball.p.x > line + GOAL.deep) {
    ball.p.x = line + GOAL.deep
    ball.v.x = 0
  }
}
