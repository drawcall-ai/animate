import type { Grip } from '@drawcall/hand'
import { RigidBody } from '@drawcall/physics'
import { Mesh, MeshStandardMaterial, type Object3D, SphereGeometry, Vector3 } from 'three'

/** how large a ball is, and how heavy (m, kg) */
export const RADIUS = 0.12
const MASS = 0.62
/** how much of its speed it keeps off the floor */
const BOUNCE = 0.85
const GRAVITY = 9.81

/** how long a ball let go so high, going down so fast, takes to come down onto the floor (s) */
function landing(high: number, down: number) {
  return (-down + Math.sqrt(down * down + 2 * GRAVITY * (high - RADIUS))) / GRAVITY
}

/** how high a ball let go so high, going down so fast, is `seconds` later, bounced off the floor once (m) */
function bounced(high: number, down: number, seconds: number) {
  const fall = landing(high, down)
  if (seconds <= fall) return high - down * seconds - (GRAVITY / 2) * seconds ** 2
  const up = BOUNCE * (down + GRAVITY * fall)
  const since = seconds - fall
  return RADIUS + up * since - (GRAVITY / 2) * since ** 2
}

/** how fast a ball let go so high is pushed down for it to come back up so high, its middle (m, m/s) */
export function pushing(from: number, to: number) {
  const floor = Math.sqrt(2 * GRAVITY * (to - RADIUS)) / BOUNCE
  return Math.sqrt(Math.max(0, floor * floor - 2 * GRAVITY * (from - RADIUS)))
}

/**
 * The ball, which has one owner at a time: the physics world, a body of its own there; the floor, bouncing off it
 * between pushes of a dribble, under where the hand that dribbles it seats it; or no one of the game's, lying still or
 * bound to his hand.
 */
export class Ball {
  readonly mesh = new Mesh(new SphereGeometry(RADIUS, 24, 16), new MeshStandardMaterial({ color: 0xe07020 }))
  private solid?: RigidBody
  /** the hand it bounces under: its bone and where it seats the ball; how high it left the hand, going down how fast, and when, on his clock (m, m/s, s) */
  private bounce?: { bone: Object3D; seat: Grip; high: number; down: number; since: number }

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
    solid.position.copy(this.place)
    this.rest()
    solid.add(this.mesh)
    this.mesh.position.set(0, 0, 0)
    this.scene.add(solid)
    this.solid = solid
  }

  /**
   * it is pushed down so fast from where it is, at the moment `now` on his clock, and bounces off the floor back up,
   * under where a hand's `bone` seats it by a grip as the hand goes along
   */
  dribble(bone: Object3D, seat: Grip, down: number, now: number) {
    const { y } = this.place
    this.rest()
    this.bounce = { bone, seat, high: y, down, since: now }
  }

  /** it is no one's of the game's, where it is: out of the world and not bouncing, lying still or in his hand */
  rest() {
    this.scene.attach(this.mesh)
    this.mesh.quaternion.identity()
    this.mesh.scale.setScalar(1)
    this.solid?.removeFromParent()
    this.solid = this.bounce = undefined
  }

  /** the moment on his clock it comes back up through a height after it bounced */
  rising(high: number) {
    if (!this.bounce) throw new Error('the ball is not bouncing')
    const { high: from, down, since } = this.bounce
    const fall = landing(from, down)
    const up = BOUNCE * (down + GRAVITY * fall)
    const rise = high - RADIUS
    // (it does not come back so high: at the top it reaches)
    const climb = up * up >= 2 * GRAVITY * rise ? (up - Math.sqrt(up * up - 2 * GRAVITY * rise)) / GRAVITY : up / GRAVITY
    return since + fall + climb
  }

  /** the frame that ends at the moment `now` on his clock: it bounces */
  update(now: number) {
    if (!this.bounce) return
    const { bone, seat, high, down, since } = this.bounce
    const under = bone.localToWorld(new Vector3().copy(seat.position))
    this.mesh.position.set(under.x, bounced(high, down, now - since), under.z)
  }
}
