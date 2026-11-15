import {
  type CapsuleQueryOptions,
  type CapsuleShape,
  CapsuleMotor,
  type PhysicsWorld,
  type RaycastOptions,
  RigidBody,
} from '@drawcall/physics'
import { type Matrix4, type Object3D, Vector3 } from 'three'

/** how fast his going changes toward what is asked, on the ground and in the air (m/s²) */
const PUSH = { ground: 8, air: 2 }
/** how far down the ground snaps him onto it as he goes, and is looked for under him in the air (m) */
const SNAP = 0.3
const FAR = 50
/** how far off level a wall's face may lean and still be upright (of a right angle's cosine) */
const UPRIGHT = 0.05
const DOWN = new Vector3(0, -1, 0)

/**
 * The game's character: an upright capsule the physics world moves, its feet at the origin of `feet`. It goes along
 * the ground as it is asked, slides along what it meets, stands on what is under it, falls, jumps when he is told to leave the ground,
 * and crouches lower where there is room to. What the world moves by itself (balls, bags, thrown things) he neither
 * stands on nor is stopped by: he cannot push it, and it would roll into him.
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
  /** the bodies the world moves by itself, as of this frame */
  private loose: RigidBody[] = []
  /** the world as he meets it, without the loose bodies */
  private readonly met: PhysicsWorld
  /** how fast he is to leave the ground, and how long until he does, once he is told (m/s, s) */
  private takeoff?: { up: number; left: number }

  constructor(
    private readonly world: PhysicsWorld,
    feet: Object3D,
    radius: number,
    high: number,
  ) {
    this.met = meeting(world, () => this.loose)
    this.motor = new CapsuleMotor(this.met, feet, radius, high)
    // (dropped onto the ground from just above it, clear of it)
    this.motor.position.y += 0.01
    this.high = high
  }

  get position() {
    return this.motor.position
  }

  /** whether he is lower than he stands */
  get crouched() {
    return this.motor.height < this.high
  }

  /** he leaves the ground so fast (m/s) so many seconds from now, if he stands on it */
  jump(up: number, after: number) {
    if (!this.grounded || this.takeoff) return false
    this.takeoff = { up, left: after }
    return true
  }

  /** a frame of the game: he goes on for `delta` seconds, as the body is to be by then (s) */
  update(delta: number) {
    if (!(delta > 0)) return
    const { motor, velocity } = this
    this.loose = loose(this.world)
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
      // (on the ground only an upright wall stops him going into it: an edge his rounded foot meets he steps onto)
      else if (!this.grounded || Math.abs(normal.y) < UPRIGHT)
        velocity.addScaledVector(normal, -Math.min(0, velocity.dot(normal)))
    }
    const ground = velocity.y > 0 ? null : motor.ground(this.grounded ? SNAP : 0.025)
    this.grounded = ground !== null
    if (ground) velocity.y = 0
    // the ground under him: what he stands on, or below him in the air
    const below = this.grounded ? undefined : this.met.raycast(motor.position, DOWN, FAR)
    this.floor = below ? below.point.y : motor.position.y
    motor.commit()
  }
}

/** the bodies under the world's scene that it moves by itself */
function loose(world: PhysicsWorld) {
  const found: RigidBody[] = []
  world.scene.traverse((part) => {
    if (part instanceof RigidBody && part.bodyType === 'dynamic') found.push(part)
  })
  return found
}

/** the `world` as its queries see it without the bodies `passed` gives (the motor takes no query options of its own) */
function meeting(world: PhysicsWorld, passed: () => RigidBody[]): PhysicsWorld {
  const and = <B>(more: readonly B[] = []) => [...more, ...passed()]
  return new Proxy(world, {
    get(target, key) {
      if (key === 'castCapsule')
        return (shape: CapsuleShape, pose: Matrix4, move: Vector3, options?: CapsuleQueryOptions) =>
          target.castCapsule(shape, pose, move, { ...options, excludeBodies: and(options?.excludeBodies) })
      if (key === 'capsuleContacts')
        return (shape: CapsuleShape, pose: Matrix4, far: number, options?: CapsuleQueryOptions) =>
          target.capsuleContacts(shape, pose, far, { ...options, excludeBodies: and(options?.excludeBodies) })
      if (key === 'raycast')
        return (from: Vector3, way: Vector3, far: number, options?: RaycastOptions) =>
          target.raycast(from, way, far, { ...options, excludeBodies: and(options?.excludeBodies) })
      const value: unknown = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
