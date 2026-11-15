import type { Story } from '@drawcall/animate'
import { type Grip, grip, Hand } from '@drawcall/hand'
import { type Object3D, Vector3 } from 'three'
import { Character } from '../character'
import type { Game, Input } from '../play'
import type { Thing } from '../thing'
import { balls, done, home, Pins } from './alley'
import { bowl, carry, upright } from './bowl'
import { GRIP, LINE, RADIUS } from './lane'

/** how fast he walks and runs (m/s) */
const SPEED = { walk: 1.4, run: 3.5 }
/** how high above where it rested he lifts a ball off the return, and how long that takes (m, s) */
const LIFT = { up: 0.15, seconds: 0.5 }
/** how long the pins have to settle once the ball is done before it comes back on the return (s) */
const SETTLE = 2
/** a hand on each side of a ball, turned to face him, as he takes it off the return: the index does not reach round a ball so big */
const using = ['palm', 'middle', 'ring', 'little'] as const
const SIDE = {
  left: { at: new Vector3(RADIUS, 0, 0), from: new Vector3(1, 0, 0), using },
  right: { at: new Vector3(-RADIUS, 0, 0), from: new Vector3(-1, 0, 0), using },
}

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
  /** which ball is in his hands, and how his right hand has it */
  private held?: { k: number; seat: Grip }
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
    if (this.held) upright(this.held.seat.target, this.body)
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
        bowl(this.body, held.seat, (velocity) => {
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
   * he turns to the ball where it rests, a hand goes to each side of it and they lift it off the return, then his right
   * hand goes under it and has it, and he carries it before him
   */
  private *take(k: number): Story {
    const { body, hands } = this
    const { mesh } = this.balls[k]
    const toward = mesh.position.clone().sub(this.character.feet.position).setY(0)
    body.face(toward)
    mesh.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(toward.x, toward.z))
    const { left, right } = body.hand
    const sides = { left: grip(hands.left, mesh, SIDE.left), right: grip(hands.right, mesh, SIDE.right) }
    const reached = left.to(sides.left)
    yield* right.to(sides.right)
    yield* reached
    // (the left hand has it while the right goes round under it)
    left.take(sides.left)
    this.held = { k, seat: grip(hands.right, mesh, GRIP) }
    yield* left.to(mesh.position.clone().setY(mesh.position.y + LIFT.up), { with: sides.left, seconds: LIFT.seconds })
    yield* right.to(this.held.seat)
    left.letGo()
    right.take(this.held.seat)
    yield* carry(body, this.held.seat)
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
