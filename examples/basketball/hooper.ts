import type { Side, Story } from '@drawcall/animate'
import { flat, type Grip, grip, Hand } from '@drawcall/hand'
import type { PhysicsWorld } from '@drawcall/physics'
import { Object3D, Vector3 } from 'three'
import { Character } from '../character'
import type { Game, Input } from '../play'
import { Ball, pushing, RADIUS } from './ball'
import { arc, HOOP } from './court'

const Y = new Vector3(0, 1, 0)

/** how fast he walks and runs (m/s) */
const SPEED = { walk: 1.4, run: 4.5 }
/** how long his hand rides the ball, from taking it to pushing it down again (s) */
const RIDE = 0.2
/** how steeply a shot leaves the hand, up from level (rad): a high arc drops into the ring */
const UP = (52 * Math.PI) / 180
/** how long a shot takes from the ball in his hands to its leaving them, and how long he stays as he shot after (s) */
const WIND = 0.8
const FOLLOW = 0.6
/** how far from the middle of his hips, along the ground, a ball on the floor is in his reach (of his arm) */
const REACH = 1.3
/** how near he faces the way he turns to before he reaches (rad) */
const FACED = 0.15
/** how long he takes to get down to the ball and take it (s) */
const STOOP = 0.8
/** the ball's places on him, counted from his right shoulder: held before his chest, and pushed down ahead of him on his right (of his arm, of how far out a shoulder is, of his trunk) */
const CHEST = { inward: 0.5, down: 0.4, ahead: 0.3 }
const BOUNCE = { inward: -0.5, down: 0.75, ahead: 0.3 }
/** where a shot leaves his hand: so far above his shoulders, ahead of him and in from his right shoulder (of his arm, of how far out a shoulder is) */
const RELEASE = { up: 0.85, ahead: 0.25, inward: 0.5 }
/** what of a hand takes the ball: the palm and the fingers, but the index, which the solver finds short of a ball so big, and the thumb, which does not reach round it */
const USING = ['palm', 'middle', 'ring', 'little'] as const

/** a grip of the ball from a side of it, as he faces: +x his left, +y up, +z ahead */
const side = (hand: Hand, ball: Object3D, from: Vector3) =>
  grip(hand, ball, { at: from.clone().normalize().multiplyScalar(RADIUS), from: from.clone().normalize(), using: USING })

/**
 * A basketball player led by the keys: he walks and runs, picks the ball up off the floor, dribbles it as he goes
 * with it, holds it before his chest standing, and shoots it at the hoop.
 */
export class Hooper implements Game {
  readonly character: Character
  readonly ball: Ball
  /**
   * the hands, read from the rig at rest, and how they take the ball: held in the right from behind and to its right
   * with the left on its other side, both a little over it, or the right on top to dribble
   */
  private readonly hands: Record<Side, Hand>
  private readonly grips: Record<'hold' | 'guide' | 'dribble', Grip>
  private readonly chest: Vector3
  private readonly bounce: Vector3
  /** where the ball will be as it comes back up, turned as it left his hand: where his hand goes to take it */
  private readonly meet = new Object3D()
  /** what he does with the ball, if anything, whether he is asked to go somewhere and to shoot, and whether he stays where he is, facing a way */
  doing?: 'picking up' | 'holding' | 'dribbling' | 'shooting'
  private moving = false
  private shooting = false
  private rooted = false
  private way?: { x: number; z: number }
  /** how many shots went in, and how high the ball was a frame ago (m) */
  baskets = 0
  private high = 0

  /** `rig` is his rigged body at rest, in the `scene` the `world` simulates */
  constructor(rig: Object3D, world: PhysicsWorld, scene: Object3D) {
    this.ball = new Ball(scene)
    // (the hands are read while the rig is at rest, before the body poses it)
    const hands = (this.hands = { right: new Hand(rig, 'right'), left: new Hand(rig, 'left') })
    const { mesh } = this.ball
    this.grips = {
      hold: side(hands.right, mesh, new Vector3(-1, 0.4, -1)),
      guide: side(hands.left, mesh, new Vector3(1, 0.4, 0)),
      dribble: side(hands.right, mesh, new Vector3(0, 1, 0)),
    }
    const character = (this.character = new Character(rig, world))
    const { body } = character
    const { arm, shoulder, trunk } = body.size
    const on = ({ inward, down, ahead }: typeof CHEST, front: number) =>
      new Vector3(inward * shoulder, -down * trunk, front + ahead * arm)
    this.chest = on(CHEST, body.front('right', -CHEST.down * trunk, CHEST.inward * shoulder) + RADIUS)
    this.bounce = on(BOUNCE, 0)
    scene.add(rig, this.meet)
    // the ball lies on the floor ahead of him
    scene.add(mesh)
    mesh.position.set(0.5, RADIUS, 1.5)
    this.ball.release(new Vector3())
  }

  /** he holds the ball from now on, if he did not: it as he holds it, which a hand takes hold of by a grip */
  private hold() {
    return this.character.body.hold(this.ball.mesh)
  }

  /** a frame: what the keys ask of him, and he goes as he is led */
  update(delta: number, input: Input) {
    if (input.act) this.act()
    const { move } = input
    const speed = this.rooted ? 0 : input.run ? SPEED.run : SPEED.walk
    this.moving = speed > 0 && (move.x !== 0 || move.z !== 0)
    this.character.update(delta, { x: move.x * speed, z: move.z * speed }, this.way)
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
    const shown = this.doing ?? (this.ball.free && this.reaches() ? 'Space: pick the ball up' : '')
    return `speed ${this.character.speed.toFixed(1)} m/s   baskets ${this.baskets}   ${shown}`
  }

