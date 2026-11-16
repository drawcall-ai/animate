import type { Story, Thing } from '@drawcall/animate'
import { type Grip, grip, Hand } from '@drawcall/hand'
import { type Object3D, Quaternion, Vector3 } from 'three'
import { Character } from '../character'
import type { Game, Input } from '../play'
import { Ball, pushing, RADIUS } from './ball'
import { HOOP } from './court'
import { carry, jumpShot, SEAT } from './shot'

const DOWN = new Vector3(0, -1, 0)
/** how fast he walks and runs (m/s) */
const SPEED = { walk: 1.4, run: 4.5 }
/** how long his hand takes to push the ball down from where it has it (s) */
const RIDE = 0.2
/** how far from the middle of his hips, along the ground, a ball on the floor is in his reach (of his arm) */
const REACH = 1.3
/** how long he takes to get down to the ball and take it (s) */
const STOOP = 0.8
/** where he stands to pick the ball up: so far behind it, and to its left, for it to lie ahead of his right foot (of his arm, of how far out a hip is) */
const BEFORE = { behind: 0.6, aside: 1 }
/** how far from where his hand seats the ball it may be for the hand to take it, the ball easing into it (m) */
const NEAR = RADIUS
/** where his palm comes onto a ball on the floor from, as he faces it: over its top, toward him and to his right */
const ONTO = new Vector3(-0.3, 1, -0.6).normalize()
/** where he pushes the ball down from, counted from his right shoulder: out past it, ahead, and down his trunk (of how far out a shoulder is, of his arm, of his trunk) */
const BOUNCE = { out: 0.8, ahead: 0.3, down: 0.75 }
/** how fast his hand rises as it meets the ball coming up (m/s) */
const MEET = 1

/**
 * A basketball player led by the keys: he walks and runs, picks the ball up off the floor, dribbles it as he goes,
 * holds it before his chest standing, and shoots it at the hoop. Picking it up and the jump shot are actions, which
 * own his going; dribbling and holding are his hands only, the player leading him. The ball is bound to his right
 * hand by a point while the hand has it, keeping its own turn, and the story sends the ball; the floor bounces it
 * between pushes of the dribble, and the world has it once it is shot or dropped.
 */
export class Hooper implements Game {
  readonly character: Character
  readonly ball: Ball
  /** the right hand's bone, and where the ball sits in it */
  private readonly bone: Object3D
  private readonly seat: Grip
  /** the ball as bound to him */
  private readonly held: Thing
  /** what he does with the ball, if anything, and whether he is asked to go somewhere and to shoot */
  doing?: 'picking up' | 'holding' | 'dribbling' | 'shooting'
  private moving = false
  private shooting = false
  /** how many shots went in, and how high the ball was a frame ago (m) */
  baskets = 0
  private high = 0

  /** `rig` is his rigged body at rest, in the `scene` the physics world simulates */
  constructor(rig: Object3D, scene: Object3D) {
    this.ball = new Ball(scene)
    scene.add(rig, this.ball.mesh)
    // (the hand is read while the rig is at rest, before the body poses it)
    const hand = new Hand(rig, 'right')
    this.bone = hand.bone
    this.seat = grip(hand, this.ball.mesh, SEAT)
    this.character = new Character(rig)
    this.held = this.character.body.bind(this.ball.mesh)
    // the ball lies on the floor ahead of him
    this.ball.mesh.position.set(0.5, RADIUS, 1.5)
    this.ball.release(new Vector3())
  }

  /** a frame: what the keys ask of him, and he goes as he is led */
  update(delta: number, input: Input) {
    if (input.act) this.act()
    const { move } = input
    const speed = input.run ? SPEED.run : SPEED.walk
    this.moving = move.x !== 0 || move.z !== 0
    this.character.update(delta, { x: move.x * speed, z: move.z * speed })
    this.ball.update(this.character.body.time)
    this.count()
  }

  /** a basket: the ball came down through the ring */
  private count() {
    const { y, x, z } = this.ball.place
    const through = this.ball.free && this.high >= HOOP.y && y < HOOP.y
    if (through && Math.hypot(x - HOOP.x, z - HOOP.z) < HOOP.radius) this.baskets++
    this.high = y
  }

  readout() {
    const shown = this.doing ?? (this.reaches() ? 'Space: pick the ball up' : '')
    return `speed ${this.character.speed.toFixed(1)} m/s   baskets ${this.baskets}   ${shown}`
  }

