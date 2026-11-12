import {
  ColliderDesc,
  type ImpulseJoint,
  JointData,
  type RigidBody,
  RigidBodyDesc,
  World,
} from '@dimforge/rapier3d-compat'
import type { Humanoid } from 'animate-2d'

export const JAVELIN = { length: 2.6, radius: 0.012, kg: 0.8 }
/** how far up from level the javelin points while it is carried (rad) */
const CARRIED = 0.5
/** the javelin touches the ground but not the thrower */
const GROUPS = (0x0002 << 16) | 0x0002

export type Held = { javelin: RigidBody; grip: ImpulseJoint }

/** a flat field and a javelin in the right hand of the humanoid that will stand at its origin */
export function field() {
  const world = new World({ x: 0, y: -9.81, z: 0 })
  world.createCollider(ColliderDesc.cuboid(100, 0.5, 100).setTranslation(0, -0.5, 0).setFriction(1))
  const tilt = Math.PI / 2 - CARRIED
  const pointing = { x: Math.sin(tilt / 2), y: 0, z: 0, w: Math.cos(tilt / 2) }
  const javelin = world.createRigidBody(
    RigidBodyDesc.dynamic().setTranslation(-0.2, 0.87, 0).setRotation(pointing).setCcdEnabled(true),
  )
  const shaft = ColliderDesc.capsule(JAVELIN.length / 2 - JAVELIN.radius, JAVELIN.radius).setMass(JAVELIN.kg)
  world.createCollider(shaft.setCollisionGroups(GROUPS), javelin)
  return { world, javelin }
}

/** the right hand closes round the middle of the javelin, which stays free to point where it points */
export function hold(human: Humanoid, javelin: RigidBody): Held {
  const hand = { x: 0, y: -0.16, z: 0 }
  const grip = human.world.createImpulseJoint(
    JointData.spherical(hand, { x: 0, y: 0, z: 0 }),
    human.parts.rightForearm.body,
    javelin,
    true,
  )
  return { javelin, grip }
}

/** the same javelin and grip in a copy of their world */
export const heldIn = (world: World, { javelin, grip }: Held): Held => ({
  javelin: world.getRigidBody(javelin.handle),
  grip: world.getImpulseJoint(grip.handle),
})

/** how fast the javelin goes and how far up from level (m/s, rad) */
export function flight(javelin: RigidBody) {
  const v = javelin.linvel()
  return { speed: Math.hypot(v.x, v.y, v.z), angle: Math.atan2(v.y, Math.hypot(v.x, v.z)), forward: v.z > 0 }
}

/** how fast the javelin left the hand (m/s), once it has */
export const released = (world: World, { javelin, grip }: Held) =>
  world.impulseJoints.contains(grip.handle) ? undefined : flight(world.getRigidBody(javelin.handle)).speed
