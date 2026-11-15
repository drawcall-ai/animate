import { type PhysicsWorld, RigidBody, SphereCollider } from '@drawcall/physics'
import { Matrix4, Mesh, MeshStandardMaterial, type Object3D, SphereGeometry, Vector3 } from 'three'
import { NET, RADIUS } from './ball'

/** how heavy the ball is, and how much of its speed it keeps off a hand or forearms (kg) */
const MASS = 0.27
const RESTITUTION = 0.6
/** how long after the ball was last tossed it is tossed again, once he is free, and when the first is (s) */
const EVERY = 6
const FIRST = 3
/** where the setter's hands toss the ball from: so far to his left of where it peaks, and so high (m) */
const FROM = { aside: 1.2, high: 1.9 }
/** where the tosses peak, in turn: high near the net, to spike, and lower and further back, to pass (m) */
const PEAKS = [
  new Vector3(0, 4.2, NET.z - 0.6),
  new Vector3(-1.2, 3.4, NET.z - 3.5),
  new Vector3(-1.5, 4.2, NET.z - 0.8),
  new Vector3(0.8, 3.2, NET.z - 4.5),
]

/**
 * A setter, unseen, and the ball: a body of its own the world moves, tossed up to peak at a spot on his side every
 * few seconds, and struck by a hand or forearms, off which it leaves as they hit it.
 */
export class Setter {
  readonly ball = new RigidBody({ mass: MASS, canSleep: false })
  /** whether the ball is in the air from a toss, not yet struck or down */
  live = false
  private clock = EVERY - FIRST
  private tossed = 0
  /** how fast the world has things fall (m/s²) */
  readonly gravity: number

  constructor(scene: Object3D, world: PhysicsWorld) {
    this.gravity = -world.gravity[1]
    this.ball.add(
      new SphereCollider({ radius: RADIUS }),
      new Mesh(new SphereGeometry(RADIUS, 24, 16), new MeshStandardMaterial({ color: 0xf0e060 })),
    )
    this.ball.position.set(PEAKS[0].x + FROM.aside, RADIUS, PEAKS[0].z)
    scene.add(this.ball)
  }

  get place() {
    return this.ball.position
  }

  /** time goes on by `delta` seconds: the ball is tossed when it is due and he is `ready` for it */
  update(delta: number, ready: boolean) {
    if (this.live && this.place.y < 2 * RADIUS) this.live = false
    this.clock += delta
    if (this.clock < EVERY || !ready) return
    this.clock = 0
    const peak = PEAKS[this.tossed++ % PEAKS.length]
    const from = new Vector3(peak.x + FROM.aside, FROM.high, peak.z)
    const up = Math.sqrt(2 * this.gravity * (peak.y - from.y))
    const linear = peak
      .clone()
      .sub(from)
      .multiplyScalar(this.gravity / up)
      .setY(up)
    this.ball.teleport(new Matrix4().setPosition(from))
    this.ball.setVelocity({ linear, angular: new Vector3() })
    this.live = true
  }

  /** where the ball will be so many seconds on, flying as it does */
  at(seconds: number) {
    const { linear } = this.ball.getVelocity()
    return this.place
      .clone()
      .addScaledVector(linear, seconds)
      .setY(this.place.y + linear.y * seconds - (this.gravity / 2) * seconds ** 2)
  }

  /** in how many seconds the ball comes down through a height, NaN if it does not reach it (m, s) */
  falls(high: number) {
    const { y } = this.ball.getVelocity().linear
    return (y + Math.sqrt(y * y + 2 * this.gravity * (this.place.y - high))) / this.gravity
  }

  /** the ball is struck by a surface facing `normal`, moving at `velocity` (m/s): it leaves as that hits it */
  strike(normal: Vector3, velocity: Vector3) {
    const { linear } = this.ball.getVelocity()
    const closing = linear.clone().sub(velocity).dot(normal)
    if (closing < 0) linear.addScaledVector(normal, -(1 + RESTITUTION) * closing)
    this.ball.setVelocity({ linear })
    this.live = false
  }
}