  /** the action key: with the ball, he shoots once he has it in his hand; near it on the floor, he picks it up */
  private act() {
    if (this.character.acting) return
    if (this.doing) this.shooting = true
    else if (this.reaches()) this.character.act(this.pickUp())
  }

  private reaches() {
    const [hips, ball] = [this.character.body.hips.value, this.ball.place]
    return this.ball.free && Math.hypot(ball.x - hips.x, ball.z - hips.z) < REACH * this.character.body.size.arm
  }

  /** whether the ball is near enough where his right hand seats it for the hand to take it, and it settle there */
  private near() {
    const seat = this.bone.localToWorld(new Vector3().copy(this.seat.position))
    return seat.distanceTo(this.ball.place) < NEAR
  }

  /** the ball is the world's, falling from where it is, and he has nothing to do with it */
  private drop() {
    const { hand } = this.character.body
    this.held.free()
    hand.right.cancel()
    hand.left.cancel()
    hand.right.shape()
    hand.left.shape()
    this.ball.release(new Vector3())
    this.doing = undefined
    this.shooting = false
  }

  /**
   * he turns to the ball and gets down to it, his right palm coming onto it from over its top and his left palm onto
   * its side, and his right hand has it
   */
  private *pickUp(): Story {
    const { body } = this.character
    const { right, left } = body.hand
    const { ball } = this
    this.doing = 'picking up'
    // (it lies still where it is, no one's until a hand has it)
    ball.rest()
    const way = ball.place.sub(body.hips.value).setY(0).normalize()
    // (facing it, his left is square to the way to it)
    const leftward = new Vector3(way.z, 0, -way.x)
    // he steps to where it lies ahead of his right foot, and with his feet side by side there gets down to it
    const { arm, hip } = body.size
    const spot = ball.place.addScaledVector(way, -BEFORE.behind * arm).addScaledVector(leftward, BEFORE.aside * hip)
    body.face(way)
    yield* body.walk({ x: spot.x, z: spot.z })
    const moment = body.time + STOOP
    // (turned for where the seat has the palm, below it, to be where the palm comes from)
    const faces = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), way)
    ball.mesh.quaternion.setFromUnitVectors(DOWN, ONTO).premultiply(faces)
    const taken = right.by(moment, this.seat)
    const side = ball.place.addScaledVector(leftward, RADIUS)
    left.by(moment, side, { with: 'palm', palm: leftward.clone().negate() })
    yield* taken
    if (!this.near()) return this.drop()
    this.held.on(right, this.seat)
    carry(body, this.held)
    body.face()
    body.play(this.handle())
  }

  /**
   * He has the ball in his right hand: standing, he holds it before his chest; going, he dribbles it, pushing it down
   * out past his right shoulder as hard as brings it back up a ball's width over where his hand let it go, and taking
   * it there as it comes up, until he is to shoot.
   */
  private *handle(): Story {
    const { body, feet } = this.character
    const { right, left } = body.hand
    const { ball, seat, held } = this
    for (;;) {
      if (this.shooting) return this.character.act(this.shot())
      if (!this.moving) {
        this.doing = 'holding'
        carry(body, held)
        while (!this.moving && !this.shooting) yield
        continue
      }
      this.doing = 'dribbling'
      left.cancel()
      left.shape()
      const { stand, trunk, shoulder, arm } = body.size
      const high = feet.floor + stand + (1 - BOUNCE.down) * trunk
      const from = new Vector3(-BOUNCE.out * shoulder, -BOUNCE.down * trunk, BOUNCE.ahead * arm)
      // (along the way he is asked to go, which he will be going by the time it comes back up)
      const { x, z } = feet.asked
      const push = new Vector3(x, -pushing(high, high + RADIUS), z)
      yield* held.to(from, { on: body, velocity: push, palm: DOWN, seconds: RIDE })
      // (the hand may have come short of the push: the ball goes down as hard all the same, from where it is let go)
      held.free()
      ball.dribble(this.bone, seat, pushing(ball.place.y, high + RADIUS), body.time)
      // the hand goes back up to where it pushed from, and has the ball as it comes up there under it
      yield* right.by(ball.rising(high), from, { on: body, velocity: { x, y: MEET, z }, palm: DOWN, with: seat })
      ball.rest()
      held.on(right, seat)
    }
  }

  /** the jump shot, and the ball is the world's from the moment it leaves his hand */
  private *shot(): Story {
    this.doing = 'shooting'
    this.shooting = false
    yield* jumpShot(this.character.body, this.held, (velocity) => {
      this.ball.release(velocity)
      this.doing = undefined
    })
  }
}
