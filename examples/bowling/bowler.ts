import type { Story, Thing as Bound } from '@drawcall/animate'
import { grip, Hand } from '@drawcall/hand'
import { type Object3D, Vector3 } from 'three'
import { Character } from '../character'
import type { Game, Input } from '../play'
import type { Thing } from '../thing'
import { balls, done, home, Pins } from './alley'
import { bowl, carry, SIDE } from './bowl'
import { GRIP, LINE, RADIUS } from './lane'

/** how fast he walks and runs (m/s) */
const SPEED = { walk: 1.4, run: 3.5 }
/** how high above where it rested he lifts a ball off the return, and how long that takes (m, s) */
const LIFT = { up: 0.15, seconds: 0.5 }
/** how long the pins have to settle once the ball is done before it comes back on the return (s) */
const SETTLE = 2
/**
 * The bowler: he walks about, takes a ball off the return, carries it in both hands, and bowls it down the lane. Taking
 * a ball and bowling it are his actions, the player leading him again once each is over; the ball is his from when his
 * hands take it until it leaves the hand, the world's after.
 */
export class Bowler implements Game {
  readonly character: Character
  private readonly hands: { left: Hand; right: Hand }
  private readonly balls: Thing[]
  private readonly pins = new Pins()
  /** which ball is in his hands, bound to him */
  private held?: { k: number; ball: Bound }
  /** the ball let go, and how long until it comes back on the return */
  private rolled?: { k: number; left?: number }
  /** which ball of the frame is next */
  private ball = 1

  constructor(rig: Object3D, scene: Object3D) {
    this.hands = { left: new Hand(rig, 'left'), right: new Hand(rig, 'right') }
    this.character = new Character(rig)
    this.balls = balls(scene)
    scene.add(rig, this.pins.group)
  }

  private get body() {
    return this.character.body
  }

  update(delta: number, input: Input) {
    if (input.act) this.act()
    const speed = input.run ? SPEED.run : SPEED.walk
    this.character.update(delta, { x: input.move.x * speed, z: input.move.z * speed })
    this.collect(delta)
  }

  /** Space: take the ball nearest on the return, or bowl the one he carries */
  private act() {
    const { character, held } = this
    if (character.acting) return
    if (held) {
      // (the approach needs a few strides)
      if (character.feet.position.z > LINE - 2.5) return
      return character.act(
        bowl(this.body, held.ball, (velocity) => {
          this.balls[held.k].release(velocity)
          this.rolled = { k: held.k }
          this.held = undefined
        }),
      )
    }
    const at = character.feet.position
    const k = this.balls.findIndex(
      (thing, k) => !thing.free && thing.place.distanceTo(home(k)) < 1e-6 && flatly(thing.place, at) < 1.3 * this.body.size.arm,
    )
    if (k >= 0) character.act(this.take(k))
  }

  /**
   * he turns to the ball where it rests, and a hand goes to each side of it; they lift it off the return, then his
   * right hand goes round under it and leads it, and he carries it before him, the left on its side
   */
  private *take(k: number): Story {
    const { body, hands } = this
    const { right, left } = body.hand
    const { mesh } = this.balls[k]
    const toward = mesh.position.clone().sub(this.character.feet.position).setY(0)
    body.face(toward)
    // (turned to face him, for its sides to be his left and right; it keeps that turn in his hands)
    mesh.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(toward.x, toward.z))
    // a hand goes to each side of it where it rests, and they are on it
    const sides = { right: grip(hands.right, mesh, SIDE.right), left: grip(hands.left, mesh, SIDE.left) }
    const reached = left.to(sides.left)
    yield* right.to(sides.right)
    yield* reached
    const point = { turning: false }
    const ball = body.bind(mesh, { outside: true })
    ball.on(right, sides.right, point)
    ball.on(left, sides.left, point)
    // the body has it, the right hand leading, and lifts it
    ball.outside = false
    this.held = { k, ball }
    const lifted = mesh.position.clone().setY(mesh.position.y + LIFT.up)
    yield* ball.to(lifted, { seconds: LIFT.seconds })
    // the left leads it, held where it is, while the right goes under it; then the right leads
    const under = grip(hands.right, mesh, GRIP)
    ball.off(right)
    yield* right.to(under)
    ball.on(right, under, point)
    ball.off(left)
    yield* carry(body, ball, sides.left)
    body.face()
  }

  /** a ball rolled into the pit or come to rest goes back onto the return once the pins settle, and they are set up anew after a frame */
  private collect(delta: number) {
    const { rolled } = this
    if (!rolled || (rolled.left === undefined && !done(this.balls[rolled.k]))) return
    rolled.left = (rolled.left ?? SETTLE) - delta
    if (rolled.left > 0) return
    const thing = this.balls[rolled.k]
    thing.take()
    thing.mesh.position.copy(home(rolled.k))
    thing.mesh.rotation.set(0, 0, 0)
    this.rolled = undefined
    if (this.ball === 2 || this.pins.down === 10) {
      this.pins.set()
      this.ball = 1
    } else this.ball = 2
  }

  readout() {
    const doing = this.character.acting ? 'acting' : this.held ? 'carrying' : 'free'
    return [`${doing}${this.rolled ? ', rolling' : ''}`, `pins down ${this.pins.down}   ball ${this.ball} of the frame`].join('\n')
  }

  focus() {
    return this.rolled ? this.pins.head : undefined
  }
}

const flatly = (a: Vector3, b: Vector3) => Math.hypot(a.x - b.x, a.z - b.z)
