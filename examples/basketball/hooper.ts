import type { Side, Story } from '@drawcall/animate'
import { flat, type Grip, grip, Hand } from '@drawcall/hand'
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
/** how high a jump shot lifts his hips above standing (of his leg) */
const JUMP = 1 / 3
/** how far from the middle of his hips, along the ground, a ball on the floor is in his reach (of his arm) */
const REACH = 1.3
/** how long he takes to get down to the ball and take it (s) */
const STOOP = 0.8
/** the ball's places on him, counted from his right shoulder: held before his chest, and pushed down ahead of him on his right (of his arm, of how far out a shoulder is, of his trunk) */
const CHEST = { inward: 0.5, down: 0.4, ahead: 0.3 }
const BOUNCE = { inward: -0.5, down: 0.75, ahead: 0.3 }
/** where a jump shot leaves his hand: so far above his shoulders at the top, ahead of him and in from his right shoulder (of his arm, of how far out a shoulder is) */
const RELEASE = { up: 1, ahead: 0.25, inward: 0.5 }
/** what of a hand takes the ball: the palm and the fingers, but the index, which the solver finds short of a ball so big, and the thumb, which does not reach round it */
const USING = ['palm', 'middle', 'ring', 'little'] as const

/** a grip of the ball from a side of it, as he faces: +x his left, +y up, +z ahead */
const side = (hand: Hand, ball: Object3D, from: Vector3) =>
  grip(hand, ball, { at: from.clone().normalize().multiplyScalar(RADIUS), from: from.clone().normalize(), using: USING })

/**
 * A basketball player led by the keys: he walks and runs, picks the ball up off the floor, dribbles it as he goes
 * with it, holds it before his chest standing, and shoots it at the hoop. Picking it up and the jump shot need his
 * legs, so they are his actions; dribbling and holding are his hands only, the player leading him. The ball is his
 * while a hand has it, bounced by the dribble between, and the world's once it is let go.
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
    // (the hands are read while the rig is at rest, before the body poses it)
    const hands = (this.hands = { right: new Hand(rig, 'right'), left: new Hand(rig, 'left') })
    const { mesh } = this.ball
    this.grips = {
      hold: side(hands.right, mesh, new Vector3(-1, 0.4, -1)),
      guide: side(hands.left, mesh, new Vector3(1, 0.4, 0)),
      dribble: side(hands.right, mesh, new Vector3(0, 1, 0)),
    }
    const character = (this.character = new Character(rig))
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
    const shown = this.doing ?? (this.ball.free && this.reaches() ? 'Space: pick the ball up' : '')
    return `speed ${this.character.speed.toFixed(1)} m/s   baskets ${this.baskets}   ${shown}`
  }

  /** the action key: with the ball, he shoots once he has it in both hands; near it on the floor, he picks it up */
  private act() {
    if (this.character.acting) return
    if (this.doing) this.shooting = true
    else if (this.reaches()) this.character.act(this.pickUp())
  }

  private reaches() {
    const [hips, ball] = [this.character.body.hips.value, this.ball.place]
    return this.ball.free && Math.hypot(ball.x - hips.x, ball.z - hips.z) < REACH * this.character.body.size.arm
  }

  /** the ball is the world's again, moving as it does, and he has nothing to do with it */
  private drop() {
    this.hold().free()
    if (!this.ball.free) this.ball.release(this.ball.velocity(this.character.body.time))
    this.doing = undefined
    this.shooting = false
  }

  /** he turns to the ball, both hands take it where it lies, his right behind it and his left on its side, and he has it */
  private *pickUp(): Story {
    const { body } = this.character
    const { right, left } = body.hand
    const { hold, guide } = this.grips
    this.doing = 'picking up'
    const [hips, ball] = [body.hips.value, this.ball.place]
    const way = new Vector3(ball.x - hips.x, 0, ball.z - hips.z)
    yield* body.face(way)
    // (it lies where it is, turned as he faces, for its grips to be as he has them)
    this.ball.take(hold)
    this.ball.mesh.quaternion.setFromAxisAngle(Y, Math.atan2(way.x, way.z))
    this.hold()
    const moment = body.time + STOOP
    const reached = right.by(moment, hold)
    const guided = left.by(moment, guide)
    body.face()
    if (!(yield* reached) || !(yield* guided)) return this.drop()
    body.play(this.handle())
  }

  /**
   * He has the ball in his right hand: standing, he holds it before his chest in both; going, he dribbles it, pushing
   * it down ahead of him as hard as brings it back up a ball's width over where his hand dribbles, and taking it there
   * as it comes up, until he is to shoot, which he gathers it for.
   */
  private *handle(): Story {
    const { body, feet } = this.character
    const { right, left } = body.hand
    const { hold, guide, dribble } = this.grips
    const { ball } = this
    for (;;) {
      const held = this.hold()
      if (ball.held === hold && this.shooting) return this.character.act(this.shoot())
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
      const { x, z } = feet.asked
      const { stand, trunk } = body.size
      const high = feet.floor + stand + trunk - BOUNCE.down * trunk
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
      if (!(yield* right.by(coming.time, { ...taken, target: this.meet }))) return this.drop()
      this.hold()
      right.to(taken)
      ball.take(taken)
    }
  }

  /**
   * a jump shot: he squares up to the hoop, springs straight up, and at the top the ball leaves his right hand above
   * his shoulder on its way to the ring, the arm following it up until he lands
   */
  private *shoot(): Story {
    const { body, feet } = this.character
    const { right, left } = body.hand
    this.doing = 'shooting'
    const toward = new Vector3(HOOP.x - feet.position.x, 0, HOOP.z - feet.position.z).normalize()
    left.to(this.grips.guide)
    yield* body.face(toward)
    const { stand, trunk, arm, leg, shoulder } = body.size
    const top = feet.position.clone().setY(feet.floor + stand + JUMP * leg)
    const landing = body.jump(top)
    const highest = body.highest()
    // (facing +z his right is -x)
    const aside = new Vector3(-toward.z, 0, toward.x)
    const release = top
      .clone()
      .setY(top.y + trunk + RELEASE.up * arm)
      .addScaledVector(toward, RELEASE.ahead * arm)
      .addScaledVector(aside, (1 - RELEASE.inward) * shoulder)
    const velocity = arc(release, UP)
    right.shape(flat, { by: highest })
    const held = this.hold()
    const there = yield* held.by(highest, release, { velocity })
    held.free()
    this.ball.release(there ? velocity : right.velocity)
    this.doing = undefined
    this.shooting = false
    right.to({ x: shoulder / 2, y: 0.7 * arm, z: 0.6 * arm }, { on: body, palm: { x: 0, y: -1, z: 0.5 } })
    yield* landing
    right.shape()
    yield* body.stand()
  }
}
