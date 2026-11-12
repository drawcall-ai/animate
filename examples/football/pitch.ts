import { ColliderDesc, type RigidBody, RigidBodyDesc, World } from '@dimforge/rapier3d-compat'

export const BALL = { radius: 0.11, kg: 0.43, spot: { x: -0.15, y: 0.11, z: 4.6 } }

/** a flat pitch with a ball lying a run-up ahead of where a humanoid stands, in the line of its right foot */
export function pitch() {
  const world = new World({ x: 0, y: -9.81, z: 0 })
  world.createCollider(ColliderDesc.cuboid(100, 0.5, 100).setTranslation(0, -0.5, 0).setFriction(1))
  const { x, y, z } = BALL.spot
  const ball = world.createRigidBody(RigidBodyDesc.dynamic().setTranslation(x, y, z).setCcdEnabled(true))
  world.createCollider(ColliderDesc.ball(BALL.radius).setMass(BALL.kg).setRestitution(0.6), ball)
  return { world, ball }
}

/** how fast the ball left its spot (m/s), once it has */
export function launch(ball: RigidBody) {
  const at = ball.translation()
  if (Math.hypot(at.x - BALL.spot.x, at.z - BALL.spot.z) < 0.3) return undefined
  const v = ball.linvel()
  return Math.hypot(v.x, v.y, v.z)
}
