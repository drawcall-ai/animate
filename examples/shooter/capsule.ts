import { CapsuleMotor, type PhysicsWorld } from '@drawcall/physics'
import { type Object3D, Vector3 } from 'three'

/** how fast his going changes toward what is asked, on the ground and in the air (m/s²) */
const PUSH = { ground: 8, air: 2 }
/** how long he pushes off the ground before he leaves it in a jump (s) */
const TAKEOFF = 0.35
/** how far down the ground snaps him onto it as he goes, and is looked for under him in the air (m) */
const SNAP = 0.3
const FAR = 50
const DOWN = new Vector3(0, -1, 0)

/**
 * The game's character: an upright capsule the physics world moves, its feet at the origin of `feet`. It goes along
 * the ground as it is asked, slides along what it meets, stands on what is under it, falls, jumps after a push-off,
 * and crouches lower where there is room to.
 */
export class Capsule {
  /** how he is asked to go along the ground (m/s), and whether to crouch */
  readonly asked = new Vector3()
  crouch = false
  /** how he goes (m/s), whether he stands on something, and how high the ground under him is */
  readonly velocity = new Vector3()
  grounded = false
  floor = 0
  private readonly motor: CapsuleMotor
  private readonly high: number
  /** how fast he is to leave the ground, and how long his push-off has left, while he pushes off (m/s, s) */
  private takeoff?: { up: number; left: number }

  constructor(
    private readonly world: PhysicsWorld,
    feet: Object3D,
    radius: number,
    high: number,
  ) {
    this.motor = new CapsuleMotor(world, feet, radius, high)
    // (dropped onto the ground from just above it, clear of it)
    this.motor.position.y += 0.01
    this.high = high
    world.onAfterStep((delta) => this.step(delta))
  }

  get position() {
    return this.motor.position
  }

  /** whether he is lower than he stands */
  get crouched() {
    return this.motor.height < this.high
  }

  /** he pushes off to leave the ground so fast (m/s), if he stands on it */
  jump(up: number) {
    if (!this.grounded || this.takeoff) return false
    this.takeoff = { up, left: TAKEOFF }
    return true
  }

  private step(delta: number) {
    const { motor, velocity } = this
    motor.recover()
    // (standing up again where there is no room for it, he stays down)
    motor.resize(this.crouch ? 0.65 * this.high : this.high)
    const going = velocity.clone().setY(0)
    velocity.add(
      this.asked
        .clone()
        .setY(0)
        .sub(going)
        .clampLength(0, (this.grounded ? PUSH.ground : PUSH.air) * delta),
    )
    const { takeoff } = this
    if (takeoff && (takeoff.left -= delta) <= 0) {
      velocity.y = takeoff.up
      this.grounded = false
      this.takeoff = undefined
    }
    velocity.y += this.world.gravity[1] * delta
    for (const normal of motor.move(velocity.clone().multiplyScalar(delta), this.grounded)) {
      if (normal.y >= Math.SQRT1_2) velocity.y = Math.max(0, velocity.y)
      else velocity.addScaledVector(normal, -Math.min(0, velocity.dot(normal)))
    }
    const ground = velocity.y > 0 ? null : motor.ground(this.grounded ? SNAP : 0.025)
    this.grounded = ground !== null
    if (ground) velocity.y = 0
    // the ground under him: what he stands on, or below him in the air
    const below = this.grounded ? undefined : this.world.raycast(motor.position, DOWN, FAR)
    this.floor = below ? below.point.y : motor.position.y
    motor.commit()
  }
}
