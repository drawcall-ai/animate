import { CapsuleCollider, RigidBody } from '@drawcall/physics'
import { type Object3D, Vector3 } from 'three'
import { LENGTH, shaft, THICK } from './field'

/** how heavy it is (kg) */
const MASS = 0.8
/** how fast it turns its point into the way it flies, a radian off it (rad/s) */
const VANE = 20
/** how far down from level its point has to come in for it to stick in the ground, and how deep it goes in (rad, m) */
const STICK = (12 * Math.PI) / 180
const DEPTH = 0.15

const Z = new Vector3(0, 0, 1)

/**
 * A javelin: lying in the rack or on the grass, stuck in it, held, or flying, a body of its own the world moves,
 * point first.
 */
export class Javelin {
  readonly mesh = shaft()
  state: 'racked' | 'held' | 'flying' | 'down' | 'stuck' = 'racked'
  /** how far it went along the ground from where it left his hand, once it is down (m) */
  distance?: number
  private solid?: RigidBody
  private from = new Vector3()

  /** it lies in the rack as `place` is: its grip there, pointing along its z */
  constructor(
    private readonly scene: Object3D,
    place: Object3D,
  ) {
    this.mesh.position.copy(place.position)
    this.mesh.quaternion.copy(place.quaternion)
    scene.add(this.mesh)
  }

  /** whether it lies where he can take it */
  get free() {
    return this.state !== 'held' && this.state !== 'flying'
  }

  /** where its grip is in the scene */
  get grip() {
    this.mesh.updateWorldMatrix(true, false)
    return this.mesh.getWorldPosition(new Vector3())
  }

  /** which way it points in the scene */
  get pointing() {
    this.mesh.updateWorldMatrix(true, false)
    return new Vector3(0, 0, 1).transformDirection(this.mesh.matrixWorld)
  }

  /** where its point is in the scene */
  get point() {
    this.mesh.updateWorldMatrix(true, false)
    return this.mesh.localToWorld(new Vector3(0, 0, LENGTH.ahead))
  }

  /** it is taken up where it lies, in the scene's frame and no body of its own */
  take() {
    this.scene.attach(this.mesh)
    this.solid?.removeFromParent()
    this.solid = undefined
    this.state = 'held'
  }

  /** it is let go where it is, moving so: a body of its own in the world */
  release(velocity: Vector3) {
    const solid = new RigidBody({ mass: MASS, velocity: { linear: velocity.toArray() } })
    const length = LENGTH.ahead + LENGTH.behind
    const collider = new CapsuleCollider({ radius: THICK, height: length - 2 * THICK })
    collider.rotation.x = Math.PI / 2
    collider.position.z = (LENGTH.ahead - LENGTH.behind) / 2
    this.mesh.updateWorldMatrix(true, false)
    this.mesh.matrixWorld.decompose(solid.position, solid.quaternion, solid.scale)
    solid.scale.setScalar(1)
    solid.add(collider, this.mesh)
    this.mesh.position.set(0, 0, 0)
    this.mesh.quaternion.identity()
    this.mesh.scale.setScalar(1)
    this.scene.add(solid)
    this.solid = solid
    this.from = solid.position.clone()
    this.state = 'flying'
  }

  /** a frame: flying, it turns into the way it goes, and as it meets the ground it sticks in, point first, or comes down */
  update() {
    const { solid } = this
    if (this.state !== 'flying' || !solid) return
    const going = solid.getVelocity().linear.normalize()
    const pointing = Z.clone().applyQuaternion(solid.quaternion)
    solid.setVelocity({ angular: pointing.clone().cross(going).multiplyScalar(VANE) })
    const point = this.point
    const touched = solid.getContacts().length > 0
    if (point.y > 0 && !touched) return
    this.distance = Math.hypot(point.x - this.from.x, point.z - this.from.z)
    if (pointing.y > -Math.sin(STICK)) {
      this.state = 'down'
      return
    }
    // it stays as it came in, its point in the ground
    this.scene.attach(this.mesh)
    this.mesh.position.addScaledVector(pointing, DEPTH - point.y / pointing.y)
    solid.removeFromParent()
    this.solid = undefined
    this.state = 'stuck'
  }
}
