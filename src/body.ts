import { ColliderDesc, JointData, RevoluteImpulseJoint, type RigidBody, RigidBodyDesc, type World } from '@dimforge/rapier3d-compat'
import { type PartName, SKELETON, type Triple, eachPart } from './skeleton'

/** the parts of a humanoid touch everything but each other */
const GROUPS = (0x0001 << 16) | 0xfffe
/** what sees everything but humanoids */
export const NOT_HUMANOID = 0xfffffffe

const ORIGIN = { x: 0, y: 0, z: 0 }
const UNTURNED = { x: 0, y: 0, z: 0, w: 1 }

const offset = (point: Triple, from: Triple) => ({ x: point[0] - from[0], y: point[1] - from[1], z: point[2] - from[2] })

/** the rigid bodies of a humanoid standing at the origin of a world, jointed together */
export function build(world: World) {
  const made = new Map<PartName, RigidBody>()
  return eachPart((name) => {
    const { center, shape, kg, joint, ballast } = SKELETON[name]
    const body = world.createRigidBody(RigidBodyDesc.dynamic().setTranslation(...center))
    const collider = 'box' in shape ? ColliderDesc.cuboid(...shape.box).setFriction(1) : ColliderDesc.capsule(shape.half, shape.radius)
    world.createCollider(collider.setMass(kg).setCollisionGroups(GROUPS), body)
    if (ballast) body.setAdditionalMassProperties(0, ORIGIN, { x: ballast, y: ballast, z: ballast }, UNTURNED, true)
    made.set(name, body)
    if (!joint) return body
    const parent = made.get(joint.parent)
    if (!parent) throw new Error(`${name} is listed before its parent ${joint.parent}`)
    const anchors = [offset(joint.at, SKELETON[joint.parent].center), offset(joint.at, center)] as const
    if (!joint.hinge) {
      world.createImpulseJoint(JointData.spherical(...anchors), parent, body, true)
      return body
    }
    const hinge = world.createImpulseJoint(JointData.revolute(...anchors, { x: 1, y: 0, z: 0 }), parent, body, true)
    if (!(hinge instanceof RevoluteImpulseJoint)) throw new Error(`the joint of ${name} is not the hinge it was made as`)
    hinge.setLimits(...joint.hinge)
    return body
  })
}
