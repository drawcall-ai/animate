import type { RigidBody } from '@dimforge/rapier3d-compat'
import { BoxGeometry, CapsuleGeometry, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three'
import type { Bone } from './skeleton'

/** How a muscle holds its joint: how fast it gets there (Hz), how it settles (1 is without overshoot), and the share of the joint's strength it may use. */
export type Muscle = { frequency: number; damping: number; strength: number }

export const muscles = {
  /** what a part does when nothing asks anything of it */
  tone: { frequency: 2.5, damping: 0.8, strength: 1 },
  loose: { frequency: 1.5, damping: 0.5, strength: 0.5 },
  firm: { frequency: 6, damping: 1, strength: 1 },
  slack: { frequency: 0, damping: 0, strength: 0 },
} satisfies Record<string, Muscle>

const material = new MeshStandardMaterial()
const rest = new Quaternion()
const ownTurn = new Quaternion()
const turn = new Quaternion()
const own = new Quaternion()
const error = new Vector3()
const spin = new Vector3()

/** a rotation as the vector along its axis, as long as its angle (rad) */
export function rotationVector(q: Quaternion, target: Vector3) {
  const sign = q.w < 0 ? -1 : 1
  const sin = Math.hypot(q.x, q.y, q.z)
  const angle = 2 * Math.atan2(sin, sign * q.w)
  return target.set(q.x, q.y, q.z).multiplyScalar(sin < 1e-9 ? 0 : (sign * angle) / sin)
}

/**
 * A body part: the mesh shows where its rigid body is. Each step its muscle turns it toward a target, its rotation
 * against the parent's with rest as identity. What a timeline asks of it comes before what a reflex offers, and
 * after the step it is back to rest.
 */
export class Part extends Mesh {
  private readonly target = new Quaternion()
  private muscle: Muscle = muscles.tone
  /** whether a target or a muscle was asked of it in this step */
  asked = false

  constructor(
    bone: Bone,
    readonly body: RigidBody,
    readonly joint?: { parent: Part; strength: number; inertia: Vector3; anchor: Vector3 },
  ) {
    super('box' in bone.shape ? new BoxGeometry(...bone.shape.box.map((half) => 2 * half)) : new CapsuleGeometry(bone.shape.radius, 2 * bone.shape.half), material)
    this.follow()
  }

  follow() {
    this.position.copy(this.body.translation())
    this.quaternion.copy(this.body.rotation())
  }

  /** its rotation against the parent's, rest being identity */
  bend(target = new Quaternion()) {
    if (!this.joint) return target.identity()
    return target.copy(this.joint.parent.body.rotation()).invert().multiply(own.copy(this.body.rotation()))
  }

  /** where its joint to the parent is in the world */
  socket(target = new Vector3()) {
    if (this.joint) target.copy(this.joint.anchor)
    else target.set(0, 0, 0)
    return target.applyQuaternion(own.copy(this.body.rotation())).add(this.body.translation())
  }

  /** what a timeline wants of it in this step: the last to ask is obeyed */
  ask(muscle: Muscle, target: Quaternion = rest) {
    this.target.copy(target)
    this.muscle = muscle
    this.asked = true
  }

  /** what it does in this step if nothing was asked of it */
  offer(muscle: Muscle, target: Quaternion = rest) {
    if (this.asked) return
    this.target.copy(target)
    this.muscle = muscle
  }

  drive(dt: number) {
    if (!this.joint) return
    const { parent, strength, inertia } = this.joint
    const rate = 2 * Math.PI * this.muscle.frequency
    ownTurn.copy(this.body.rotation())
    rotationVector(this.bend(turn).invert().multiply(this.target), error)
    spin.copy(this.body.angvel()).sub(parent.body.angvel()).applyQuaternion(turn.copy(ownTurn).invert())
    error
      .multiplyScalar(rate * rate)
      .addScaledVector(spin, -2 * this.muscle.damping * rate)
      .multiply(inertia)
      .clampLength(0, strength * this.muscle.strength)
      .applyQuaternion(ownTurn)
      .multiplyScalar(dt)
    this.body.applyTorqueImpulse(error, true)
    parent.body.applyTorqueImpulse(error.negate(), true)
    this.target.identity()
    this.muscle = muscles.tone
    this.asked = false
  }
}
