import { RigidBody } from '@drawcall/physics'
import { Mesh, MeshStandardMaterial, type Object3D, SphereGeometry, Vector3 } from 'three'
import { RADIUS, strike } from './pitch'

/** how heavy a ball is, how much of its speed it keeps off the grass, and how fast the grass takes its rolling and spin (kg, 1/s) */
const MASS = 0.43
const BOUNCE = 0.6
const DRAG = 1

/** The ball: a body of its own on the grass and against the goal; what touches it is his feet. */
export class Ball {
  private readonly solid = new RigidBody({ mass: MASS, material: { restitution: BOUNCE } })

  /** a ball lying on the grass at a place in the `scene` */
  constructor(scene: Object3D, at: { x: number; z: number }) {
    this.solid.position.set(at.x, RADIUS, at.z)
    this.solid.add(new Mesh(new SphereGeometry(RADIUS, 24, 16), new MeshStandardMaterial({ color: 0xf4f4f4 })))
    this.solid.setLinearDamping(DRAG).setAngularDamping(DRAG)
    scene.add(this.solid)
  }

  get place() {
    return this.solid.position.clone()
  }

  get velocity() {
    return this.solid.getVelocity().linear.clone()
  }

  /** where it will have rolled to along the grass in so many seconds, slowing as the grass has it (m) */
  rolled(seconds: number) {
    return this.place.addScaledVector(this.velocity.setY(0), (1 - Math.exp(-DRAG * seconds)) / DRAG)
  }

  /**
   * a foot meets it, moving so, and pushes it the `way` it meets it: it leaves as their closing speed sends it, what it
   * had across that way taken by the foot
   */
  kick(way: Vector3, foot: Vector3) {
    const along = way.clone().normalize()
    const was = along.clone().multiplyScalar(Math.max(0, this.velocity.dot(along)))
    const closing = foot.clone().sub(was)
    // (a foot that does not close on it does not send it)
    if (closing.dot(way) <= 0) return
    const hit = { position: this.place, velocity: new Vector3() }
    strike(hit, hit.position.clone().sub(way), closing)
    // (sent along the grass it rolls at once, as an instep's touch sets it: so where it rolls to is told by its drag alone)
    const linear = hit.velocity.add(was)
    this.solid.setVelocity({ linear, angular: new Vector3(linear.z, 0, -linear.x).divideScalar(RADIUS) })
    this.solid.wake()
  }
}
