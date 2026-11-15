import { RigidBody } from '@drawcall/physics'
import { Mesh, MeshStandardMaterial, type Object3D, SphereGeometry, Vector3 } from 'three'
import { BALL } from './ball'
import { BOUNCE, MOUTH } from './court'

/** how fast a fed ball goes along the ground, and how far short of where it is aimed it bounces (m/s, m) */
const FEED = { speed: 11, short: 3.5 }
/** how heavy a ball is (kg), and how many lie about the court at most */
const MASS = 0.057
const KEPT = 6
const GRAVITY = 9.81

/** where a ball that is at a place moving so is `seconds` later, and how it moves then, bouncing off the court as the world has it */
export function flown(from: Vector3, velocity: Vector3, seconds: number) {
  const [place, moving] = [from.clone(), velocity.clone()]
  let left = seconds
  for (;;) {
    const fall = (moving.y + Math.sqrt(moving.y ** 2 + 2 * GRAVITY * Math.max(0, place.y - BALL.radius))) / GRAVITY
    if (left <= fall || moving.y ** 2 < 0.01) {
      const y = Math.max(BALL.radius, place.y + moving.y * left - (GRAVITY / 2) * left ** 2)
      place.addScaledVector(moving, left).setY(y)
      return { place, velocity: moving.setY(moving.y - GRAVITY * left) }
    }
    place.addScaledVector(moving, fall).setY(BALL.radius)
    moving.setY(BOUNCE * (GRAVITY * fall - moving.y))
    left -= fall
  }
}

/** a ball: free, a body of its own the world moves, and whether a racket has struck it */
export class Ball {
  readonly solid: RigidBody
  struck = false

  constructor(scene: Object3D, velocity: Vector3) {
    const material = { restitution: BOUNCE, staticFriction: 0, dynamicFriction: 0 }
    this.solid = new RigidBody({ mass: MASS, velocity: { linear: velocity.toArray() }, material })
    this.solid.add(new Mesh(new SphereGeometry(BALL.radius, 16, 12), new MeshStandardMaterial({ color: 0xd8e830 })))
    this.solid.position.copy(MOUTH)
    scene.add(this.solid)
  }

  get place() {
    return this.solid.position
  }

  get velocity() {
    return this.solid.getVelocity().linear
  }

  /** where it is `seconds` from now, and how it moves then */
  at(seconds: number) {
    return flown(this.place, this.velocity, seconds)
  }

  /** it leaves moving so */
  hit(velocity: Vector3) {
    this.solid.setVelocity({ linear: velocity, angular: new Vector3() })
    this.struck = true
  }
}

/** The ball machine at the far end: it feeds a ball over the net to pass through a place on his side, bouncing short of it. */
export class Machine {
  readonly balls: Ball[] = []

  constructor(private readonly scene: Object3D) {}

  /** the ball fed last, if any */
  get last(): Ball | undefined {
    return this.balls[this.balls.length - 1]
  }

  /** feeds a ball to come through a place on the ground */
  feed(to: { x: number; z: number }) {
    const way = new Vector3(to.x - MOUTH.x, 0, to.z - MOUTH.z)
    const time = (way.length() - FEED.short) / FEED.speed
    const up = (BALL.radius - MOUTH.y + (GRAVITY / 2) * time ** 2) / time
    this.balls.push(new Ball(this.scene, way.setLength(FEED.speed).setY(up)))
    if (this.balls.length > KEPT) this.balls.shift()?.solid.removeFromParent()
  }
}
