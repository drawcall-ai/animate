import type { Held, Story } from '@drawcall/animate'
import { grip, Hand } from '@drawcall/hand'
import type { Object3D } from 'three'
import { Vector3 } from 'three'
import { Character } from '../character'
import type { Game, Input } from '../play'
import type { Thing } from '../thing'
import { balls, done, home, Pins } from './alley'
import { bowl } from './bowl'
import { type Ball, ball, GRIP, LINE, RADIUS } from './lane'

/** how fast he walks and runs (m/s) */
const SPEED = { walk: 1.4, run: 3.5 }
/** where he carries a ball, up from his hips and ahead of them (of how high his hips stand) */
const CARRY = { up: 0.3, ahead: 0.4 }
/** how long a ball he has taken takes to come from where it rested to where he carries it (s) */
const LIFT = 0.5
/** how long the pins have to settle once the ball is done before it comes back on the return (s) */
const SETTLE = 2
/** the right hand under the ball, the delivery's grip, and the left on its left side: the index does not reach round a ball so big */
const USING = ['palm', 'middle', 'ring', 'little'] as const
const UNDER = { ...GRIP, using: USING }
const SIDE = { at: new Vector3(RADIUS, 0, 0), from: new Vector3(1, 0, 0), using: USING }

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
  /** the ball in his hands, as he holds it, and how it leaves the hand once he bowls it */
  private held?: { k: number; ball: Held; flight?: Ball }
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
    const { held } = this
    if (held?.flight?.velocity) {
      this.balls[held.k].release(held.flight.velocity)
      this.rolled = { k: held.k }
      this.held = undefined
    }
    this.collect(delta)
  }

  /** Space: take the ball nearest on the return, or bowl the one he carries */
  private act() {
    const { character, held } = this
    if (character.acting) return
    if (held) {
      // (the approach needs a few strides)
      if (character.feet.position.z > LINE - 2.5) return
      held.flight = ball()
      return character.act(bowl(this.body, held.flight, this.balls[held.k].mesh, held.ball))
    }
    const at = character.feet.position
    const k = this.balls.findIndex(
      (thing, k) => !thing.free && thing.place.distanceTo(home(k)) < 1e-6 && flatly(thing.place, at) < 1.3 * this.body.size.arm,
    )
    if (k >= 0) character.act(this.take(k))
  }

  /** he turns to the ball where it rests, both hands go to it, and lift it to where he carries it, ahead of his hips */
  private *take(k: number): Story {
    const { body, hands } = this
    const { mesh } = this.balls[k]
    const toward = mesh.position.clone().sub(this.character.feet.position).setY(0)
    mesh.rotation.set(0, Math.atan2(toward.x, toward.z), 0)
    yield* body.face(toward)
    const ball = body.hold(mesh)
    this.held = { k, ball }
    const right = body.hand.right.to(grip(hands.right, mesh, UNDER))
    const left = body.hand.left.to(grip(hands.left, mesh, SIDE))
    yield* right
    yield* left
    const { stand, trunk, shoulder } = body.size
    yield* ball.to({ x: 0, y: CARRY.up * stand - trunk, z: CARRY.ahead * stand }, { on: body, seconds: LIFT })
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
