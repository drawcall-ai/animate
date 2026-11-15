import type { Side, Story } from '@drawcall/animate'
import { flat, type Grip, grip, Hand } from '@drawcall/hand'
import { Object3D, Vector3 } from 'three'
import { Character, holds } from '../character'
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
/** how near the way he is asked to go he faces before he dribbles: he turns into it with the ball in his hands (rad) */
const FACED = 0.15
/** how long he takes to get down to the ball and take it (s) */
const STOOP = 0.8
/** the ball's places on him, counted from his right shoulder: held before his chest, and pushed down ahead of him on his right (of his arm, of how far out a shoulder is, of his trunk) */
const CHEST = { inward: 0.5, down: 0.4, ahead: 0.3 }
const BOUNCE = { inward: -0.5, down: 0.75, ahead: 0.3 }
/** where a jump shot leaves his hand: so far above his shoulders at the top, ahead of him and in from his right shoulder (of his arm, of how far out a shoulder is) */
const RELEASE = { up: 1, ahead: 0.25, inward: 0.5 }
/** what of a hand takes the ball: the palm and the fingers, but the index, which the solver finds short of a ball so big, and the thumb, which does not reach round it */
const USING = ['palm', 'middle', 'ring', 'little'] as const

/**
 * the sides of the ball his hands take it from, as he faces (+x his left, +y up, +z ahead), and the way the fingers go
 * on it: the right behind it and to its right, the left on its other side, both a little over it, the fingers up; or
 * the right on top to dribble, the fingers ahead
 */
const GRIPS = {
  hold: { from: new Vector3(-1, 0.4, -1), pointing: new Vector3(0, 1, 0) },
  guide: { from: new Vector3(1, 0.4, 0), pointing: new Vector3(0, 1, 0.5) },
  dribble: { from: new Vector3(0, 1, 0), pointing: new Vector3(0, 0, 1) },
}

/** a grip of the ball from a side of it, the fingers going as said, or unsaid as the arm comes to it where it is now */
const side = (hand: Hand, ball: Object3D, { from, pointing }: { from: Vector3; pointing?: Vector3 }) => {
  const toward = from.clone().normalize()
  return grip(hand, ball, { at: toward.clone().multiplyScalar(RADIUS), from: toward, pointing, using: USING })
}

/**
 * A basketball player led by the keys: he walks and runs, picks the ball up off the floor, dribbles it as he goes
 * with it, holds it before his chest standing, and shoots it at the hoop. Picking it up and the jump shot need his
 * legs, so they are his actions; dribbling and holding are his hands only, the player leading him. The ball is his
 * while a hand has it, bounced by the dribble between, and the world's once it is let go.
 */
export class Hooper implements Game {
  readonly character: Character
  readonly ball: Ball
  /** the hands, read from the rig at rest, and how they hold the ball: before him in both, or the right dribbling it */
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
      hold: side(hands.right, mesh, GRIPS.hold),
      guide: side(hands.left, mesh, GRIPS.guide),
      dribble: side(hands.right, mesh, GRIPS.dribble),
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

  /** whether he goes the way he is asked to, facing near it */
  private goes() {
    const { x, z } = this.character.feet.asked
    return this.moving && this.character.body.facing.angleTo(new Vector3(x, 0, z)) < FACED
  }

  /** the ball is the world's again, moving as it does, and he has nothing to do with it */
  private drop() {
    this.hold().free()
    if (!this.ball.free) this.ball.release(this.ball.velocity(this.character.body.time))
    this.doing = undefined
    this.shooting = false
  }

  /**
   * he turns to the ball, both hands take it where it lies, his right behind it and his left on its side, as his arms
   * come to it, and gathers it
   */
  private *pickUp(): Story {
    const { body } = this.character
    const { right, left } = body.hand
    const { mesh } = this.ball
    this.doing = 'picking up'
    const [hips, ball] = [body.hips.value, this.ball.place]
    const way = new Vector3(ball.x - hips.x, 0, ball.z - hips.z)
    yield* body.face(way)
    // (it lies where it is, turned as he faces, for its grips to be as he has them)
    this.ball.take()
    mesh.quaternion.setFromAxisAngle(Y, Math.atan2(way.x, way.z))
    const taken = side(this.hands.right, mesh, { from: GRIPS.hold.from })
    this.ball.held = taken
    this.hold()
    const moment = body.time + STOOP
    const reached = right.by(moment, taken)
    const guided = left.by(moment, side(this.hands.left, mesh, { from: GRIPS.guide.from }))
    body.face()
    if (!(yield* reached) || !(yield* guided)) return this.drop()
    if (!(yield* this.gather())) return this.drop()
    body.play(this.handle())
  }

  /** he brings the ball before his chest and takes it there in both hands as he holds it, the right first; whether he has it so */
  private *gather(): Story<boolean> {
    const { body } = this.character
    const { right, left } = body.hand
    const { hold, guide } = this.grips
    yield* this.hold().to(this.chest, { on: body })
    if (!(yield* right.to(hold))) return false
    this.ball.held = hold
    yield* left.to(guide)
    return true
  }

  /**
   * He has the ball in his right hand: standing, he gathers it and holds it before his chest in both; going, he
   * dribbles it, pushing it down ahead of him as hard as brings it back up a ball's width over where his hand dribbles,
   * and taking it there as it comes up, until he is to shoot, which he gathers it for.
   */
  private *handle(): Story {
    const { body, feet } = this.character
    const { right, left } = body.hand
    const { hold, guide, dribble } = this.grips
    const { ball } = this
    for (;;) {
      if (this.shooting || !this.goes()) {
        this.doing = 'holding'
        if (ball.held !== hold && !(yield* this.gather())) return this.drop()
        if (this.shooting) return this.character.act(this.shoot())
        this.hold().to(this.chest, { on: body })
        left.to(guide)
        while (!this.goes() && !this.shooting) yield
        continue
      }
      this.doing = 'dribbling'
      const held = this.hold()
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
      // (the hand goes to where the ball will be as it comes up through where it dribbles, and takes it there)
      const coming = ball.rising(ball.place.y - high)
      this.meet.position.copy(coming.place)
      this.meet.quaternion.copy(ball.mesh.quaternion)
      yield* right.by(coming.time, { ...dribble, target: this.meet })
      // (it is his if it is in his hand, as near as half its width: it is put where the hand has it, and held there)
      const inHand = this.hands.right.bone.localToWorld(dribble.position.clone())
      if (inHand.distanceTo(this.meet.position) > RADIUS / 2) return this.drop()
      ball.take(dribble)
      holds(body, this.hands.right, dribble)
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
