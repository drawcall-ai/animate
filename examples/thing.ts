import { type Collider, RigidBody, type RigidBodyOptions } from '@drawcall/physics'
import { type Object3D, Vector3 } from 'three'

/**
 * A thing that is his or the world's, never both. Held, his hands move it and the physics world does not know it; let
 * go, it is a body of its own the world moves, leaving as fast as his hand moved it; taken again, it is out of the
 * world where it is, and his.
 */
export class Thing {
  /** the body the world moves it as, while it is the world's */
  private solid?: RigidBody

  /** `mesh` is drawn in `scene`, and let go it is a body made as `options` say, its shape `colliders` or else its mesh's */
  constructor(
    readonly mesh: Object3D,
    private readonly scene: Object3D,
    private readonly options: RigidBodyOptions = {},
    private readonly colliders: Collider[] = [],
  ) {}

  /** whether it is the world's */
  get free() {
    return this.solid !== undefined
  }

  /** where it is in the scene */
  get place() {
    return this.mesh.getWorldPosition(new Vector3())
  }

  /** how it moves, as the world has it; none while it is his */
  get velocity() {
    return this.solid ? this.solid.getVelocity().linear.clone() : new Vector3()
  }

  /** it is let go where it is, moving so: the world's from now on */
  release(velocity = new Vector3()) {
    const solid = new RigidBody({ ...this.options, velocity: { linear: velocity.toArray() } })
    this.mesh.updateWorldMatrix(true, false)
    this.mesh.matrixWorld.decompose(solid.position, solid.quaternion, solid.scale)
    solid.add(...this.colliders, this.mesh)
    this.mesh.position.set(0, 0, 0)
    this.mesh.quaternion.identity()
    this.mesh.scale.copy(solid.scale)
    solid.scale.setScalar(1)
    this.scene.add(solid)
    this.solid = solid
    return solid
  }

  /** it is taken out of the world where it is, to be moved by whoever holds it */
  take() {
    this.scene.attach(this.mesh)
    this.solid?.removeFromParent()
    this.solid = undefined
  }
}
