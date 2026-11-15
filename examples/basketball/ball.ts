import type { Grip } from '@drawcall/hand'
import { RigidBody } from '@drawcall/physics'
import { Mesh, MeshStandardMaterial, type Object3D, SphereGeometry, Vector3 } from 'three'

/** how large a ball is, and how heavy (m, kg) */
export const RADIUS = 0.12
const MASS = 0.62
/** how fast its spin dies away, which brings it to rest rolling on the floor, its flight untouched (1/s) */
const ROLLING = 1
/** how much of its speed it keeps off the floor */
const BOUNCE = 0.85
const GRAVITY = 9.81

/** where a ball bounced off the floor is, and how it moves, `seconds` after it left a place moving so */
function flown(from: Vector3, velocity: Vector3, seconds: number) {
  const fall = landing(from, velocity)
  if (seconds <= fall) {
    const place = from.clone().addScaledVector(velocity, seconds).setY(from.y + velocity.y * seconds - (GRAVITY / 2) * seconds ** 2)
    return { place, velocity: velocity.clone().setY(velocity.y - GRAVITY * seconds) }
  }
  const up = BOUNCE * (GRAVITY * fall - velocity.y)
  const since = seconds - fall
  const place = from.clone().addScaledVector(velocity, seconds).setY(RADIUS + up * since - (GRAVITY / 2) * since ** 2)
  return { place, velocity: velocity.clone().setY(up - GRAVITY * since) }
}

/** how long a ball that left a place moving so takes to come down onto the floor (s) */
function landing(from: Vector3, velocity: Vector3) {
  const { y } = velocity
  return (y + Math.sqrt(y * y + 2 * GRAVITY * (from.y - RADIUS))) / GRAVITY
}

/** how fast a ball let go so high is pushed down for it to come back up so high, its middle (m, m/s) */
export function pushing(from: number, to: number) {
  const floor = Math.sqrt(2 * GRAVITY * (to - RADIUS)) / BOUNCE
  return Math.sqrt(Math.max(0, floor * floor - 2 * GRAVITY * (from - RADIUS)))
}

/**
 * The ball: free, a body of its own the world moves; bouncing, his between his hand and the floor; or held in the
 * scene's frame, which his hands move.
 */
export class Ball {
  readonly mesh = new Mesh(new SphereGeometry(RADIUS, 24, 16), new MeshStandardMaterial({ color: 0xe07020 }))
  private solid?: RigidBody
  /** where it left his hand, how it moved, and when, on his clock (m, m/s, s) */
  private bounce?: { from: Vector3; velocity: Vector3; since: number }
  /** the grip the hand that has it holds it by */
  held?: Grip

  constructor(private readonly scene: Object3D) {}

  get free() {
    return this.solid !== undefined
  }

  /** where it is in the scene */
  get place() {
    return this.mesh.getWorldPosition(new Vector3())
  }

  /** it is let go where it is, moving so: a body of its own in the world */
  release(velocity: Vector3) {
    const solid = new RigidBody({ mass: MASS, velocity: { linear: velocity.toArray() }, material: { restitution: BOUNCE } })
    solid.setAngularDamping(ROLLING)
    solid.position.copy(this.place)
    solid.add(this.mesh)
    this.mesh.position.set(0, 0, 0)
    this.mesh.quaternion.identity()
    this.mesh.scale.setScalar(1)
    this.scene.add(solid)
    this.solid = solid
    this.bounce = this.held = undefined
  }

  /** it leaves his hand where it is, moving so, at the moment `now` on his clock, to bounce off the floor and come back up */
  dribble(velocity: Vector3, now: number) {
    this.bounce = { from: this.place, velocity: velocity.clone(), since: now }
    this.scene.attach(this.mesh)
    this.held = undefined
  }

  /** where it will be and how it will move as it comes back up through so far `below` the height it left his hand at, and when (on his clock) */
  rising(below: number) {
    if (!this.bounce) throw new Error('the ball is not bouncing')
    const { from, velocity, since } = this.bounce
    const fall = landing(from, velocity)
    const up = BOUNCE * (GRAVITY * fall - velocity.y)
    const rise = from.y - below - RADIUS
    // (it does not come back so high: at the top it reaches)
    const climb = up * up >= 2 * GRAVITY * rise ? (up - Math.sqrt(up * up - 2 * GRAVITY * rise)) / GRAVITY : up / GRAVITY
    const seconds = fall + climb
    return { time: since + seconds, ...flown(from, velocity, seconds) }
  }

  /** it is taken where it is, by a grip if that is said yet: no body of its own, nor bouncing */
  take(held?: Grip) {
    this.scene.attach(this.mesh)
    this.solid?.removeFromParent()
    this.solid = this.bounce = undefined
    this.held = held
  }

  /** where it has bounced to by the moment `now` on his clock, if it bounces */
  update(now: number) {
    if (!this.bounce) return
    const { from, velocity, since } = this.bounce
    this.mesh.position.copy(flown(from, velocity, now - since).place)
  }

  /** how it moves by the moment `now` on his clock, if it is not held (m/s) */
  velocity(now: number) {
    if (this.solid) return this.solid.getVelocity().linear.clone()
    if (!this.bounce) return new Vector3()
    const { from, velocity, since } = this.bounce
    return flown(from, velocity, now - since).velocity
  }
}
