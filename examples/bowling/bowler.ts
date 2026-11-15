import type { Held, Story } from '@drawcall/animate'
import { flat, grip, Hand } from '@drawcall/hand'
import type { PhysicsWorld, RigidBody } from '@drawcall/physics'
import { type Object3D, Vector3 } from 'three'
import { Character } from '../character'
import type { Game, Input } from '../play'
import { balls, done, home, Pins, roll } from './alley'
import { GRIP, RADIUS } from './lane'

/** how fast he walks and runs (m/s) */
const SPEED = { walk: 1.4, run: 3.5 }
/** the approach: how fast he walks up and for how long, and how fast the ball leaves the hand (m/s, s, m/s) */
const APPROACH = { speed: 1.6, seconds: 1.3, ball: 6 }
/** how high he keeps his hips through the delivery (of how high they stand) */
const DIP = 0.75
/** how long before the approach ends he comes down (s) */
const DOWN = 0.4
/** where he carries a ball, up from his hips and ahead of them (of how high his hips stand) */
const CARRY = { up: 0.3, ahead: 0.4 }
/** how long a ball he has taken takes to come from where it rested to where he carries it (s) */
const LIFT = 0.5
/** how long he follows through after letting go before he is free again (s) */
const AFTER = 0.6
/** how long the pins have to settle once the ball is done before it comes back on the return (s) */
const SETTLE = 2
/** the right hand under the ball, the delivery's grip, and the left on its left side: the index does not reach round a ball so big */
const USING = ['palm', 'middle', 'ring', 'little'] as const
const UNDER = { ...GRIP, using: USING }
const SIDE = { at: new Vector3(RADIUS, 0, 0), from: new Vector3(1, 0, 0), using: USING }

type State = 'free' | 'taking' | 'carrying' | 'bowling'

/** The bowler: he walks about, takes a ball off the return, carries it in both hands, and bowls it at the pins. */
export class Bowler implements Game {
  readonly character: Character
  private readonly hands: { left: Hand; right: Hand }
  private readonly balls = balls()
  private readonly pins = new Pins()
  private state: State = 'free'
  /** the ball in his hands, and it as he holds it */
  private held?: { k: number; ball: Held }
  /** the ball let go, and the body the world moves it as */
  private rolled?: { k: number; solid: RigidBody; left?: number }
  /** the way he bowls, and when the approach ends, on his clock */
  private approach?: { way: Vector3; end: number }
  /** which ball of the frame is next */
  private ball = 1

  constructor(
    rig: Object3D,
    world: PhysicsWorld,
    private readonly scene: Object3D,
  ) {
    this.hands = { left: new Hand(rig, 'left'), right: new Hand(rig, 'right') }
    this.character = new Character(rig, world)
    scene.add(rig, this.pins.group, ...this.balls)
    this.balls.forEach((mesh, k) => mesh.position.copy(home(k)))
  }

  private get body() {
    return this.character.body
  }

  update(delta: number, input: Input) {
    const { body } = this
    if (input.act) this.act()
    const speed = input.run ? SPEED.run : SPEED.walk
    let asked = { x: input.move.x * speed, z: input.move.z * speed }
    let way: Vector3 | undefined
    if (this.state === 'taking' && this.held) {
      asked = { x: 0, z: 0 }
      way = this.balls[this.held.k].position.clone().sub(this.character.capsule.position).setY(0)
    }
    if (this.approach) {
      way = this.approach.way
      asked = body.time < this.approach.end ? way.clone().multiplyScalar(APPROACH.speed) : { x: 0, z: 0 }
    }
    this.character.update(delta, asked, way)
    this.collect(delta)
  }