  /** the action key: with the ball, he stops where he is to shoot; near it on the floor, he picks it up */
  private act() {
    if (this.doing && this.doing !== 'picking up') this.shooting = this.rooted = true
    else if (!this.doing && this.reaches()) this.play(this.pickUp())
  }

  private reaches() {
    const [hips, ball] = [this.character.body.hips.value, this.ball.place]
    return this.ball.free && Math.hypot(ball.x - hips.x, ball.z - hips.z) < REACH * this.character.body.size.arm
  }

  /** plays what he does with the ball: when it is over, the ball is let go if he still has it */
  private play(story: Story) {
    const self = this
    this.character.body.play(
      (function* () {
        try {
          yield* story
        } finally {
          const { body } = self.character
          self.hold().free()
          if (!self.ball.free) self.ball.release(self.ball.velocity(body.time))
          self.doing = self.way = undefined
          self.shooting = self.rooted = false
        }
      })(),
    )
  }

  /** he stops and turns to the ball, both hands take it where it lies, his right behind it and his left on its side, and he has it */
  private *pickUp(): Story {
    const { right, left } = this.character.body.hand
    const { hold, guide } = this.grips
    this.doing = 'picking up'
    // he stops and turns to it
    this.rooted = true
    const [hips, ball] = [this.character.body.hips.value, this.ball.place]
    this.way = { x: ball.x - hips.x, z: ball.z - hips.z }
    const way = new Vector3(this.way.x, 0, this.way.z)
    while (this.character.body.facing.angleTo(way) > FACED) yield
    // (it lies where it is, turned as he faces, for its grips to be as he has them)
    this.ball.take(hold)
    this.ball.mesh.quaternion.setFromAxisAngle(Y, Math.atan2(way.x, way.z))
    this.hold()
    const moment = this.character.body.time + STOOP
    const reached = right.by(moment, hold)
    const guided = left.by(moment, guide)
    if (!(yield* reached) || !(yield* guided)) return
    this.rooted = false
    this.way = undefined
    yield* this.handle()
  }

  /**
   * He has the ball in his right hand: standing, he holds it before his chest in both; going, he dribbles it, pushing
   * it down ahead of him as hard as brings it back up a ball's width over where his hand dribbles, and taking it there
   * as it comes up, until he is to shoot, which he gathers it for.
   */
  private *handle(): Story {
    const { body, capsule } = this.character
    const { right, left } = body.hand
    const { hold, guide, dribble } = this.grips
    const { ball } = this
    for (;;) {
      const held = this.hold()
      if (ball.held === hold && this.shooting) return yield* this.shoot()
      if (ball.held === hold && !this.moving) {
        this.doing = 'holding'
        held.to(this.chest, { on: body })
        left.to(guide)
        while (!this.moving && !this.shooting) yield
        continue
      }
      this.doing = 'dribbling'
      held.free('left')
      // (along the way he is asked to go, which he will be going by the time it comes back up)
      const { x, z } = capsule.asked
      const { stand, trunk } = body.size
      const high = capsule.floor + stand + trunk - BOUNCE.down * trunk
      const push = new Vector3(x, -pushing(high, high + RADIUS), z)
      // (the body says when the hand came short of the push it was asked for: the ball goes down as hard all the same,
      // from where it is let go)
      yield* held.to(this.bounce, { on: body, velocity: push, seconds: RIDE })
      held.free()
      // (it leaves turned as he faces, for the grip that takes it again to be as he has it)
      ball.mesh.quaternion.setFromAxisAngle(Y, Math.atan2(body.facing.x, body.facing.z))
      ball.dribble(push.setY(-pushing(ball.place.y, high + RADIUS)), body.time)
      const taken = this.shooting || !this.moving ? hold : dribble
      // (the hand goes to where the ball will be as it comes up through where it dribbles, and takes it there)
      const coming = ball.rising(ball.place.y - high)
      this.meet.position.copy(coming.place)
      this.meet.quaternion.copy(ball.mesh.quaternion)
      if (!(yield* right.by(coming.time, { ...taken, target: this.meet }))) return
      this.hold()
      right.to(taken)
      ball.take(taken)
    }
  }

  /** he squares up to the hoop and shoots: the ball leaves his right hand above his shoulder on its way to the ring */
  private *shoot(): Story {
    const { body, capsule } = this.character
    const { right, left } = body.hand
    this.doing = 'shooting'
    this.rooted = true
    const feet = capsule.position
    const toward = new Vector3(HOOP.x - feet.x, 0, HOOP.z - feet.z).normalize()
    this.way = { x: toward.x, z: toward.z }
    while (body.facing.angleTo(toward) > FACED) yield
    // (facing +z his right is -x)
    const aside = new Vector3(-toward.z, 0, toward.x)
    const { stand, trunk, arm, shoulder } = body.size
    const release = feet
      .clone()
      .setY(capsule.floor + stand + trunk + RELEASE.up * arm)
      .addScaledVector(toward, RELEASE.ahead * arm)
      .addScaledVector(aside, (1 - RELEASE.inward) * shoulder)
    const velocity = arc(release, UP)
    left.to(this.grips.guide)
    const moment = body.time + WIND
    right.shape(flat, { by: moment })
    const held = this.hold()
    const there = yield* held.by(moment, release, { velocity })
    held.free()
    this.ball.release(there ? velocity : right.velocity)
    yield* body.until(body.time + FOLLOW)
  }
}
