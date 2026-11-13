import type { Body } from 'animate-2d'
import { Euler, Quaternion, Vector3 } from 'three'

/** a tennis ball: where it is and how it moves, whether it has been fed to him yet, and how often the strings have met it */
export type Ball = { position: Vector3; velocity: Vector3; fed: boolean; struck: number }

/** how big the ball is (m), and how much of its speed up and along comes back off the ground */
export const BALL = { radius: 0.033, bounce: 0.72, slide: 0.7 }
/** a racket: how far from the wrist the middle of its strings is, how wide its head is (m), and how much of the closing speed comes back off the strings */
export const RACKET = { reach: 0.5, head: 0.14, spring: 0.4 }
/** how the ball is fed to him: from where, and moving how (m, m/s) */
const FEED = { from: new Vector3(-1.245, 1, 11.9), velocity: new Vector3(0, 4.5, -8) }
/** how near the middle of the strings the ball counts as on them (m) */
const TOUCH = 0.2
const GRAVITY = 9.81
const STEP = 1 / 200

/** a ball waiting at the far end to be fed */
export const ballAt = (): Ball => ({ position: FEED.from.clone(), velocity: new Vector3(), fed: false, struck: 0 })

/** the ball is fed to him */
export function feed(ball: Ball) {
  ball.fed = true
  ball.velocity.copy(FEED.velocity)
}

/** it flies and bounces off the ground */
export function fly(ball: Ball, dt: number) {
  if (!ball.fed) return
  ball.velocity.y -= GRAVITY * dt
  ball.position.addScaledVector(ball.velocity, dt)
  if (ball.position.y > BALL.radius || ball.velocity.y > 0) return
  ball.position.y = BALL.radius
  ball.velocity.set(ball.velocity.x * BALL.slide, -ball.velocity.y * BALL.bounce, ball.velocity.z * BALL.slide)
}

/** how long from now the ball is at the top of its first bounce, and where it is then */
export function top(ball: Ball) {
  const then = { ...ball, position: ball.position.clone(), velocity: ball.velocity.clone() }
  let bounced = false
  for (let seconds = 0; seconds < 10; seconds += STEP) {
    const falling = then.velocity.y < 0
    fly(then, STEP)
    if (bounced && then.velocity.y <= 0) return { seconds: seconds + STEP, at: then.position }
    bounced ||= falling && then.velocity.y > 0
  }
  throw new Error('the ball does not bounce')
}

/** where the middle of the strings is, the racket held in the right hand: on along the forearm, as the trunk, the arm and the elbow have it turned */
export function strings(body: Body) {
  const turned = new Quaternion()
  for (const part of [body.trunk, body.arm.right, body.forearm.right]) {
    turned.multiply(new Quaternion().setFromEuler(new Euler().setFromVector3(part.value)))
  }
  return new Vector3(0, -RACKET.reach, 0).applyQuaternion(turned).add(body.hand.right.value)
}

/** where the right wrist is as the strings meet a ball, the hand so far `out` from the shoulder */
export const held = (ball: Vector3, out: Vector3) => out.clone().setLength(-RACKET.reach).add(ball)

/** strings that are on the ball send it off the way the hand is moving */
export function strike(ball: Ball, body: Body) {
  if (strings(body).distanceTo(ball.position) > TOUCH) return
  const { velocity } = body.hand.right
  const way = velocity.clone().normalize()
  const closing = velocity.dot(way) - ball.velocity.dot(way)
  if (closing <= 0) return
  ball.velocity.addScaledVector(way, (1 + RACKET.spring) * closing)
  ball.struck++
}