  /** Space: take the ball nearest on the return, or bowl the one he carries */
  private act() {
    if (this.state === 'carrying') return this.body.play(this.bowl())
    if (this.state !== 'free') return
    const at = this.character.capsule.position
    const reach = 1.3 * this.body.size.arm
    const k = this.balls.findIndex(
      (mesh, k) =>
        k !== this.rolled?.k && mesh.position.distanceTo(home(k)) < 1e-6 && flatly(mesh.position, at) < reach,
    )
    if (k >= 0) this.body.play(this.take(k))
  }

  /** both hands go to the ball where it rests, and lift it to where he carries it, ahead of his hips */
  private *take(k: number): Story {
    const { body, hands } = this
    const mesh = this.balls[k]
    this.state = 'taking'
    mesh.rotation.set(0, yaw(mesh.position.clone().sub(this.character.capsule.position)), 0)
    const ball = body.hold(mesh)
    this.held = { k, ball }
    const right = body.hand.right.to(grip(hands.right, mesh, UNDER))
    const left = body.hand.left.to(grip(hands.left, mesh, SIDE))
    yield* right
    yield* left
    const { stand, trunk, shoulder } = body.size
    this.state = 'carrying'
    yield* ball.to({ x: shoulder, y: CARRY.up * stand - trunk, z: CARRY.ahead * stand }, { on: body, seconds: LIFT })
  }

  /** he walks up the way he faces, the ball in the right hand swinging back and through, and lets it go low beside his front foot */
  private *bowl(): Story {
    const { body, held } = this
    if (!held) throw new Error('bowling without a ball')
    const mesh = this.balls[held.k]
    const way = new Vector3(body.facing.x, 0, body.facing.z).normalize()
    const right = new Vector3(-way.z, 0, way.x)
    const end = body.time + APPROACH.seconds
    this.state = 'bowling'
    this.approach = { way, end }
    held.ball.free('left')
    // he comes to rest about the approach's length ahead, and lets go as he does, just ahead of his hips
    const { stand, shoulder } = body.size
    const place = this.character.capsule.position
      .clone()
      .addScaledVector(way, APPROACH.speed * APPROACH.seconds + 0.25 * stand)
      .addScaledVector(right, shoulder)
      .setY(RADIUS + 0.02)
    const moment = end + 0.15
    const velocity = way.clone().multiplyScalar(APPROACH.ball)
    body.hand.right.shape(flat, { by: moment })
    const swing = held.ball.by(moment, place, { velocity, palm: way })
    // he comes down onto the last stride
    yield* body.until(end - DOWN)
    body.hips.to({ y: DIP * stand })
    yield* swing
    held.ball.free()
    this.held = undefined
    this.scene.attach(mesh)
    const solid = roll(mesh, velocity)
    this.scene.add(solid)
    this.rolled = { k: held.k, solid }
    yield* body.until(body.time + AFTER)
    body.stand()
    this.approach = undefined
    this.state = 'free'
  }

  /** a ball rolled into the pit or come to rest goes back onto the return once the pins settle, and they are set up anew after a frame */
  private collect(delta: number) {
    const { rolled } = this
    if (!rolled || (rolled.left === undefined && !done(rolled.solid))) return
    rolled.left = (rolled.left ?? SETTLE) - delta
    if (rolled.left > 0) return
    const mesh = this.balls[rolled.k]
    rolled.solid.removeFromParent()
    this.scene.add(mesh)
    mesh.position.copy(home(rolled.k))
    this.rolled = undefined
    if (this.ball === 2 || this.pins.down === 10) {
      this.pins.set()
      this.ball = 1
    } else this.ball = 2
  }

  readout() {
    return [
      `${this.state}${this.rolled ? ', rolling' : ''}`,
      `pins down ${this.pins.down}   ball ${this.ball} of the frame`,
    ].join('\n')
  }

  focus() {
    return this.rolled ? this.pins.head : undefined
  }
}

const flatly = (a: Vector3, b: Vector3) => Math.hypot(a.x - b.x, a.z - b.z)
/** the turn about y that has +z point a way along the ground */
const yaw = (way: { x: number; z: number }) => Math.atan2(way.x, way.z)
