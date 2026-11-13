import { Vector3 } from 'three'

export type Ball = { position: Vector3; velocity: Vector3 }

export const RADIUS = 0.11
/** a foot as it meets the ball: a round thing about the ankle, this much of the two in weight, and how much of their closing speed comes back */
const FOOT = { radius: 0.14, share: 2.5 / (2.5 + 0.43), bounce: 0.6 }
const GRAVITY = 9.81

/** a ball lying `ahead` of the origin (m), in the line of a right foot */
export const ballAt = (ahead: number): Ball => ({
  position: new Vector3(-0.09, RADIUS, ahead),
  velocity: new Vector3(),
})

/** where an ankle is as its foot meets the ball to send it `up` from level (rad), and how it moves there at `speed` (m/s) */
export function meeting(ball: Ball, speed: number, up: number) {
  const toward = new Vector3(0, Math.sin(up), Math.cos(up))
  return {
    at: ball.position.clone().addScaledVector(toward, -RADIUS - FOOT.radius),
    velocity: toward.multiplyScalar(speed),
  }
}

/** the ball leaves a foot that met it: away from the ankle, with what the foot's speed toward it gives */
export function strike(ball: Ball, ankle: Vector3, velocity: Vector3) {
  const away = ball.position.clone().sub(ankle).normalize()
  ball.velocity.copy(away).multiplyScalar((1 + FOOT.bounce) * FOOT.share * velocity.dot(away))
}

export function fly(ball: Ball, dt: number) {
  if (ball.velocity.lengthSq() === 0) return
  ball.velocity.y -= GRAVITY * dt
  ball.position.addScaledVector(ball.velocity, dt)
  if (ball.position.y > RADIUS || ball.velocity.y > 0) return
  ball.position.y = RADIUS
  ball.velocity.y = ball.velocity.y < -0.8 ? -0.55 * ball.velocity.y : 0
  ball.velocity.multiplyScalar(1 - 0.5 * dt)
}
